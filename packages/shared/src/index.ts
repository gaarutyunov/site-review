import {
  uniqueNamesGenerator,
  adjectives,
  animals,
} from "unique-names-generator";

/**
 * Multi-anchor description of a single DOM element a comment is attached to.
 * Stored so the element can be re-located later even if the page mutates.
 * The `slug` is a human-readable handle (docker-container style) used to
 * reference the element inside comment text, e.g. "replace dancing-gorilla".
 */
export interface ElementTarget {
  /** Human-readable handle, e.g. "dancing-gorilla". Unique within a page. */
  slug: string;
  /** Optimized, reasonably-stable CSS selector (hashed classes filtered). */
  cssSelector: string;
  /**
   * Selector chain across shadow-DOM boundaries, outermost host → leaf. Length
   * 1 means a plain document element; length > 1 means the element lives inside
   * one or more open shadow roots, each segment queried within the previous
   * host's shadowRoot. Absent for legacy single-selector targets.
   */
  shadowPath?: string[];
  /** Snapshot of the element's trimmed innerText / aria-label for context. */
  textSnippet?: string;
  /** Lowercased tag name, e.g. "button". */
  tagName?: string;
  /** Stable attributes captured for fuzzy fallback (id, data-*, aria-*, role). */
  attributes?: Record<string, string>;
  /** Positional nth-child path as a last-resort anchor. */
  nthPath?: string;
}

export type CommentStatus = "open" | "resolved";

/** A comment attached to one or more elements on a page. */
export interface Comment {
  /** Human-readable slug id, e.g. "jumping-koala". */
  id: string;
  /** Page URL the comment was authored on (normalized). */
  pageUrl: string;
  /** Original page URL as displayed (for reference). */
  pageTitle?: string;
  /** Free-text comment body. May reference element slugs. */
  text: string;
  status: CommentStatus;
  /** One target = single-element comment; many = grouped comment. */
  targets: ElementTarget[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string | null;
}

/** Payload the extension POSTs to the server /ingest route (upsert). */
export type CommentUpsert = Omit<Comment, "createdAt" | "updatedAt"> &
  Partial<Pick<Comment, "createdAt" | "updatedAt">>;

const SLUG_CONFIG = {
  dictionaries: [adjectives, animals],
  separator: "-",
  length: 2,
  style: "lowerCase" as const,
};

/**
 * Generate a random docker-container-style slug, e.g. "dancing-gorilla".
 * Uniqueness is not guaranteed — callers should retry on collision.
 */
export function randomSlug(): string {
  return uniqueNamesGenerator(SLUG_CONFIG);
}

/**
 * Generate a slug guaranteed not to be in `taken`. Falls back to appending a
 * numeric suffix after several attempts to bound worst-case work.
 */
export function uniqueSlug(taken: Set<string> | string[]): string {
  const set = Array.isArray(taken) ? new Set(taken) : taken;
  for (let i = 0; i < 50; i++) {
    const s = randomSlug();
    if (!set.has(s)) return s;
  }
  let n = 2;
  const base = randomSlug();
  while (set.has(`${base}-${n}`)) n++;
  return `${base}-${n}`;
}

/**
 * Normalize a URL for use as a storage partition key: drop the hash, keep the
 * query string (it often selects the view), strip a trailing slash.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = "";
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s;
  } catch {
    return raw;
  }
}
