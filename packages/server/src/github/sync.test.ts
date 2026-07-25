import { describe, it, expect, beforeEach } from "vitest";
import type { Comment, RepoBinding } from "@site-review/shared";
import { CommentStore } from "../store.js";
import { GithubStore } from "./store.js";
import { renderBody, syncComments, targetRef } from "./sync.js";
import type { GithubClient } from "./client.js";

const binding: RepoBinding = {
  origin: "https://gaarutyunov.github.io",
  owner: "gaarutyunov",
  repo: "site-review",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const PAGE = "https://gaarutyunov.github.io/site-review/pr-preview/pr-3/";

function comment(id: string, over: Partial<Comment> = {}): Comment {
  return {
    id,
    pageUrl: PAGE,
    pageTitle: "Site Review",
    text: `fix the button (${id})`,
    status: "open",
    targets: [
      { slug: "dancing-gorilla", cssSelector: "button.cta", textSnippet: "Sign up" },
    ],
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

/** Records every call so tests can assert what was (not) posted. */
class FakeGithubClient implements GithubClient {
  reviews: { number: number; body: string }[] = [];
  issueComments: { number: number; body: string }[] = [];
  issues: { title: string; body: string }[] = [];
  private nextIssue = 100;

  async whoami() {
    return "gaarutyunov";
  }
  async listRepos() {
    return [];
  }
  async prExists() {
    return true;
  }
  async listOpenIssues() {
    return [];
  }
  async createPrReview(_o: string, _r: string, number: number, body: string) {
    this.reviews.push({ number, body });
    return `https://github.com/gaarutyunov/site-review/pull/${number}#pullrequestreview-${this.reviews.length}`;
  }
  async createIssueComment(_o: string, _r: string, number: number, body: string) {
    this.issueComments.push({ number, body });
    return `https://github.com/gaarutyunov/site-review/issues/${number}#issuecomment-${this.issueComments.length}`;
  }
  async createIssue(_o: string, _r: string, title: string, body: string) {
    this.issues.push({ title, body });
    const number = this.nextIssue++;
    return {
      number,
      url: `https://github.com/gaarutyunov/site-review/issues/${number}`,
    };
  }
  get calls() {
    return this.reviews.length + this.issueComments.length + this.issues.length;
  }
}

describe("renderBody", () => {
  it("identifies each comment by element slug and the reviewed page", () => {
    const body = renderBody([comment("jumping-koala")], PAGE, "Site Review");
    expect(body).toContain("dancing-gorilla");
    expect(body).toContain(PAGE);
    expect(body).toContain("fix the button (jumping-koala)");
  });
});

describe("targetRef", () => {
  it("keys PRs and issues by number, and a new issue by page", () => {
    expect(targetRef(binding, { kind: "pr", number: 3 }, PAGE)).toBe(
      "gaarutyunov/site-review#3",
    );
    expect(
      targetRef(binding, { kind: "issue-existing", number: 7 }, PAGE),
    ).toBe("gaarutyunov/site-review#7");
    expect(targetRef(binding, { kind: "issue-new" }, PAGE)).toContain("#new:");
  });
});

describe("syncComments", () => {
  let comments: CommentStore;
  let ledger: GithubStore;
  let client: FakeGithubClient;

  beforeEach(() => {
    comments = new CommentStore(":memory:");
    ledger = new GithubStore(comments.database);
    client = new FakeGithubClient();
  });

  it("posts the page's open comments to the detected PR", async () => {
    const res = await syncComments({
      comments: [comment("jumping-koala"), comment("witty-lynx")],
      binding,
      pageUrl: PAGE,
      target: { kind: "pr", number: 3 },
      client,
      ledger,
    });
    expect(res.synced).toBe(2);
    expect(res.skipped).toBe(0);
    expect(client.reviews).toHaveLength(1);
    expect(client.reviews[0].number).toBe(3);
    expect(res.links[0].commentIds.sort()).toEqual(["jumping-koala", "witty-lynx"]);
    expect(res.links[0].url).toContain("/pull/3");
  });

  it("appends to an existing issue when one is chosen", async () => {
    const res = await syncComments({
      comments: [comment("jumping-koala")],
      binding,
      pageUrl: PAGE,
      target: { kind: "issue-existing", number: 7 },
      client,
      ledger,
    });
    expect(client.issueComments).toEqual([
      { number: 7, body: expect.stringContaining("jumping-koala") },
    ]);
    expect(res.links[0].url).toContain("/issues/7");
  });

  it("creates a new issue whose title and body come from the comments", async () => {
    const res = await syncComments({
      comments: [comment("jumping-koala")],
      binding,
      pageUrl: PAGE,
      pageTitle: "BikeNav",
      target: { kind: "issue-new" },
      client,
      ledger,
    });
    expect(client.issues).toHaveLength(1);
    expect(client.issues[0].title).toBe("Site Review: BikeNav");
    expect(client.issues[0].body).toContain("fix the button (jumping-koala)");
    expect(res.synced).toBe(1);
    expect(res.links[0].url).toMatch(/\/issues\/\d+$/);
  });

  it("creates nothing and reports nothing to sync for a page with no open comments", async () => {
    const res = await syncComments({
      comments: [comment("done", { status: "resolved" })],
      binding,
      pageUrl: PAGE,
      target: { kind: "pr", number: 3 },
      client,
      ledger,
    });
    expect(res).toMatchObject({ synced: 0, skipped: 0, links: [] });
    expect(client.calls).toBe(0);
  });

  it("posts nothing on a re-sync when no comment changed", async () => {
    const page = [comment("jumping-koala")];
    const args = {
      comments: page,
      binding,
      pageUrl: PAGE,
      target: { kind: "pr" as const, number: 3 },
      client,
      ledger,
    };
    await syncComments(args);
    const again = await syncComments(args);
    expect(again.synced).toBe(0);
    expect(again.skipped).toBe(1);
    expect(client.reviews).toHaveLength(1);
  });

  it("posts exactly the one comment added since the last sync", async () => {
    await syncComments({
      comments: [comment("jumping-koala")],
      binding,
      pageUrl: PAGE,
      target: { kind: "pr", number: 3 },
      client,
      ledger,
    });
    const res = await syncComments({
      comments: [comment("jumping-koala"), comment("witty-lynx")],
      binding,
      pageUrl: PAGE,
      target: { kind: "pr", number: 3 },
      client,
      ledger,
    });
    expect(res.synced).toBe(1);
    expect(res.skipped).toBe(1);
    expect(client.reviews).toHaveLength(2);
    expect(client.reviews[1].body).toContain("witty-lynx");
    expect(client.reviews[1].body).not.toContain("(jumping-koala)");
  });

  it("does not repeat a new issue's comments when later appending to that issue", async () => {
    const page = [comment("jumping-koala")];
    const created = await syncComments({
      comments: page,
      binding,
      pageUrl: PAGE,
      target: { kind: "issue-new" },
      client,
      ledger,
    });
    const number = Number(/\/issues\/(\d+)$/.exec(created.links[0].url)![1]);
    const appended = await syncComments({
      comments: page,
      binding,
      pageUrl: PAGE,
      target: { kind: "issue-existing", number },
      client,
      ledger,
    });
    expect(appended.synced).toBe(0);
    expect(client.issueComments).toHaveLength(0);
  });

  it("tracks PR and issue targets independently", async () => {
    const page = [comment("jumping-koala")];
    await syncComments({
      comments: page,
      binding,
      pageUrl: PAGE,
      target: { kind: "pr", number: 3 },
      client,
      ledger,
    });
    const issue = await syncComments({
      comments: page,
      binding,
      pageUrl: PAGE,
      target: { kind: "issue-existing", number: 7 },
      client,
      ledger,
    });
    expect(issue.synced).toBe(1);
  });
});
