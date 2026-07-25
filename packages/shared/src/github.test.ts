import { describe, it, expect } from "vitest";
import { parsePrPath } from "./github.js";

describe("parsePrPath", () => {
  it("extracts the PR number from a pr-preview path", () => {
    expect(
      parsePrPath("https://gaarutyunov.github.io/site-review/pr-preview/pr-3/"),
    ).toEqual({ number: 3, source: "pr-preview/pr-3/" });
  });

  it("matches when the preview path has a deeper page below it", () => {
    expect(
      parsePrPath("https://x.github.io/repo/pr-preview/pr-42/docs/index.html")
        ?.number,
    ).toBe(42);
  });

  it("ignores the query string and hash", () => {
    expect(
      parsePrPath("https://x.github.io/repo/pr-preview/pr-7/?a=1#top")?.number,
    ).toBe(7);
  });

  it("returns null when the path has no pr-preview segment", () => {
    expect(parsePrPath("https://x.github.io/repo/")).toBeNull();
    expect(parsePrPath("https://x.github.io/pr-3/")).toBeNull();
  });

  it("returns null for a non-numeric or zero PR number", () => {
    expect(parsePrPath("https://x.io/pr-preview/pr-abc/")).toBeNull();
    expect(parsePrPath("https://x.io/pr-preview/pr-0/")).toBeNull();
  });

  it("falls back to treating a non-URL input as a path", () => {
    expect(parsePrPath("/pr-preview/pr-9/")?.number).toBe(9);
  });
});
