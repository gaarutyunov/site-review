import type Database from "better-sqlite3";
import type { RepoBinding, SyncTarget } from "@site-review/shared";

/** The stored GitHub user token. Never leaves the server process. */
export interface StoredAuth {
  login: string;
  accessToken: string;
  tokenExpiresAt?: string | null;
  refreshToken?: string | null;
}

/** One recorded (comment, target) pair — the idempotency ledger (design D5). */
export interface LedgerEntry {
  commentId: string;
  targetKind: SyncTarget["kind"];
  targetRef: string;
  ghUrl: string;
  syncedAt: string;
}

interface AuthRow {
  login: string;
  access_token: string;
  token_expires_at: string | null;
  refresh_token: string | null;
}

interface BindingRow {
  origin: string;
  owner: string;
  repo: string;
  default_branch: string | null;
  updated_at: string;
}

interface LedgerRow {
  comment_id: string;
  target_kind: string;
  target_ref: string;
  gh_url: string;
  synced_at: string;
}

/**
 * The GitHub-side persistence: the single connected account's token, the
 * page-origin → repository bindings, and the sync ledger. Shares the comment
 * store's SQLite connection so everything lives in one file.
 *
 * Token columns are only ever read by `getAuth()`, which is server-internal —
 * no HTTP response is built from it (see `store.test.ts`).
 */
export class GithubStore {
  constructor(private db: Database.Database) {
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS github_auth (
        id               INTEGER PRIMARY KEY CHECK (id = 1),
        login            TEXT NOT NULL,
        access_token     TEXT NOT NULL,
        token_expires_at TEXT,
        refresh_token    TEXT,
        created_at       TEXT NOT NULL,
        updated_at       TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS github_repo_binding (
        origin         TEXT PRIMARY KEY,
        owner          TEXT NOT NULL,
        repo           TEXT NOT NULL,
        default_branch TEXT,
        updated_at     TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS github_sync_ledger (
        comment_id  TEXT NOT NULL,
        target_kind TEXT NOT NULL,
        target_ref  TEXT NOT NULL,
        gh_url      TEXT NOT NULL,
        synced_at   TEXT NOT NULL,
        PRIMARY KEY (comment_id, target_kind, target_ref)
      );
    `);
  }

  // --- auth (single row) -------------------------------------------------

  setAuth(auth: StoredAuth): void {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO github_auth (id, login, access_token, token_expires_at, refresh_token, created_at, updated_at)
         VALUES (1, @login, @access_token, @token_expires_at, @refresh_token, @now, @now)
         ON CONFLICT(id) DO UPDATE SET
           login=excluded.login, access_token=excluded.access_token,
           token_expires_at=excluded.token_expires_at,
           refresh_token=excluded.refresh_token, updated_at=excluded.updated_at`,
      )
      .run({
        login: auth.login,
        access_token: auth.accessToken,
        token_expires_at: auth.tokenExpiresAt ?? null,
        refresh_token: auth.refreshToken ?? null,
        now,
      });
  }

  getAuth(): StoredAuth | undefined {
    const row = this.db
      .prepare(
        `SELECT login, access_token, token_expires_at, refresh_token FROM github_auth WHERE id = 1`,
      )
      .get() as AuthRow | undefined;
    if (!row) return undefined;
    return {
      login: row.login,
      accessToken: row.access_token,
      tokenExpiresAt: row.token_expires_at,
      refreshToken: row.refresh_token,
    };
  }

  /** The connected login, without touching token columns. */
  getLogin(): string | undefined {
    const row = this.db
      .prepare(`SELECT login FROM github_auth WHERE id = 1`)
      .get() as { login: string } | undefined;
    return row?.login;
  }

  clearAuth(): void {
    this.db.prepare(`DELETE FROM github_auth`).run();
  }

  // --- origin → repo bindings -------------------------------------------

  setBinding(b: Omit<RepoBinding, "updatedAt">): RepoBinding {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO github_repo_binding (origin, owner, repo, default_branch, updated_at)
         VALUES (@origin, @owner, @repo, @default_branch, @updated_at)
         ON CONFLICT(origin) DO UPDATE SET
           owner=excluded.owner, repo=excluded.repo,
           default_branch=excluded.default_branch, updated_at=excluded.updated_at`,
      )
      .run({
        origin: b.origin,
        owner: b.owner,
        repo: b.repo,
        default_branch: b.defaultBranch ?? null,
        updated_at: now,
      });
    return this.getBinding(b.origin)!;
  }

  getBinding(origin: string): RepoBinding | undefined {
    const row = this.db
      .prepare(`SELECT * FROM github_repo_binding WHERE origin = ?`)
      .get(origin) as BindingRow | undefined;
    if (!row) return undefined;
    return {
      origin: row.origin,
      owner: row.owner,
      repo: row.repo,
      defaultBranch: row.default_branch ?? undefined,
      updatedAt: row.updated_at,
    };
  }

  deleteBinding(origin: string): boolean {
    return (
      this.db
        .prepare(`DELETE FROM github_repo_binding WHERE origin = ?`)
        .run(origin).changes > 0
    );
  }

  // --- sync ledger -------------------------------------------------------

  /** Comment ids already posted to this target. */
  syncedCommentIds(targetKind: string, targetRef: string): Set<string> {
    const rows = this.db
      .prepare(
        `SELECT comment_id FROM github_sync_ledger WHERE target_kind = ? AND target_ref = ?`,
      )
      .all(targetKind, targetRef) as { comment_id: string }[];
    return new Set(rows.map((r) => r.comment_id));
  }

  recordSync(entries: Omit<LedgerEntry, "syncedAt">[]): void {
    const now = new Date().toISOString();
    const ins = this.db.prepare(
      `INSERT INTO github_sync_ledger (comment_id, target_kind, target_ref, gh_url, synced_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(comment_id, target_kind, target_ref) DO UPDATE SET
         gh_url=excluded.gh_url, synced_at=excluded.synced_at`,
    );
    this.db.transaction(() => {
      for (const e of entries) {
        ins.run(e.commentId, e.targetKind, e.targetRef, e.ghUrl, now);
      }
    })();
  }

  ledgerFor(targetKind: string, targetRef: string): LedgerEntry[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM github_sync_ledger WHERE target_kind = ? AND target_ref = ? ORDER BY synced_at`,
      )
      .all(targetKind, targetRef) as LedgerRow[];
    return rows.map((r) => ({
      commentId: r.comment_id,
      targetKind: r.target_kind as SyncTarget["kind"],
      targetRef: r.target_ref,
      ghUrl: r.gh_url,
      syncedAt: r.synced_at,
    }));
  }
}
