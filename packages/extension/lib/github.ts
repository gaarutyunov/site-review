import type {
  DetectedPr,
  GithubConnectionStatus,
  GithubDeviceCode,
  GithubIssue,
  GithubRepo,
  RepoBinding,
  RepoCandidate,
  SyncResult,
  SyncTarget,
} from "@site-review/shared";
import { sendToBackground } from "./messaging";

/** What `/github/detect` reports back for the current page. */
export interface PageDetection {
  repoCandidates: RepoCandidate[];
  detectedPr: DetectedPr | null;
  binding: RepoBinding | null;
  target: SyncTarget | null;
  prUnavailable?: boolean;
}

export class GithubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(
  path: string,
  init: { method?: "GET" | "POST" | "DELETE"; body?: unknown } = {},
): Promise<T> {
  const res = await sendToBackground({ type: "github", path, ...init });
  if (!res.ok) {
    const detail =
      (res.data as { error?: string; detail?: string } | null)?.error ??
      res.error ??
      `request failed (${res.status})`;
    throw new GithubApiError(detail, res.status);
  }
  return res.data as T;
}

export const github = {
  status: () => call<GithubConnectionStatus>("/github/status"),
  connect: () => call<GithubDeviceCode>("/github/connect", { method: "POST" }),
  disconnect: () => call<unknown>("/github/disconnect", { method: "POST" }),
  repos: () => call<{ repos: GithubRepo[] }>("/github/repos"),
  binding: (pageUrl: string) =>
    call<{ binding: RepoBinding | null }>(
      `/github/binding?pageUrl=${encodeURIComponent(pageUrl)}`,
    ),
  bind: (pageUrl: string, owner: string, repo: string) =>
    call<{ binding: RepoBinding }>("/github/bind", {
      method: "POST",
      body: { pageUrl, owner, repo },
    }),
  unbind: (pageUrl: string) =>
    call<{ deleted: boolean }>(
      `/github/binding?pageUrl=${encodeURIComponent(pageUrl)}`,
      { method: "DELETE" },
    ),
  detect: (pageUrl: string, links: string[], canonicalUrl?: string) =>
    call<PageDetection>("/github/detect", {
      method: "POST",
      body: { pageUrl, links, canonicalUrl },
    }),
  issues: (pageUrl: string) =>
    call<{ issues: GithubIssue[] }>(
      `/github/issues?pageUrl=${encodeURIComponent(pageUrl)}`,
    ),
  sync: (pageUrl: string, pageTitle: string, target: SyncTarget) =>
    call<SyncResult>("/github/sync", {
      method: "POST",
      body: { pageUrl, pageTitle, target },
    }),
};

/**
 * GitHub URLs referenced by the live page. The server does the filtering and
 * ranking — this only has to hand it every link the DOM knows about, which
 * avoids the server re-fetching a page that may be behind auth (design D4).
 */
export function collectRepoLinks(doc: Document = document): string[] {
  const links = new Set<string>();

  for (const a of doc.querySelectorAll<HTMLAnchorElement>('a[href*="github.com"]')) {
    links.add(a.href);
  }
  for (const el of doc.querySelectorAll<HTMLElement>("[data-repo], [data-github]")) {
    const v = el.dataset.repo ?? el.dataset.github;
    if (v) links.add(v.startsWith("http") ? v : `https://github.com/${v}`);
  }
  return [...links];
}

/** The page's canonical URL, which the server ranks candidates against. */
export function canonicalUrl(doc: Document = document): string | undefined {
  const link = doc.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (link?.href) return link.href;
  const og = doc.querySelector<HTMLMetaElement>('meta[property="og:url"]');
  return og?.content || undefined;
}
