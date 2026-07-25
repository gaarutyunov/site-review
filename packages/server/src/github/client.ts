import { Octokit } from "@octokit/rest";
import type { GithubIssue, GithubRepo } from "@site-review/shared";

/**
 * The slice of GitHub the integration actually uses. Kept as an interface so
 * the sync logic can be exercised against a fake in tests (design D2/D5).
 */
export interface GithubClient {
  /** Login of the authenticated user. */
  whoami(): Promise<string>;
  listRepos(): Promise<GithubRepo[]>;
  /** True when the PR number exists in the repo (any state). */
  prExists(owner: string, repo: string, number: number): Promise<boolean>;
  listOpenIssues(owner: string, repo: string): Promise<GithubIssue[]>;
  /** Post a PR review with `body`; returns its html_url. */
  createPrReview(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<string>;
  /** Append a comment to an issue; returns its html_url. */
  createIssueComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<string>;
  createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<{ number: number; url: string }>;
}

/** Octokit-backed client built from the stored user access token. */
export class OctokitGithubClient implements GithubClient {
  private octokit: Octokit;

  constructor(token: string) {
    this.octokit = new Octokit({ auth: token });
  }

  async whoami(): Promise<string> {
    const { data } = await this.octokit.users.getAuthenticated();
    return data.login;
  }

  async listRepos(): Promise<GithubRepo[]> {
    // A GitHub App user token sees repositories through its installations;
    // fall back to the plain user-repo listing when the App route is not
    // available (e.g. a classic OAuth token).
    try {
      const installations =
        await this.octokit.apps.listInstallationsForAuthenticatedUser({
          per_page: 100,
        });
      const repos: GithubRepo[] = [];
      for (const inst of installations.data.installations) {
        const pages = await this.octokit.paginate(
          this.octokit.apps.listInstallationReposForAuthenticatedUser,
          { installation_id: inst.id, per_page: 100 },
        );
        for (const r of pages) {
          repos.push({
            owner: r.owner.login,
            repo: r.name,
            defaultBranch: r.default_branch,
            private: r.private,
          });
        }
      }
      if (repos.length) return dedupeRepos(repos);
    } catch {
      // fall through to the user-repo listing
    }
    const owned = await this.octokit.paginate(
      this.octokit.repos.listForAuthenticatedUser,
      { per_page: 100, sort: "pushed" },
    );
    return dedupeRepos(
      owned.map((r) => ({
        owner: r.owner.login,
        repo: r.name,
        defaultBranch: r.default_branch ?? "main",
        private: r.private,
      })),
    );
  }

  async prExists(owner: string, repo: string, number: number): Promise<boolean> {
    try {
      await this.octokit.pulls.get({ owner, repo, pull_number: number });
      return true;
    } catch {
      return false;
    }
  }

  async listOpenIssues(owner: string, repo: string): Promise<GithubIssue[]> {
    const issues = await this.octokit.paginate(
      this.octokit.issues.listForRepo,
      { owner, repo, state: "open", per_page: 100 },
    );
    return issues
      .filter((i) => !i.pull_request) // the issues API also returns PRs
      .map((i) => ({ number: i.number, title: i.title, url: i.html_url }));
  }

  async createPrReview(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<string> {
    const { data } = await this.octokit.pulls.createReview({
      owner,
      repo,
      pull_number: number,
      body,
      event: "COMMENT",
    });
    return data.html_url;
  }

  async createIssueComment(
    owner: string,
    repo: string,
    number: number,
    body: string,
  ): Promise<string> {
    const { data } = await this.octokit.issues.createComment({
      owner,
      repo,
      issue_number: number,
      body,
    });
    return data.html_url;
  }

  async createIssue(
    owner: string,
    repo: string,
    title: string,
    body: string,
  ): Promise<{ number: number; url: string }> {
    const { data } = await this.octokit.issues.create({
      owner,
      repo,
      title,
      body,
    });
    return { number: data.number, url: data.html_url };
  }
}

function dedupeRepos(repos: GithubRepo[]): GithubRepo[] {
  const seen = new Map<string, GithubRepo>();
  for (const r of repos) {
    seen.set(`${r.owner.toLowerCase()}/${r.repo.toLowerCase()}`, r);
  }
  return [...seen.values()].sort((a, b) =>
    `${a.owner}/${a.repo}`.localeCompare(`${b.owner}/${b.repo}`),
  );
}
