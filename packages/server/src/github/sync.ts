import {
  normalizeUrl,
  type Comment,
  type RepoBinding,
  type SyncResult,
  type SyncTarget,
} from "@site-review/shared";
import type { GithubClient } from "./client.js";
import type { GithubStore } from "./store.js";

/**
 * The ledger key for a target (design D5). A "new issue" has no number yet, so
 * it is keyed by the reviewed page — re-syncing the same page to a new issue
 * therefore only ever carries comments that were never posted.
 */
export function targetRef(
  binding: RepoBinding,
  target: SyncTarget,
  pageUrl: string,
): string {
  const repo = `${binding.owner}/${binding.repo}`;
  switch (target.kind) {
    case "pr":
    case "issue-existing":
      return `${repo}#${target.number}`;
    case "issue-new":
      return `${repo}#new:${normalizeUrl(pageUrl)}`;
  }
}

/** Markdown for one Site Review comment: its elements, then its text. */
function renderComment(c: Comment): string {
  const slugs = c.targets.map((t) => `\`${t.slug}\``).join(", ");
  const snippet = c.targets.find((t) => t.textSnippet)?.textSnippet;
  const where = slugs
    ? `**${slugs}**${snippet ? ` — _${truncate(snippet, 80)}_` : ""}`
    : "**(page)**";
  const text = c.text.trim() || "_(empty comment)_";
  return `- ${where}\n\n  ${text.split("\n").join("\n  ")}`;
}

/**
 * The body posted to GitHub. Every comment carries its element slug and the
 * reviewed page URL, so a reader on GitHub knows exactly what was commented on
 * (github-comment-sync: "Comment carries element context").
 */
export function renderBody(
  comments: Comment[],
  pageUrl: string,
  pageTitle?: string,
): string {
  const header = pageTitle
    ? `**[${pageTitle}](${pageUrl})**`
    : `**${pageUrl}**`;
  return [
    `### Site Review comments`,
    ``,
    `Reviewed page: ${header}`,
    ``,
    comments.map(renderComment).join("\n\n"),
    ``,
    `<sub>Posted by [Site Review](https://github.com/gaarutyunov/site-review) — element handles above refer to elements on the reviewed page.</sub>`,
  ].join("\n");
}

function truncate(s: string, n: number): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat;
}

function issueTitle(target: SyncTarget, pageUrl: string, pageTitle?: string): string {
  if (target.kind === "issue-new" && target.title?.trim()) {
    return target.title.trim();
  }
  return `Site Review: ${pageTitle?.trim() || pageUrl}`;
}

/**
 * Post a page's open comments to the resolved target, skipping anything the
 * ledger already recorded for it, and record what was created so a re-sync
 * posts nothing (github-comment-sync: "Idempotent, non-duplicating sync").
 */
export async function syncComments(opts: {
  comments: Comment[];
  binding: RepoBinding;
  pageUrl: string;
  pageTitle?: string;
  target: SyncTarget;
  client: GithubClient;
  ledger: GithubStore;
}): Promise<SyncResult> {
  const { binding, target, client, ledger, pageUrl, pageTitle } = opts;
  const open = opts.comments.filter((c) => c.status === "open");
  const ref = targetRef(binding, target, pageUrl);
  const already = ledger.syncedCommentIds(target.kind, ref);
  const fresh = open.filter((c) => !already.has(c.id));
  const skipped = open.length - fresh.length;

  if (fresh.length === 0) {
    return { synced: 0, skipped, links: [], target };
  }

  const body = renderBody(fresh, pageUrl, pageTitle);
  const commentIds = fresh.map((c) => c.id);
  const { owner, repo } = binding;

  let url: string;
  let alsoRecord: { kind: SyncTarget["kind"]; ref: string } | null = null;

  switch (target.kind) {
    case "pr":
      url = await client.createPrReview(owner, repo, target.number, body);
      break;
    case "issue-existing":
      url = await client.createIssueComment(owner, repo, target.number, body);
      break;
    case "issue-new": {
      const created = await client.createIssue(
        owner,
        repo,
        issueTitle(target, pageUrl, pageTitle),
        body,
      );
      url = created.url;
      // Also key the ledger by the issue that now exists, so a later
      // "append to issue #N" doesn't repeat what the new issue already holds.
      alsoRecord = {
        kind: "issue-existing",
        ref: `${owner}/${repo}#${created.number}`,
      };
      break;
    }
  }

  ledger.recordSync(
    commentIds.map((commentId) => ({
      commentId,
      targetKind: target.kind,
      targetRef: ref,
      ghUrl: url,
    })),
  );
  const extra = alsoRecord;
  if (extra) {
    ledger.recordSync(
      commentIds.map((commentId) => ({
        commentId,
        targetKind: extra.kind,
        targetRef: extra.ref,
        ghUrl: url,
      })),
    );
  }

  return {
    synced: fresh.length,
    skipped,
    links: [{ url, commentIds }],
    target,
  };
}
