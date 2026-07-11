import { homedir } from "node:os";
import { join } from "node:path";

/** Resolve the SQLite DB path: env override or ~/.site-review/comments.db. */
export function dbPath(): string {
  return (
    process.env.SITE_REVIEW_DB ?? join(homedir(), ".site-review", "comments.db")
  );
}

export function httpPort(): number {
  return Number(process.env.SITE_REVIEW_PORT) || 4711;
}
