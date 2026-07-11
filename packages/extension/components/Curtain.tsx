import type { Comment } from "@site-review/shared";
import { COLORS } from "./types";

interface Props {
  open: boolean;
  comments: Comment[];
  hoveredId: string | null;
  focusedId: string | null;
  onToggle: () => void;
  onSelect: (c: Comment) => void;
  onHover: (id: string | null) => void;
  onResolveToggle: (c: Comment) => void;
  onDelete: (c: Comment) => void;
}

export function Curtain(props: Props) {
  const { open, comments } = props;
  const openCount = comments.filter((c) => c.status === "open").length;

  return (
    <>
      {/* toggle tab — always visible */}
      <button
        onClick={props.onToggle}
        style={{
          position: "fixed",
          top: 12,
          right: open ? 312 : 12,
          pointerEvents: "auto",
          background: COLORS.normal,
          color: "#fff",
          border: "none",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          fontFamily: "system-ui, sans-serif",
          boxShadow: "0 2px 10px rgba(0,0,0,.3)",
          transition: "right 160ms ease",
        }}
      >
        💬 {openCount}
      </button>

      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          height: "100vh",
          width: 300,
          transform: open ? "translateX(0)" : "translateX(100%)",
          transition: "transform 160ms ease",
          pointerEvents: "auto",
          background: "#1e1e2e",
          color: "#e5e7eb",
          borderLeft: "1px solid #3b3b52",
          boxShadow: "-8px 0 30px rgba(0,0,0,.4)",
          display: "flex",
          flexDirection: "column",
          fontFamily: "system-ui, sans-serif",
          fontSize: 13,
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            borderBottom: "1px solid #3b3b52",
            fontWeight: 700,
            fontSize: 14,
          }}
        >
          Site Review · {comments.length} comment{comments.length === 1 ? "" : "s"}
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {comments.length === 0 && (
            <div style={{ padding: 16, color: "#9ca3af" }}>
              No comments yet. Press your shortcut and click an element.
            </div>
          )}
          {comments.map((c) => (
            <div
              key={c.id}
              onMouseEnter={() => props.onHover(c.id)}
              onMouseLeave={() => props.onHover(null)}
              onClick={() => props.onSelect(c)}
              style={{
                padding: "10px 14px",
                borderBottom: "1px solid #2a2a3c",
                cursor: "pointer",
                background:
                  props.focusedId === c.id
                    ? "#2d2d44"
                    : props.hoveredId === c.id
                      ? "#26263a"
                      : "transparent",
                opacity: c.status === "resolved" ? 0.55 : 1,
              }}
            >
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 4 }}>
                {c.targets.map((t) => (
                  <span
                    key={t.slug}
                    style={{
                      background: c.status === "resolved" ? COLORS.resolved : COLORS.normal,
                      color: "#fff",
                      borderRadius: 9,
                      padding: "1px 7px",
                      fontFamily: "ui-monospace, monospace",
                      fontSize: 10,
                      fontWeight: 600,
                    }}
                  >
                    {t.slug}
                  </span>
                ))}
              </div>
              <div
                style={{
                  whiteSpace: "pre-wrap",
                  textDecoration: c.status === "resolved" ? "line-through" : "none",
                }}
              >
                {c.text || <span style={{ color: "#9ca3af" }}>(empty)</span>}
              </div>
              <div style={{ display: "flex", gap: 10, marginTop: 6 }}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onResolveToggle(c);
                  }}
                  style={linkBtn(COLORS.select)}
                >
                  {c.status === "resolved" ? "Reopen" : "Resolve"}
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    props.onDelete(c);
                  }}
                  style={linkBtn("#f87171")}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

function linkBtn(color: string): React.CSSProperties {
  return {
    background: "none",
    border: "none",
    color,
    cursor: "pointer",
    fontSize: 12,
    fontWeight: 600,
    padding: 0,
  };
}
