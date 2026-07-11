import Dexie, { type EntityTable } from "dexie";
import type { Comment } from "@site-review/shared";

/**
 * IndexedDB store, owned by the background service worker (content scripts
 * would hit the host page's origin DB instead, so all access goes through
 * runtime messaging). Comments are the local source of truth; the server is a
 * best-effort mirror for AI agents.
 */
const db = new Dexie("site-review") as Dexie & {
  comments: EntityTable<Comment, "id">;
};

db.version(1).stores({
  // indexed fields; targets is a nested array (not indexed)
  comments: "id, pageUrl, status, updatedAt",
});

export async function getComments(pageUrl?: string): Promise<Comment[]> {
  if (pageUrl) {
    return db.comments.where("pageUrl").equals(pageUrl).toArray();
  }
  return db.comments.toArray();
}

export async function putComment(c: Comment): Promise<void> {
  await db.comments.put(c);
}

export async function deleteComment(id: string): Promise<void> {
  await db.comments.delete(id);
}

/** All slugs in use (comment ids + element slugs) to keep new ones unique. */
export async function takenSlugs(): Promise<Set<string>> {
  const all = await db.comments.toArray();
  const set = new Set<string>();
  for (const c of all) {
    set.add(c.id);
    for (const t of c.targets) set.add(t.slug);
  }
  return set;
}

export { db };
