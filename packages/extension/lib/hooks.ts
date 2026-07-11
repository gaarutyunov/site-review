import { useEffect, useRef, useState } from "react";
import { deepElementFromPoint } from "./selector";

/** Bumps a counter on scroll/resize so highlight rects can be recomputed. */
export function useViewportTick(enabled: boolean): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const bump = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((t) => (t + 1) % 1_000_000));
    };
    window.addEventListener("scroll", bump, true);
    window.addEventListener("resize", bump);
    const ro = new ResizeObserver(bump);
    ro.observe(document.documentElement);
    return () => {
      window.removeEventListener("scroll", bump, true);
      window.removeEventListener("resize", bump);
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [enabled]);
  return tick;
}

/** Keeps a ref in sync with the latest value, for use inside stable listeners. */
export function useLatest<T>(value: T) {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}

export interface PickerOptions {
  active: boolean;
  host: HTMLElement;
  onHover: (el: Element | null) => void;
  onPick: (el: Element) => void;
  onCancel: () => void;
  onConfirm: () => void;
}

/**
 * VisBug-style element picker: document-level capture listeners that highlight
 * the element under the cursor and capture clicks without activating the page.
 *
 * While active it forces every page element to be hit-testable
 * (`pointer-events: auto`) so that elements the site marks `pointer-events:none`
 * (overlays, decorative panels) can still be picked — `elementFromPoint`
 * otherwise skips them and returns whatever is behind. Our own overlay host is
 * exempted, and "is this our UI?" is decided from the event's composed path
 * rather than a point hit-test (which the override would otherwise confuse).
 */
export function useElementPicker(opts: PickerOptions) {
  const ref = useLatest(opts);
  useEffect(() => {
    if (!opts.active) return;
    const host = opts.host;
    const fromUs = (e: Event) => e.composedPath().includes(host);
    const at = (e: MouseEvent): Element | null => {
      const el = deepElementFromPoint(e.clientX, e.clientY, host);
      return el && el !== host ? el : null;
    };

    const onMove = (e: MouseEvent) => {
      ref.current.onHover(fromUs(e) ? null : at(e));
    };
    const onClick = (e: MouseEvent) => {
      if (fromUs(e)) return; // let our own UI handle its clicks
      const el = at(e);
      if (!el) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      ref.current.onPick(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        ref.current.onCancel();
      } else if (e.key === "Enter") {
        e.preventDefault();
        ref.current.onConfirm();
      }
    };

    // Force all page elements hit-testable; keep our own host click-through.
    const hostTag = host.tagName.toLowerCase();
    const override = document.createElement("style");
    override.setAttribute("data-site-review-picker", "");
    override.textContent = `*{pointer-events:auto !important}${hostTag}{pointer-events:none !important}`;
    document.head.appendChild(override);

    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    const prev = document.body.style.cursor;
    document.body.style.cursor = "crosshair";
    return () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey, true);
      override.remove();
      document.body.style.cursor = prev;
      ref.current.onHover(null);
    };
  }, [opts.active, opts.host]);
}
