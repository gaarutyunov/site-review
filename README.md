# Site Review

Leave comments on website elements and let an AI coding agent fix them.

A browser extension lets you pick any element on a page, write a comment, and
tag elements with human-readable slugs (Docker-container style, e.g.
`dancing-gorilla`). An MCP server exposes those comments to AI agents
(Claude Code, Cursor, …) so they can read the selector + context and resolve
each one.

```
 Browser (any page)                Local service                AI agent
┌────────────────────┐   POST /ingest   ┌──────────────┐   MCP    ┌──────────┐
│  Site Review       │ ───────────────▶ │  Express +   │ ◀──────▶ │ Claude   │
│  extension         │ ◀─────────────── │  SQLite      │  tools   │ Code     │
│  (WXT + React)     │   GET /comments  │  + MCP server│          │          │
└────────────────────┘                  └──────────────┘          └──────────┘
```

## Features

- **Option+C** → click an element → a comment box pops up. (Shortcut editable in settings.)
- Commented elements are **highlighted** with a slug badge. Click a badge to edit.
- **Curtain** on the right lists every comment; click one to scroll to and focus its element.
- **Option+Shift+C** → multi-select mode: click several elements, leave one comment for all.
- Every element gets a random **slug** (`dancing-gorilla`); reference it in comment text. Double-click a slug chip to rename it (`jumping-koala`) — references in the text update too.
- Comments are pushed to a local server; an **MCP server** exposes them to AI agents to fix.

## Layout

```
packages/
  shared/      types + slug generation (unique-names-generator)
  server/      Express ingest API + MCP server (better-sqlite3, @modelcontextprotocol/sdk)
  extension/   WXT + React MV3 extension
  landing/     buildless landing page, styled with @gaarutyunov/ui-kit
```

## Tech choices

| Concern | Choice |
|---|---|
| Extension framework | [WXT](https://wxt.dev) 0.20 + React, Shadow-DOM UI via `createShadowRootUi` |
| Selector generation | [`@medv/finder`](https://github.com/antonmedv/finder) with hashed-class filtering + multi-anchor fallback (attributes → text → nth-child) |
| Local store (extension) | IndexedDB via Dexie, owned by the background service worker |
| Server store | SQLite via better-sqlite3 (`comments` + `comment_elements`) |
| MCP | `@modelcontextprotocol/sdk`, stateless Streamable HTTP at `/mcp` (+ stdio entry) |
| Slugs | `unique-names-generator` (`adjective-animal`) |

## Setup

Requires Node ≥ 20 and pnpm.

```bash
pnpm install            # builds the better-sqlite3 native addon (approved in package.json)
pnpm build              # build shared + server + extension
```

> pnpm 10 blocks dependency build scripts by default. The native `better-sqlite3`
> addon is allow-listed via `pnpm.onlyBuiltDependencies` in the root
> `package.json`. If it ever fails to load, run `pnpm rebuild better-sqlite3`.

## Run the server

### Docker (GHCR)

The server is published as a container on the GitHub Container Registry:

```bash
docker run -d --name site-review \
  -p 4711:4711 \
  -v ~/.site-review:/data \
  ghcr.io/gaarutyunov/site-review:latest
```

Comments persist in the mounted `~/.site-review` volume (`SITE_REVIEW_DB`
defaults to `/data/comments.db` inside the container).

### From source

```bash
pnpm dev:server         # tsx watch, http://localhost:4711
# or, after pnpm build:
pnpm start:server
```

Environment:

- `SITE_REVIEW_PORT` — HTTP port (default `4711`)
- `SITE_REVIEW_DB` — SQLite path (default `~/.site-review/comments.db`)

Endpoints: `POST /ingest`, `GET /comments`, `GET /comments/:id`,
`DELETE /comments/:id`, `GET /pages`, `POST /mcp` (MCP Streamable HTTP).

## Load the extension

```bash
pnpm dev:extension      # launches a dev browser with HMR
# or load the production build unpacked:
pnpm build:extension    # output in packages/extension/.output/chrome-mv3
```

Then in Chrome: `chrome://extensions` → enable Developer mode → **Load unpacked**
→ select `packages/extension/.output/chrome-mv3`.

Open the extension **Settings** (popup → ⚙️) to change shortcuts or point at a
different server URL.

## Connect an AI agent (MCP)

The server exposes these tools: `list_open_comments`, `get_comments_for_url`,
`get_comment`, `search_comments`, `resolve_comment`, `reopen_comment`, plus a
`comments://open` resource.

**Streamable HTTP** (server already running):

```bash
claude mcp add --transport http site-review http://localhost:4711/mcp
```

**stdio** (agent spawns the server; reads the same SQLite file):

```bash
claude mcp add site-review -- node /ABS/PATH/packages/server/dist/stdio.js
```

Then ask the agent: *"List open site-review comments and fix them, resolving each
when done."*

## Landing page

A buildless landing page lives in `packages/landing`, styled with
[`@gaarutyunov/ui-kit`](https://github.com/gaarutyunov/ui-kit) so it matches
[garutyunov.com](https://garutyunov.com). The `ga-*` web-component bundle is
vendored (see `packages/landing/vendor`) — no CDN, no bundler.

```bash
pnpm dev:landing        # static dev server at http://localhost:8080
pnpm build:landing      # assemble packages/landing/dist
```

It deploys to GitHub Pages on push to `main`, and every PR gets an isolated
preview under `…/pr-preview/pr-<N>/` (see `.github/workflows`).

## Development

```bash
pnpm lint               # ESLint (flat config)
pnpm typecheck          # tsc --noEmit across packages
pnpm test               # Vitest (shared slug/URL logic + server store)
pnpm build              # build all packages
```

CI (`.github/workflows/ci.yml`) runs lint → typecheck → test → build on every
push and PR. Pushing a `vX.Y.Z` tag (or publishing a GitHub Release) builds and
pushes the server image to `ghcr.io/gaarutyunov/site-review`.

## How element re-location works

A comment stores a multi-anchor descriptor per element: an optimized CSS
selector (framework-hashed classes filtered out), stable attributes
(`data-testid`, `id`, `aria-label`, …), a text snapshot, and an nth-child path.
On reload the extension resolves through that cascade and only accepts a unique
match, so highlights survive most DOM changes; unresolvable comments are simply
not drawn (the data is kept).
