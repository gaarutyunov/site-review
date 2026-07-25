import express, { type Request, type Response } from "express";
import cors from "cors";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { uniqueSlug, type CommentUpsert } from "@site-review/shared";
import { CommentStore } from "./store.js";
import { buildMcpServer } from "./mcp.js";
import { GithubStore } from "./github/store.js";
import { githubRouter, type GithubRoutesDeps } from "./github/routes.js";

/**
 * Build the Express app: a REST ingest/query API for the browser extension and
 * a stateless Streamable HTTP MCP endpoint at /mcp for AI agents. Both are
 * backed by the same on-disk SQLite store (Option B from the design).
 *
 * `githubDeps` lets tests inject a fake GitHub client / config; in production
 * the GitHub tables live in the same SQLite database as the comments.
 */
export function createApp(
  store: CommentStore,
  githubDeps: Partial<Omit<GithubRoutesDeps, "comments">> = {},
) {
  const app = express();
  app.use(cors()); // reflect origin — extension posts from chrome-extension://
  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, name: "site-review", version: "0.1.0" });
  });

  // --- REST API for the extension ---------------------------------------

  // Upsert a comment (create or update). The extension is the source of truth
  // for authoring; the server mirrors it for agents to read.
  app.post("/ingest", (req: Request, res: Response) => {
    const body = req.body as CommentUpsert;
    if (!body?.id || !body.pageUrl || !Array.isArray(body.targets)) {
      return res.status(400).json({ error: "id, pageUrl, targets required" });
    }
    const saved = store.upsert(body);
    res.json(saved);
  });

  // Allocate N unique element slugs (extension asks before attaching a comment).
  app.post("/slugs", (req: Request, res: Response) => {
    const count = Math.min(Math.max(Number(req.body?.count) || 1, 1), 50);
    const taken = store.takenSlugs();
    const slugs: string[] = [];
    for (let i = 0; i < count; i++) {
      const s = uniqueSlug(taken);
      taken.add(s);
      slugs.push(s);
    }
    res.json({ slugs });
  });

  app.get("/comments", (req: Request, res: Response) => {
    const status = req.query.status as "open" | "resolved" | undefined;
    const pageUrl = req.query.pageUrl as string | undefined;
    res.json({ comments: store.list({ status, pageUrl }) });
  });

  app.get("/comments/:id", (req: Request, res: Response) => {
    const c = store.get(req.params.id);
    if (!c) return res.status(404).json({ error: "not found" });
    res.json(c);
  });

  app.delete("/comments/:id", (req: Request, res: Response) => {
    res.json({ deleted: store.delete(req.params.id) });
  });

  app.get("/pages", (_req, res) => res.json({ pages: store.pages() }));

  // --- GitHub integration ------------------------------------------------
  app.use(
    "/github",
    githubRouter({
      comments: store,
      github: githubDeps.github ?? new GithubStore(store.database),
      ...githubDeps,
    }),
  );

  // --- MCP Streamable HTTP endpoint (stateless) -------------------------
  app.post("/mcp", async (req: Request, res: Response) => {
    try {
      const server = buildMcpServer(store);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // stateless: one server per request
      });
      res.on("close", () => {
        void transport.close();
        void server.close();
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });

  // Stateless server: GET/DELETE on /mcp (SSE stream / session teardown) N/A.
  const methodNotAllowed = (_req: Request, res: Response) =>
    res.status(405).json({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Method not allowed (stateless server)" },
      id: null,
    });
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  return app;
}
