import { describe, it, expect, beforeEach } from "vitest";
import { CommentStore } from "./store.js";
import type { CommentUpsert } from "@site-review/shared";

function make(overrides: Partial<CommentUpsert> = {}): CommentUpsert {
  return {
    id: "jumping-koala",
    pageUrl: "https://example.com/page#frag",
    pageTitle: "Example",
    text: "Fix the dancing-gorilla button",
    status: "open",
    targets: [
      {
        slug: "dancing-gorilla",
        cssSelector: "button.cta",
        textSnippet: "Sign up",
        tagName: "button",
        attributes: { id: "cta" },
        nthPath: "body > button:nth-of-type(1)",
      },
    ],
    ...overrides,
  };
}

describe("CommentStore", () => {
  let store: CommentStore;
  beforeEach(() => {
    store = new CommentStore(":memory:");
  });

  it("upserts and retrieves a comment with its targets", () => {
    const saved = store.upsert(make());
    expect(saved.id).toBe("jumping-koala");
    expect(saved.targets).toHaveLength(1);
    expect(saved.targets[0].slug).toBe("dancing-gorilla");
    expect(saved.targets[0].attributes).toEqual({ id: "cta" });
    // pageUrl is normalized on write (hash stripped).
    expect(saved.pageUrl).toBe("https://example.com/page");
  });

  it("replaces targets on re-upsert rather than duplicating", () => {
    store.upsert(make());
    const updated = store.upsert(
      make({
        text: "renamed",
        targets: [{ slug: "sleepy-otter", cssSelector: "a.link" }],
      }),
    );
    expect(updated.targets).toHaveLength(1);
    expect(updated.targets[0].slug).toBe("sleepy-otter");
  });

  it("preserves createdAt across updates but bumps updatedAt", () => {
    const a = store.upsert(make());
    const b = store.upsert(make({ text: "edited" }));
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.text).toBe("edited");
  });

  it("lists by status and by page url", () => {
    store.upsert(make({ id: "a" }));
    store.upsert(make({ id: "b", status: "resolved" }));
    store.upsert(make({ id: "c", pageUrl: "https://other.com/" }));

    expect(store.list({ status: "open" }).map((c) => c.id).sort()).toEqual([
      "a",
      "c",
    ]);
    expect(store.list({ pageUrl: "https://example.com/page" }).map((c) => c.id).sort()).toEqual(
      ["a", "b"],
    );
  });

  it("searches text, slugs, and snippets", () => {
    store.upsert(make({ id: "a", text: "make it blue" }));
    store.upsert(make({ id: "b", text: "unrelated", targets: [{ slug: "witty-lynx", cssSelector: "div" }] }));

    expect(store.search("blue").map((c) => c.id)).toEqual(["a"]);
    expect(store.search("witty-lynx").map((c) => c.id)).toEqual(["b"]);
  });

  it("sets status with a resolvedAt timestamp and reopens", () => {
    store.upsert(make());
    const resolved = store.setStatus("jumping-koala", "resolved");
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).toBeTruthy();
    const reopened = store.setStatus("jumping-koala", "open");
    expect(reopened?.status).toBe("open");
    expect(reopened?.resolvedAt).toBeNull();
  });

  it("returns undefined when setting status on a missing comment", () => {
    expect(store.setStatus("nope", "resolved")).toBeUndefined();
  });

  it("deletes a comment and cascades its elements", () => {
    store.upsert(make());
    expect(store.delete("jumping-koala")).toBe(true);
    expect(store.get("jumping-koala")).toBeUndefined();
    expect(store.delete("jumping-koala")).toBe(false);
  });

  it("reports taken slugs across ids and element slugs", () => {
    store.upsert(make());
    const taken = store.takenSlugs();
    expect(taken.has("jumping-koala")).toBe(true); // comment id
    expect(taken.has("dancing-gorilla")).toBe(true); // element slug
  });

  it("aggregates pages with comment counts", () => {
    store.upsert(make({ id: "a" }));
    store.upsert(make({ id: "b" }));
    store.upsert(make({ id: "c", pageUrl: "https://other.com/" }));
    const pages = store.pages();
    const example = pages.find((p) => p.pageUrl === "https://example.com/page");
    expect(example?.count).toBe(2);
  });
});
