# Vendored UI kit

These files are the pinned standalone bundle of
[`@gaarutyunov/ui-kit`](https://github.com/gaarutyunov/ui-kit) — the same design
system that powers [garutyunov.com](https://garutyunov.com). Vendoring the
release assets keeps the landing page **buildless and self-contained**: no npm
install, no external CDN fetch at runtime, and a reproducible deploy on
GitHub Pages.

| File | Source |
| --- | --- |
| `ga-ui-kit.css` | design tokens (palette, Geist typography, spacing) |
| `ga-ui-kit.min.js` | all `<ga-*>` custom elements, self-registering |

**Pinned version:** `v0.2.0`

## Refreshing

```bash
pnpm --filter @site-review/landing vendor:refresh   # pulls the latest release
# or a specific tag:
node packages/landing/scripts/refresh-vendor.mjs v0.2.0
```
