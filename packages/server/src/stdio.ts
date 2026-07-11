import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CommentStore } from "./store.js";
import { buildMcpServer } from "./mcp.js";
import { dbPath } from "./config.js";

/**
 * stdio entry point: lets a local agent (Claude Code, Cursor) spawn the MCP
 * server directly. Reads the SAME SQLite store the HTTP server writes to, so
 * comments ingested from the extension are visible here too.
 */
async function main() {
  const store = new CommentStore(dbPath());
  const server = buildMcpServer(store);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[site-review] MCP stdio server ready (db: ${dbPath()})`);
}

main().catch((err) => {
  console.error("[site-review] fatal:", err);
  process.exit(1);
});
