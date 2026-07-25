import { uniqueSlug, type Comment } from "@site-review/shared";
import { defineBackground } from "wxt/utils/define-background";
import {
  getComments,
  putComment,
  deleteComment,
  takenSlugs,
} from "../lib/db";
import {
  pushComment,
  deleteOnServer,
  pullComments,
  githubRequest,
} from "../lib/server-sync";
import type { BgRequest, TabCommand } from "../lib/messaging";

export default defineBackground(() => {
  // --- content-script requests -----------------------------------------
  chrome.runtime.onMessage.addListener((msg: BgRequest, _sender, sendResponse) => {
    handle(msg).then(sendResponse);
    return true; // keep the message channel open for the async response
  });

  async function handle(msg: BgRequest): Promise<unknown> {
    switch (msg.type) {
      case "getComments":
        return { comments: await getComments(msg.pageUrl) };
      case "allocateSlugs": {
        const taken = await takenSlugs();
        const slugs: string[] = [];
        for (let i = 0; i < msg.count; i++) {
          const s = uniqueSlug(taken);
          taken.add(s);
          slugs.push(s);
        }
        return { slugs };
      }
      case "saveComment":
        await putComment(msg.comment);
        void pushComment(msg.comment);
        return { comment: msg.comment };
      case "deleteComment":
        await deleteComment(msg.id);
        void deleteOnServer(msg.id);
        return { ok: true };
      case "github":
        return githubRequest(msg);
    }
  }

  // --- keyboard commands (browser-level fallback) ----------------------
  chrome.commands.onCommand.addListener(async (command) => {
    const mode =
      command === "toggle-multi-mode" ? "multi" : command === "toggle-comment-mode" ? "single" : null;
    if (!mode) return;
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      const cmd: TabCommand = { type: "start-mode", mode };
      chrome.tabs.sendMessage(tab.id, cmd).catch(() => {});
    }
  });

  // --- reconcile agent-side changes on startup -------------------------
  void reconcile();
  async function reconcile() {
    const remote = await pullComments();
    if (!remote) return;
    for (const r of remote) {
      // Only let the server win on status (agents resolve); keep local text.
      const local = (await getComments(r.pageUrl)).find((c) => c.id === r.id);
      if (local && local.status !== r.status) {
        await putComment({ ...local, status: r.status, resolvedAt: r.resolvedAt });
      } else if (!local) {
        await putComment(r as Comment);
      }
    }
  }
});
