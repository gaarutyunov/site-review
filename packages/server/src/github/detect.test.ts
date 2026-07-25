import { describe, it, expect } from "vitest";
import { extractRepoCandidates, resolveSyncTarget } from "./detect.js";
import type { RepoBinding } from "@site-review/shared";

const binding: RepoBinding = {
  origin: "https://gaarutyunov.github.io",
  owner: "gaarutyunov",
  repo: "site-review",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("extractRepoCandidates", () => {
  it("finds a single repo link in page HTML", () => {
    const html = `<footer><a href="https://github.com/gaarutyunov/site-review">Source</a></footer>`;
    expect(extractRepoCandidates(html)).toEqual([
      { owner: "gaarutyunov", repo: "site-review", occurrences: 1, score: 1 },
    ]);
  });

  it("returns every distinct repo when the page references several", () => {
    const html = `
      <a href="https://github.com/gaarutyunov/site-review">a</a>
      <a href="https://github.com/gaarutyunov/site-review/issues/2">b</a>
      <a href="https://github.com/rossjrw/pr-preview-action">c</a>`;
    const found = extractRepoCandidates(html);
    expect(found.map((c) => `${c.owner}/${c.repo}`)).toEqual([
      "gaarutyunov/site-review",
      "rossjrw/pr-preview-action",
    ]);
    expect(found[0].occurrences).toBe(2);
  });

  it("reports nothing when the page has no GitHub repo link", () => {
    expect(extractRepoCandidates(`<a href="https://example.com/x">x</a>`)).toEqual(
      [],
    );
  });

  it("filters non-repository GitHub paths", () => {
    const html = `
      <a href="https://github.com/features/actions">features</a>
      <a href="https://github.com/login?return_to=%2F">login</a>
      <a href="https://github.com/sponsors/gaarutyunov">sponsors</a>
      <a href="https://gist.github.com/gaarutyunov/abc123">gist</a>
      <a href="https://github.com/gaarutyunov/site-review">repo</a>`;
    expect(extractRepoCandidates(html).map((c) => c.repo)).toEqual([
      "site-review",
    ]);
  });

  it("accepts a list of hrefs collected from the live DOM", () => {
    const found = extractRepoCandidates([
      "https://github.com/gaarutyunov/boids",
      "https://github.com/gaarutyunov/boids/blob/main/README.md",
    ]);
    expect(found).toHaveLength(1);
    expect(found[0].occurrences).toBe(2);
  });

  it("strips a .git suffix and ignores asset paths", () => {
    const found = extractRepoCandidates([
      "https://github.com/gaarutyunov/site-review.git",
      "https://github.com/gaarutyunov/logo.png",
    ]);
    expect(found.map((c) => c.repo)).toEqual(["site-review"]);
  });

  it("ranks the connected user's repo above a third-party one", () => {
    const html = `
      <a href="https://github.com/rossjrw/pr-preview-action">a</a>
      <a href="https://github.com/rossjrw/pr-preview-action">b</a>
      <a href="https://github.com/gaarutyunov/site-review">c</a>`;
    const found = extractRepoCandidates(html, { preferOwner: "gaarutyunov" });
    expect(`${found[0].owner}/${found[0].repo}`).toBe("gaarutyunov/site-review");
  });

  it("ranks a canonical-URL match highest", () => {
    const html = `
      <a href="https://github.com/a/one">1</a>
      <a href="https://github.com/a/one">1</a>
      <a href="https://github.com/b/two">2</a>`;
    const found = extractRepoCandidates(html, {
      canonicalUrl: "https://github.com/b/two",
    });
    expect(`${found[0].owner}/${found[0].repo}`).toBe("b/two");
  });
});

describe("resolveSyncTarget", () => {
  it("resolves a verified PR from a pr-preview URL", async () => {
    const res = await resolveSyncTarget(
      binding,
      "https://gaarutyunov.github.io/site-review/pr-preview/pr-3/",
      async () => true,
    );
    expect(res.target).toEqual({ kind: "pr", number: 3 });
    expect(res.detectedPr?.number).toBe(3);
  });

  it("falls back to issue mode when the URL has no PR segment", async () => {
    const res = await resolveSyncTarget(
      binding,
      "https://gaarutyunov.github.io/site-review/",
      async () => true,
    );
    expect(res.target).toEqual({ kind: "issue-new" });
    expect(res.detectedPr).toBeNull();
  });

  it("falls back to issue mode when the detected PR does not exist", async () => {
    const res = await resolveSyncTarget(
      binding,
      "https://gaarutyunov.github.io/site-review/pr-preview/pr-99/",
      async () => false,
    );
    expect(res.target).toEqual({ kind: "issue-new" });
    expect(res.detectedPr?.number).toBe(99);
    expect(res.prUnavailable).toBe(true);
  });

  it("resolves no target when the page has no connected repository", async () => {
    const res = await resolveSyncTarget(
      undefined,
      "https://gaarutyunov.github.io/site-review/pr-preview/pr-3/",
    );
    expect(res.target).toBeNull();
  });
});
