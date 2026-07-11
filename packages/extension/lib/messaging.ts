import type { Comment } from "@site-review/shared";

/** Requests sent from the content script to the background service worker. */
export type BgRequest =
  | { type: "getComments"; pageUrl: string }
  | { type: "allocateSlugs"; count: number }
  | { type: "saveComment"; comment: Comment }
  | { type: "deleteComment"; id: string };

export interface BgResponseMap {
  getComments: { comments: Comment[] };
  allocateSlugs: { slugs: string[] };
  saveComment: { comment: Comment };
  deleteComment: { ok: boolean };
}

/** Commands the background broadcasts to a tab's content script. */
export type TabCommand = { type: "start-mode"; mode: "single" | "multi" };

export async function sendToBackground<T extends BgRequest["type"]>(
  req: Extract<BgRequest, { type: T }>,
): Promise<BgResponseMap[T]> {
  return (await chrome.runtime.sendMessage(req)) as BgResponseMap[T];
}
