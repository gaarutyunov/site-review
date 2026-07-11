import { finder } from "@medv/finder";
import type { ElementTarget } from "@site-review/shared";

/** Class names that look framework-generated (emotion/styled/CSS-modules). */
function isStableClass(name: string): boolean {
  if (/^(css|sc|jsx)-[0-9a-z]{4,}$/i.test(name)) return false; // emotion / styled
  if (/[a-z]+_[a-z0-9]{5,}$/i.test(name)) return false; // CSS modules hash suffix
  if (/^[a-z0-9]{6,}$/i.test(name) && /\d/.test(name)) return false; // opaque hash
  return true;
}

/** Ids that look auto-generated (React useId, frameworks). */
function isStableId(id: string): boolean {
  if (/^[:][a-z0-9]+[:]?$/i.test(id)) return false; // React useId ":r3:"
  if (/^(radix|headlessui|mui|react-aria)-/i.test(id)) return false;
  return true;
}

const STABLE_ATTRS = [
  "data-testid",
  "data-test",
  "data-cy",
  "data-qa",
  "id",
  "name",
  "role",
  "aria-label",
];

function captureAttributes(el: Element): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (v) out[attr] = v;
  }
  return out;
}

function escapeAttrValue(v: string): string {
  return v.replace(/(["\\])/g, "\\$1");
}

function textSnippet(el: Element): string {
  const aria = el.getAttribute("aria-label");
  const raw = (aria || (el as HTMLElement).innerText || el.textContent || "").trim();
  return raw.replace(/\s+/g, " ").slice(0, 140);
}

type Scope = Document | ShadowRoot;

/** Build a path of nth-of-type segments unique within `root` (pierces no shadow). */
function cssPathWithin(el: Element, root: Scope): string {
  for (const attr of STABLE_ATTRS) {
    const v = el.getAttribute(attr);
    if (!v) continue;
    const sel =
      attr === "id"
        ? `#${CSS.escape(v)}`
        : `[${attr}="${escapeAttrValue(v)}"]`;
    try {
      if (root.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* invalid selector — skip */
    }
  }
  const segs: string[] = [];
  let node: Element | null = el;
  while (node && node.nodeType === 1) {
    const parent: Element | null = node.parentElement;
    let seg = node.tagName.toLowerCase();
    if (parent) {
      const tag = node.tagName;
      let count = 0;
      let index = 0;
      for (const c of Array.from(parent.children)) {
        if (c.tagName === tag) {
          count++;
          if (c === node) index = count;
        }
      }
      if (count > 1) seg += `:nth-of-type(${index})`;
    }
    segs.unshift(seg);
    if (!parent) break; // reached a shadow-root boundary (parentElement is null)
    node = parent;
  }
  return segs.join(" > ");
}

/** A selector for `el` relative to its own root (document or shadow root). */
function selectorWithin(el: Element): string {
  const root = el.getRootNode();
  if (root instanceof ShadowRoot) return cssPathWithin(el, root);
  try {
    return finder(el, {
      className: isStableClass,
      idName: isStableId,
      seedMinLength: 1,
      optimizedMinLength: 2,
      timeoutMs: 1000,
    });
  } catch {
    return cssPathWithin(el, document);
  }
}

/** Selector chain from the document down through each shadow host to `el`. */
function buildChain(el: Element): string[] {
  const chain: string[] = [];
  let cur: Element = el;
  // bound the walk; nested shadow roots beyond this are vanishingly rare
  for (let depth = 0; depth < 20; depth++) {
    chain.unshift(selectorWithin(cur));
    const root = cur.getRootNode();
    if (root instanceof ShadowRoot) {
      cur = root.host;
    } else {
      break;
    }
  }
  return chain;
}

/** Build a robust, multi-anchor target descriptor for a DOM element. */
export function buildTarget(el: Element, slug: string): ElementTarget {
  const chain = buildChain(el);
  return {
    slug,
    cssSelector: chain.join(" >>> "),
    shadowPath: chain.length > 1 ? chain : undefined,
    textSnippet: textSnippet(el) || undefined,
    tagName: el.tagName.toLowerCase(),
    attributes: captureAttributes(el),
    nthPath: cssPathWithin(el, el.getRootNode() as Scope),
  };
}

function uniqueWithin(scope: Scope, selector: string): Element | null {
  try {
    const matches = scope.querySelectorAll(selector);
    return matches.length === 1 ? matches[0] : null;
  } catch {
    return null;
  }
}

/** Resolve a selector chain, descending into shadow roots between segments. */
function resolveChain(chain: string[]): Element | null {
  let scope: Scope = document;
  let el: Element | null = null;
  for (let i = 0; i < chain.length; i++) {
    el = uniqueWithin(scope, chain[i]);
    if (!el) return null;
    if (i < chain.length - 1) {
      if (!el.shadowRoot) return null;
      scope = el.shadowRoot;
    }
  }
  return el;
}

/**
 * Re-locate an element from its stored target. Shadow-DOM targets resolve their
 * selector chain; plain targets use a priority cascade:
 * 1. exact CSS selector (unique) → 2. stable attribute → 3. text+tag → 4. nth path.
 * Returns null if nothing resolves to a single element ("orphaned" comment).
 */
export function relocate(target: ElementTarget): Element | null {
  if (target.shadowPath && target.shadowPath.length > 1) {
    return resolveChain(target.shadowPath);
  }

  const byCss = uniqueWithin(document, target.cssSelector);
  if (byCss) return byCss;

  const attrs = target.attributes ?? {};
  for (const attr of STABLE_ATTRS) {
    if (!attrs[attr]) continue;
    const sel =
      attr === "id"
        ? `#${CSS.escape(attrs[attr])}`
        : `[${attr}="${escapeAttrValue(attrs[attr])}"]`;
    const hit = uniqueWithin(document, sel);
    if (hit) return hit;
  }

  if (target.textSnippet && target.tagName) {
    const candidates = Array.from(document.getElementsByTagName(target.tagName));
    const exact = candidates.filter((c) => textSnippet(c) === target.textSnippet);
    if (exact.length === 1) return exact[0];
  }

  if (target.nthPath) {
    const hit = uniqueWithin(document, target.nthPath);
    if (hit) return hit;
  }
  return null;
}

/**
 * elementFromPoint that descends through open shadow roots to the real leaf
 * element under the cursor (devtools / VisBug "deep" hit-test). Stops without
 * piercing our own overlay host.
 */
export function deepElementFromPoint(
  x: number,
  y: number,
  stopHost: Element,
): Element | null {
  let el = document.elementFromPoint(x, y);
  while (el && el !== stopHost && el.shadowRoot) {
    const inner = el.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}
