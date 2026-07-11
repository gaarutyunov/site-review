import { describe, it, expect } from "vitest";
import { randomSlug, uniqueSlug, normalizeUrl } from "./index.js";

describe("randomSlug", () => {
  it("produces a lowercase adjective-animal pair", () => {
    const slug = randomSlug();
    expect(slug).toMatch(/^[a-z]+-[a-z]+$/);
  });
});

describe("uniqueSlug", () => {
  it("never returns a slug already taken", () => {
    const taken = new Set<string>();
    for (let i = 0; i < 100; i++) {
      const s = uniqueSlug(taken);
      expect(taken.has(s)).toBe(false);
      taken.add(s);
    }
  });

  it("falls back to a numeric suffix when the space is exhausted", () => {
    // A Set that claims to contain every plain slug forces the suffix path.
    const always = {
      has: (v: string) => !/-\d+$/.test(v),
    } as unknown as Set<string>;
    const s = uniqueSlug(always);
    expect(s).toMatch(/-\d+$/);
  });

  it("accepts an array as the taken collection", () => {
    const s = uniqueSlug(["dancing-gorilla"]);
    expect(s).not.toBe("dancing-gorilla");
  });
});

describe("normalizeUrl", () => {
  it("drops the hash fragment", () => {
    expect(normalizeUrl("https://x.com/a#section")).toBe("https://x.com/a");
  });

  it("keeps the query string", () => {
    expect(normalizeUrl("https://x.com/a?view=grid")).toBe(
      "https://x.com/a?view=grid",
    );
  });

  it("strips a single trailing slash", () => {
    expect(normalizeUrl("https://x.com/a/")).toBe("https://x.com/a");
  });

  it("normalizes equivalent URLs to the same key", () => {
    expect(normalizeUrl("https://x.com/a/#top")).toBe(
      normalizeUrl("https://x.com/a"),
    );
  });

  it("returns the raw input for a non-URL string", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});
