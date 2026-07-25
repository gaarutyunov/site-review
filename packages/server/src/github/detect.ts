import {
  parsePrPath,
  type DetectedPr,
  type RepoBinding,
  type RepoCandidate,
  type SyncTarget,
} from "@site-review/shared";

/**
 * Path segments that look like `github.com/<a>/<b>` but never name a repo.
 * Anything whose first segment is here is dropped outright.
 */
const NON_REPO_OWNERS = new Set([
  "features",
  "login",
  "logout",
  "join",
  "signup",
  "sponsors",
  "settings",
  "marketplace",
  "pricing",
  "about",
  "site",
  "security",
  "topics",
  "collections",
  "trending",
  "explore",
  "readme",
  "customer-stories",
  "enterprise",
  "notifications",
  "codespaces",
  "apps",
  "orgs",
  "users",
  "search",
  "new",
  "contact",
  "solutions",
  "resources",
  "events",
  "sitemap.xml",
]);

/** Hosts whose `/owner/repo` paths are not repositories. */
const NON_REPO_HOSTS = new Set([
  "gist.github.com",
  "docs.github.com",
  "support.github.com",
  "blog.github.com",
  "raw.githubusercontent.com",
]);

const REPO_URL_RE =
  /https?:\/\/(?:www\.)?([a-z0-9.-]*github(?:usercontent)?\.com)\/([A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)\/([A-Za-z0-9._-]+)/g;

/** Repo names that are really a path suffix of an owner-only link. */
function isRepoName(name: string): boolean {
  if (!name || name === "." || name === "..") return false;
  if (/\.(png|jpe?g|svg|gif|webp|css|js|json|xml|txt|ico)$/i.test(name)) {
    return false;
  }
  return true;
}

function stripRepoSuffix(name: string): string {
  return name.replace(/\.git$/, "");
}

/**
 * Extract `owner/repo` candidates from a page's HTML (or from a list of link
 * hrefs the extension already collected from the live DOM). Non-repository
 * GitHub paths are filtered, duplicates are merged, and the result is ranked so
 * the most-referenced repository comes first.
 *
 * `preferOwner` (the connected GitHub login) boosts the user's own repos, which
 * is almost always the one being reviewed.
 */
export function extractRepoCandidates(
  sources: string | string[],
  opts: { preferOwner?: string; canonicalUrl?: string } = {},
): RepoCandidate[] {
  const haystack = (Array.isArray(sources) ? sources : [sources]).join("\n");
  const counts = new Map<string, RepoCandidate>();

  for (const m of haystack.matchAll(REPO_URL_RE)) {
    const [, host, owner, rawRepo] = m;
    if (NON_REPO_HOSTS.has(host.toLowerCase())) continue;
    if (NON_REPO_OWNERS.has(owner.toLowerCase())) continue;
    const repo = stripRepoSuffix(rawRepo);
    if (!isRepoName(repo)) continue;

    const key = `${owner.toLowerCase()}/${repo.toLowerCase()}`;
    const existing = counts.get(key);
    if (existing) existing.occurrences++;
    else counts.set(key, { owner, repo, occurrences: 1, score: 0 });
  }

  const canonical = opts.canonicalUrl
    ? extractRepoCandidates(opts.canonicalUrl)[0]
    : undefined;

  const ranked = [...counts.values()].map((c) => {
    let score = c.occurrences;
    if (opts.preferOwner && c.owner.toLowerCase() === opts.preferOwner.toLowerCase()) {
      score += 10;
    }
    if (
      canonical &&
      canonical.owner.toLowerCase() === c.owner.toLowerCase() &&
      canonical.repo.toLowerCase() === c.repo.toLowerCase()
    ) {
      score += 20;
    }
    return { ...c, score };
  });

  ranked.sort(
    (a, b) =>
      b.score - a.score ||
      b.occurrences - a.occurrences ||
      `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );
  return ranked;
}

/** Re-exported so callers get repo + PR detection from one module. */
export { parsePrPath };
export type { DetectedPr };

/** Verifies a detected PR actually exists in the connected repository. */
export interface PrVerifier {
  (owner: string, repo: string, number: number): Promise<boolean>;
}

/**
 * Combine the binding with the page URL to decide where a sync should go:
 * a verified PR when the URL carries a `pr-preview/pr-N/` segment, otherwise
 * issue mode (the user then picks an existing issue or a new one).
 */
export async function resolveSyncTarget(
  binding: RepoBinding | undefined,
  pageUrl: string,
  verifyPr?: PrVerifier,
): Promise<{
  target: SyncTarget | null;
  detectedPr: DetectedPr | null;
  /** Set when a PR was parsed from the path but is not usable. */
  prUnavailable?: boolean;
}> {
  const detectedPr = parsePrPath(pageUrl);
  if (!binding) return { target: null, detectedPr };
  if (!detectedPr) return { target: { kind: "issue-new" }, detectedPr: null };

  const exists = verifyPr
    ? await verifyPr(binding.owner, binding.repo, detectedPr.number)
    : true;
  if (!exists) {
    return { target: { kind: "issue-new" }, detectedPr, prUnavailable: true };
  }
  return { target: { kind: "pr", number: detectedPr.number }, detectedPr };
}
