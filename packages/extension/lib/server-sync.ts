import type { Comment } from "@site-review/shared";
import { loadSettings } from "./settings";
import type { GithubProxyResponse } from "./messaging";

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

/**
 * Call the server's `/github/*` API on behalf of a content script. Runs in the
 * background worker (see `BgRequest.github`) so the request isn't subject to
 * the reviewed page's CSP.
 */
export async function githubRequest(req: {
  path: string;
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
}): Promise<GithubProxyResponse> {
  const s = await loadSettings();
  try {
    const res = await fetch(`${s.serverUrl}${req.path}`, {
      method: req.method ?? "GET",
      ...(req.body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(req.body),
          }),
    });
    const data = (await res.json().catch(() => null)) as unknown;
    return { ok: res.ok, status: res.status, data };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: e instanceof Error ? e.message : "server unreachable",
    };
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
