/**
 * Types shared between the server's GitHub integration and the extension UI
 * that drives it. The server owns the GitHub credentials; the extension only
 * ever sees the shapes below — never a token.
 */

/** Result of `GET /github/status`. Never carries token material. */
export interface GithubConnectionStatus {
  /** False when `GITHUB_APP_CLIENT_ID` is unset — `/github/*` is inert. */
  configured: boolean;
  authenticated: boolean;
  /** GitHub login of the connected user, when authenticated. */
  login?: string;
  /** A device flow is in progress and awaiting the user's authorization. */
  pending?: boolean;
  /** Why the last flow failed (denied, expired, …) when not authenticated. */
  reason?: string;
}

/** What `POST /github/connect` hands back so the user can authorize. */
export interface GithubDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  /** Seconds the client should wait between status polls. */
  interval: number;
}

/** A repository the connected user can act on. */
export interface GithubRepo {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
}

/** Persisted page-origin → repository connection. */
export interface RepoBinding {
  origin: string;
  owner: string;
  repo: string;
  defaultBranch?: string;
  updatedAt: string;
}

/** A `owner/repo` discovered in the reviewed page's HTML. */
export interface RepoCandidate {
  owner: string;
  repo: string;
  /** How many times the repo was referenced by the page. */
  occurrences: number;
  /** Ranking score — higher is a more likely match. */
  score: number;
}

/** A PR number parsed out of the reviewed page's URL path. */
export interface DetectedPr {
  number: number;
  /** The path segment the number came from, e.g. "pr-preview/pr-3/". */
  source: string;
}

/** Result of `POST /github/detect`. */
export interface DetectionResult {
  repoCandidates: RepoCandidate[];
  detectedPr: DetectedPr | null;
}

/** An open issue offered in the "append to existing issue" picker. */
export interface GithubIssue {
  number: number;
  title: string;
  url: string;
}

/** Where a sync will post. `pr` is proposed by detection; issues are chosen. */
export type SyncTarget =
  | { kind: "pr"; number: number }
  | { kind: "issue-existing"; number: number }
  | { kind: "issue-new"; title?: string };

/** A GitHub artifact a sync created. */
export interface SyncLink {
  url: string;
  /** Comment ids covered by this artifact. */
  commentIds: string[];
}

/** Result of `POST /github/sync`. */
export interface SyncResult {
  /** Comments newly posted to GitHub by this sync. */
  synced: number;
  /** Comments skipped because the ledger says they were already posted. */
  skipped: number;
  links: SyncLink[];
  target?: SyncTarget;
}

/**
 * Parse a pull-request number out of a reviewed page's URL. Matches the
 * `rossjrw/pr-preview-action` convention, e.g.
 * `https://user.github.io/repo/pr-preview/pr-3/index.html` → PR #3.
 */
export function parsePrPath(pageUrl: string): DetectedPr | null {
  let path: string;
  try {
    path = new URL(pageUrl).pathname;
  } catch {
    path = pageUrl;
  }
  const m = /(^|\/)pr-preview\/pr-(\d+)(\/|$)/.exec(path);
  if (!m) return null;
  const number = Number(m[2]);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return { number, source: `pr-preview/pr-${number}/` };
}
