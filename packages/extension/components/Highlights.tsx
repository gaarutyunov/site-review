import { COLORS, type Highlight, type Rect } from "./types";

interface Props {
  highlights: Highlight[];
  /** Live rect of the element under the cursor while picking. */
  hoverRect: Rect | null;
  /** Rects of elements currently selected in multi mode. */
  selectionRects: Rect[];
  onBadgeClick: (commentId: string) => void;
  onBadgeHover: (commentId: string | null) => void;
}

function color(h: Highlight): string {
  if (h.state === "hovered") return COLORS.hovered;
  if (h.state === "focused") return COLORS.focused;
  if (h.status === "resolved") return COLORS.resolved;
  return COLORS.normal;
}

function outlineStyle(rect: Rect, c: string, dashed = false): React.CSSProperties {
  return {
    position: "fixed",
    top: rect.top,
    left: rect.left,
    width: rect.width,
    height: rect.height,
    border: `2px ${dashed ? "dashed" : "solid"} ${c}`,
    borderRadius: 3,
    boxSizing: "border-box",
    pointerEvents: "none",
    background: `${c}14`,
    transition: "all 60ms linear",
  };
}

export function Highlights({
  highlights,
  hoverRect,
  selectionRects,
  onBadgeClick,
  onBadgeHover,
}: Props) {
  return (
    <>
      {hoverRect && (
        <div style={outlineStyle(hoverRect, COLORS.hovered, true)} />
      )}
      {selectionRects.map((r, i) => (
        <div key={`sel-${i}`} style={outlineStyle(r, COLORS.select)} />
      ))}
      {highlights.map((h) => {
        const c = color(h);
        return (
          <div key={`${h.commentId}-${h.slug}`}>
            <div style={outlineStyle(h.rect, c)} />
            <button
              onClick={() => onBadgeClick(h.commentId)}
              onMouseEnter={() => onBadgeHover(h.commentId)}
              onMouseLeave={() => onBadgeHover(null)}
              title={h.slug}
              style={{
                position: "fixed",
                top: Math.max(h.rect.top - 10, 2),
                left: Math.max(h.rect.left - 10, 2),
                pointerEvents: "auto",
                cursor: "pointer",
                background: c,
                color: "#fff",
                border: "none",
                borderRadius: 10,
                height: 20,
                padding: "0 7px",
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "ui-monospace, monospace",
                lineHeight: "20px",
                whiteSpace: "nowrap",
                boxShadow: "0 1px 3px rgba(0,0,0,.35)",
              }}
            >
              {h.slug}
            </button>
          </div>
        );
      })}
    </>
  );
}
