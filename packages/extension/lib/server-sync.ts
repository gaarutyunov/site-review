import type { Comment } from "@site-review/shared";
import { loadSettings } from "./settings";

/** Push a comment to the server (best-effort; ignores failures when offline). */
export async function pushComment(c: Comment): Promise<void> {
  const s = await loadSettings();
  if (!s.syncEnabled) return;
  try {
    await fetch(`${s.serverUrl}/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(c),
    });
  } catch {
    // server not running — local store still has it; will not auto-retry
  }
}

export async function deleteOnServer(id: string): Promise<void> {
  const s = await loadSettings();
  if (!s.syncEnabled) return;
  try {
    await fetch(`${s.serverUrl}/comments/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  } catch {
    /* offline */
  }
}

/** Pull all comments from the server (used to reconcile agent-side resolves). */
export async function pullComments(): Promise<Comment[] | null> {
  const s = await loadSettings();
  if (!s.syncEnabled) return null;
  try {
    const res = await fetch(`${s.serverUrl}/comments`);
    if (!res.ok) return null;
    const data = (await res.json()) as { comments: Comment[] };
    return data.comments;
  } catch {
    return null;
  }
}
