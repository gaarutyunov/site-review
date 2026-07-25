import type { Comment } from "@site-review/shared";

/** Requests sent from the content script to the background service worker. */
export type BgRequest =
  | { type: "getComments"; pageUrl: string }
  | { type: "allocateSlugs"; count: number }
  | { type: "saveComment"; comment: Comment }
  | { type: "deleteComment"; id: string }
  | {
      /**
       * Proxy a call to the server's /github/* API. Content scripts run under
       * the page's CSP, so every server request goes through the background
       * worker, which holds the localhost host permission.
       */
      type: "github";
      path: string;
      method?: "GET" | "POST" | "DELETE";
      body?: unknown;
    };

/** Outcome of a proxied /github/* call. `data` is the parsed JSON body. */
export interface GithubProxyResponse {
  ok: boolean;
  /** 0 when the server could not be reached at all. */
  status: number;
  data: unknown;
  error?: string;
}

export interface BgResponseMap {
  getComments: { comments: Comment[] };
  allocateSlugs: { slugs: string[] };
  saveComment: { comment: Comment };
  deleteComment: { ok: boolean };
  github: GithubProxyResponse;
}

/** Commands the background broadcasts to a tab's content script. */
export type TabCommand = { type: "start-mode"; mode: "single" | "multi" };

export async function sendToBackground<T extends BgRequest["type"]>(
  req: Extract<BgRequest, { type: T }>,
): Promise<BgResponseMap[T]> {
  return (await chrome.runtime.sendMessage(req)) as BgResponseMap[T];
}
