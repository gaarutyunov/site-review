import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Comment } from "@site-review/shared";
import type { CommentStore } from "./store.js";

/** Shape returned to agents — flat and easy to map to source. */
function toAgentView(c: Comment) {
  return {
    id: c.id,
    pageUrl: c.pageUrl,
    pageTitle: c.pageTitle,
    text: c.text,
    status: c.status,
    elements: c.targets.map((t) => ({
      slug: t.slug,
      cssSelector: t.cssSelector,
      tagName: t.tagName,
      textSnippet: t.textSnippet,
    })),
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
  };
}

const elementShape = z.object({
  slug: z.string(),
  cssSelector: z.string(),
  tagName: z.string().optional(),
  textSnippet: z.string().optional(),
});

const commentShape = z.object({
  id: z.string(),
  pageUrl: z.string(),
  pageTitle: z.string().optional(),
  text: z.string(),
  status: z.enum(["open", "resolved"]),
  elements: z.array(elementShape),
  createdAt: z.string(),
  updatedAt: z.string(),
});

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data as Record<string, unknown>,
  };
}

/** Build a fully-wired MCP server backed by the given comment store. */
export function buildMcpServer(store: CommentStore): McpServer {
  const server = new McpServer({
    name: "site-review",
    version: "0.1.0",
  });

  server.registerTool(
    "list_open_comments",
    {
      title: "List open comments",
      description:
        "List all unresolved website-element comments waiting to be fixed. Start here to find work. Optionally filter to a single page URL.",
      inputSchema: {
        pageUrl: z
          .string()
          .optional()
          .describe("Only return comments authored on this exact page URL."),
      },
      outputSchema: { comments: z.array(commentShape) },
    },
    async ({ pageUrl }) => {
      const comments = store
        .list({ status: "open", pageUrl })
        .map(toAgentView);
      return json({ comments });
    },
  );

  server.registerTool(
    "get_comments_for_url",
    {
      title: "Get comments for a URL",
      description:
        "Get every comment (open and resolved) for one page URL, so you can fix a whole page at once.",
      inputSchema: {
        url: z.string().describe("The page URL to fetch comments for."),
        status: z
          .enum(["open", "resolved"])
          .optional()
          .describe("Filter by status; omit for all."),
      },
      outputSchema: { comments: z.array(commentShape) },
    },
    async ({ url, status }) => {
      const comments = store.list({ pageUrl: url, status }).map(toAgentView);
      return json({ comments });
    },
  );

  server.registerTool(
    "get_comment",
    {
      title: "Get one comment",
      description:
        "Get full detail for a single comment by id, including every targeted element's CSS selector, slug and text snapshot — use these to locate the code to change.",
      inputSchema: {
        id: z.string().describe("Comment id, e.g. 'jumping-koala'."),
      },
      outputSchema: { comment: commentShape.nullable() },
    },
    async ({ id }) => {
      const c = store.get(id);
      return json({ comment: c ? toAgentView(c) : null });
    },
  );

  server.registerTool(
    "search_comments",
    {
      title: "Search comments",
      description:
        "Free-text search over comment bodies, element slugs and element text snapshots.",
      inputSchema: {
        query: z.string().describe("Substring to search for."),
      },
      outputSchema: { comments: z.array(commentShape) },
    },
    async ({ query }) => {
      const comments = store.search(query).map(toAgentView);
      return json({ comments });
    },
  );

  server.registerTool(
    "resolve_comment",
    {
      title: "Resolve comment",
      description:
        "Mark a comment as resolved once you have fixed it. This closes the loop and removes it from the open list.",
      inputSchema: {
        id: z.string().describe("Comment id to resolve."),
      },
      outputSchema: { comment: commentShape.nullable() },
    },
    async ({ id }) => {
      const c = store.setStatus(id, "resolved");
      return json({ comment: c ? toAgentView(c) : null });
    },
  );

  server.registerTool(
    "reopen_comment",
    {
      title: "Reopen comment",
      description: "Re-open a previously resolved comment by id.",
      inputSchema: {
        id: z.string().describe("Comment id to reopen."),
      },
      outputSchema: { comment: commentShape.nullable() },
    },
    async ({ id }) => {
      const c = store.setStatus(id, "open");
      return json({ comment: c ? toAgentView(c) : null });
    },
  );

  // Read-only resources for clients that surface context without a tool call.
  server.registerResource(
    "open-comments",
    "comments://open",
    {
      title: "Open comments",
      description: "All currently unresolved comments as JSON.",
      mimeType: "application/json",
    },
    async (uri) => ({
      contents: [
        {
          uri: uri.href,
          mimeType: "application/json",
          text: JSON.stringify(
            store.list({ status: "open" }).map(toAgentView),
            null,
            2,
          ),
        },
      ],
    }),
  );

  return server;
}
