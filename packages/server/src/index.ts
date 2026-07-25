import { CommentStore } from "./store.js";
import { createApp } from "./http.js";
import { dbPath, httpPort } from "./config.js";
import { githubConfig } from "./github/config.js";

/** HTTP entry point: REST ingest for the extension + Streamable HTTP MCP. */
const store = new CommentStore(dbPath());
const app = createApp(store);
const port = httpPort();

app.listen(port, () => {
  console.error(`[site-review] HTTP server on http://localhost:${port}`);
  console.error(`[site-review]   REST ingest:  POST http://localhost:${port}/ingest`);
  console.error(`[site-review]   MCP endpoint: POST http://localhost:${port}/mcp`);
  console.error(`[site-review]   GitHub:       ${githubConfig() ? "configured" : "not configured (set GITHUB_APP_CLIENT_ID)"}`);
  console.error(`[site-review]   DB: ${dbPath()}`);
});
