import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  type Comment,
  type CommentStatus,
  type CommentUpsert,
  type ElementTarget,
  normalizeUrl,
} from "@site-review/shared";

interface CommentRow {
  id: string;
  page_url: string;
  page_title: string | null;
  text: string;
  status: CommentStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

interface ElementRow {
  comment_id: string;
  slug: string;
  css_selector: string;
  text_snippet: string | null;
  tag_name: string | null;
  attributes: string | null;
  nth_path: string | null;
}

/**
 * SQLite-backed comment store. One `comments` row per comment; one
 * `comment_elements` row per targeted element (>1 row = a grouped comment).
 */
export class CommentStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  /**
   * The underlying connection, so sibling stores (e.g. `GithubStore`) can share
   * one database file — and one `:memory:` database in tests.
   */
  get database(): Database.Database {
    return this.db;
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id          TEXT PRIMARY KEY,
        page_url    TEXT NOT NULL,
        page_title  TEXT,
        text        TEXT NOT NULL,
        status      TEXT NOT NULL DEFAULT 'open',
        created_at  TEXT NOT NULL,
        updated_at  TEXT NOT NULL,
        resolved_at TEXT
      );
      CREATE TABLE IF NOT EXISTS comment_elements (
        comment_id   TEXT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
        slug         TEXT NOT NULL,
        css_selector TEXT NOT NULL,
        text_snippet TEXT,
        tag_name     TEXT,
        attributes   TEXT,
        nth_path     TEXT,
        PRIMARY KEY (comment_id, slug)
      );
      CREATE INDEX IF NOT EXISTS idx_comments_url    ON comments(page_url);
      CREATE INDEX IF NOT EXISTS idx_comments_status ON comments(status);
      CREATE INDEX IF NOT EXISTS idx_elements_slug   ON comment_elements(slug);
    `);
  }

  /** All element slugs currently in use, to keep generated slugs unique. */
  takenSlugs(): Set<string> {
    const rows = this.db
      .prepare(`SELECT slug FROM comment_elements`)
      .all() as { slug: string }[];
    const ids = this.db
      .prepare(`SELECT id FROM comments`)
      .all() as { id: string }[];
    return new Set([...rows.map((r) => r.slug), ...ids.map((r) => r.id)]);
  }

  private hydrate(row: CommentRow): Comment {
    const els = this.db
      .prepare(`SELECT * FROM comment_elements WHERE comment_id = ?`)
      .all(row.id) as ElementRow[];
    const targets: ElementTarget[] = els.map((e) => ({
      slug: e.slug,
      cssSelector: e.css_selector,
      textSnippet: e.text_snippet ?? undefined,
      tagName: e.tag_name ?? undefined,
      attributes: e.attributes ? JSON.parse(e.attributes) : undefined,
      nthPath: e.nth_path ?? undefined,
    }));
    return {
      id: row.id,
      pageUrl: row.page_url,
      pageTitle: row.page_title ?? undefined,
      text: row.text,
      status: row.status,
      targets,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      resolvedAt: row.resolved_at,
    };
  }

  /** Insert or replace a comment and its element targets atomically. */
  upsert(input: CommentUpsert): Comment {
    const now = new Date().toISOString();
    const existing = this.db
      .prepare(`SELECT created_at FROM comments WHERE id = ?`)
      .get(input.id) as { created_at: string } | undefined;
    const createdAt = existing?.created_at ?? input.createdAt ?? now;
    const status: CommentStatus = input.status ?? "open";

    const tx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO comments (id, page_url, page_title, text, status, created_at, updated_at, resolved_at)
           VALUES (@id, @page_url, @page_title, @text, @status, @created_at, @updated_at, @resolved_at)
           ON CONFLICT(id) DO UPDATE SET
             page_url=excluded.page_url, page_title=excluded.page_title,
             text=excluded.text, status=excluded.status,
             updated_at=excluded.updated_at, resolved_at=excluded.resolved_at`,
        )
        .run({
          id: input.id,
          page_url: normalizeUrl(input.pageUrl),
          page_title: input.pageTitle ?? null,
          text: input.text,
          status,
          created_at: createdAt,
          updated_at: now,
          resolved_at:
            status === "resolved" ? (input.resolvedAt ?? now) : null,
        });

      this.db
        .prepare(`DELETE FROM comment_elements WHERE comment_id = ?`)
        .run(input.id);
      const insEl = this.db.prepare(
        `INSERT INTO comment_elements (comment_id, slug, css_selector, text_snippet, tag_name, attributes, nth_path)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const t of input.targets) {
        insEl.run(
          input.id,
          t.slug,
          t.cssSelector,
          t.textSnippet ?? null,
          t.tagName ?? null,
          t.attributes ? JSON.stringify(t.attributes) : null,
          t.nthPath ?? null,
        );
      }
    });
    tx();
    return this.get(input.id)!;
  }

  get(id: string): Comment | undefined {
    const row = this.db
      .prepare(`SELECT * FROM comments WHERE id = ?`)
      .get(id) as CommentRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  list(opts: { status?: CommentStatus; pageUrl?: string } = {}): Comment[] {
    const where: string[] = [];
    const params: Record<string, string> = {};
    if (opts.status) {
      where.push(`status = @status`);
      params.status = opts.status;
    }
    if (opts.pageUrl) {
      where.push(`page_url = @page_url`);
      params.page_url = normalizeUrl(opts.pageUrl);
    }
    const sql = `SELECT * FROM comments ${
      where.length ? "WHERE " + where.join(" AND ") : ""
    } ORDER BY created_at DESC`;
    const rows = this.db.prepare(sql).all(params) as CommentRow[];
    return rows.map((r) => this.hydrate(r));
  }

  search(query: string): Comment[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare(
        `SELECT DISTINCT c.* FROM comments c
         LEFT JOIN comment_elements e ON e.comment_id = c.id
         WHERE c.text LIKE ? OR e.text_snippet LIKE ? OR e.slug LIKE ?
         ORDER BY c.created_at DESC`,
      )
      .all(like, like, like) as CommentRow[];
    return rows.map((r) => this.hydrate(r));
  }

  setStatus(id: string, status: CommentStatus): Comment | undefined {
    const now = new Date().toISOString();
    const res = this.db
      .prepare(
        `UPDATE comments SET status = ?, updated_at = ?, resolved_at = ? WHERE id = ?`,
      )
      .run(status, now, status === "resolved" ? now : null, id);
    return res.changes ? this.get(id) : undefined;
  }

  delete(id: string): boolean {
    return (
      this.db.prepare(`DELETE FROM comments WHERE id = ?`).run(id).changes > 0
    );
  }

  /** Distinct page URLs that have at least one comment. */
  pages(): { pageUrl: string; count: number }[] {
    return this.db
      .prepare(
        `SELECT page_url AS pageUrl, COUNT(*) AS count FROM comments GROUP BY page_url ORDER BY count DESC`,
      )
      .all() as { pageUrl: string; count: number }[];
  }
}
