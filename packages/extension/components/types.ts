import type { CommentStatus, ElementTarget } from "@site-review/shared";

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export function rectOf(el: Element): Rect {
  const r = el.getBoundingClientRect();
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export type HighlightState = "normal" | "hovered" | "focused";

/** A resolved highlight for one targeted element of an existing comment. */
export interface Highlight {
  commentId: string;
  slug: string;
  rect: Rect;
  status: CommentStatus;
  state: HighlightState;
}

/** The in-progress comment being authored or edited. */
export interface Draft {
  id: string;
  isNew: boolean;
  text: string;
  status: CommentStatus;
  targets: ElementTarget[];
  elements: (Element | null)[];
  createdAt?: string;
}

export const COLORS = {
  normal: "#4f46e5",
  hovered: "#f59e0b",
  focused: "#ec4899",
  resolved: "#9ca3af",
  select: "#10b981",
} as const;
