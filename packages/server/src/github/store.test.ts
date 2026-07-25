import { describe, it, expect, beforeEach } from "vitest";
import { CommentStore } from "../store.js";
import { GithubStore } from "./store.js";

describe("GithubStore", () => {
  let comments: CommentStore;
  let github: GithubStore;

  beforeEach(() => {
    comments = new CommentStore(":memory:");
    github = new GithubStore(comments.database);
  });

  it("stores and clears the single auth row", () => {
    expect(github.getAuth()).toBeUndefined();
    github.setAuth({ login: "gaarutyunov", accessToken: "ghu_secret" });
    expect(github.getAuth()).toMatchObject({
      login: "gaarutyunov",
      accessToken: "ghu_secret",
    });
    github.setAuth({ login: "gaarutyunov", accessToken: "ghu_rotated" });
    expect(github.getAuth()?.accessToken).toBe("ghu_rotated");
    github.clearAuth();
    expect(github.getAuth()).toBeUndefined();
    expect(github.getLogin()).toBeUndefined();
  });

  it("exposes the login without reading token columns", () => {
    github.setAuth({ login: "gaarutyunov", accessToken: "ghu_secret" });
    const login = github.getLogin();
    expect(login).toBe("gaarutyunov");
    // The login lookup must not carry token material of any kind.
    expect(JSON.stringify(login)).not.toContain("ghu_secret");
  });

  it("keeps auth rows out of every non-auth read path", () => {
    github.setAuth({ login: "gaarutyunov", accessToken: "ghu_secret" });
    github.setBinding({
      origin: "https://x.github.io",
      owner: "gaarutyunov",
      repo: "site-review",
    });
    github.recordSync([
      {
        commentId: "jumping-koala",
        targetKind: "pr",
        targetRef: "gaarutyunov/site-review#3",
        ghUrl: "https://github.com/gaarutyunov/site-review/pull/3#issuecomment-1",
      },
    ]);

    const readable = JSON.stringify({
      binding: github.getBinding("https://x.github.io"),
      ledger: github.ledgerFor("pr", "gaarutyunov/site-review#3"),
      login: github.getLogin(),
      pages: comments.pages(),
      comments: comments.list(),
    });
    expect(readable).not.toContain("ghu_secret");
    expect(readable).not.toContain("access_token");
  });

  it("stores, replaces and removes an origin binding", () => {
    const b = github.setBinding({
      origin: "https://x.github.io",
      owner: "gaarutyunov",
      repo: "site-review",
      defaultBranch: "main",
    });
    expect(b).toMatchObject({ owner: "gaarutyunov", repo: "site-review" });
    expect(github.getBinding("https://x.github.io")?.repo).toBe("site-review");

    github.setBinding({
      origin: "https://x.github.io",
      owner: "gaarutyunov",
      repo: "boids",
    });
    expect(github.getBinding("https://x.github.io")?.repo).toBe("boids");

    expect(github.deleteBinding("https://x.github.io")).toBe(true);
    expect(github.getBinding("https://x.github.io")).toBeUndefined();
    expect(github.deleteBinding("https://x.github.io")).toBe(false);
  });

  it("records the ledger per (comment, target) and reports synced ids", () => {
    github.recordSync([
      { commentId: "a", targetKind: "pr", targetRef: "o/r#1", ghUrl: "u1" },
      { commentId: "b", targetKind: "pr", targetRef: "o/r#1", ghUrl: "u1" },
      { commentId: "a", targetKind: "pr", targetRef: "o/r#2", ghUrl: "u2" },
    ]);
    expect([...github.syncedCommentIds("pr", "o/r#1")].sort()).toEqual(["a", "b"]);
    expect([...github.syncedCommentIds("pr", "o/r#2")]).toEqual(["a"]);
    expect(github.syncedCommentIds("issue-existing", "o/r#1").size).toBe(0);

    // Re-recording the same pair updates rather than duplicating.
    github.recordSync([
      { commentId: "a", targetKind: "pr", targetRef: "o/r#1", ghUrl: "u3" },
    ]);
    const entries = github.ledgerFor("pr", "o/r#1");
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.commentId === "a")?.ghUrl).toBe("u3");
  });
});
