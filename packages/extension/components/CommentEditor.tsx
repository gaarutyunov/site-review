import { useEffect, useRef, useState } from "react";
import { COLORS, type Draft, type Rect } from "./types";

interface Props {
  draft: Draft;
  anchorRect: Rect | null;
  onChange: (text: string) => void;
  onToggleResolved: () => void;
  onRenameSlug: (index: number, newSlug: string) => void;
  onInsertSlug: (slug: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}

const PANEL_W = 320;

/** Clamp the editor panel near its anchor element, inside the viewport. */
function position(anchor: Rect | null): React.CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  let left = anchor ? anchor.left : vw / 2 - PANEL_W / 2;
  let top = anchor ? anchor.top + anchor.height + 8 : 80;
  left = Math.min(Math.max(8, left), vw - PANEL_W - 8);
  top = Math.min(Math.max(8, top), vh - 220);
  return { position: "fixed", top, left, width: PANEL_W };
}

export function CommentEditor(props: Props) {
  const { draft, anchorRect } = props;
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameVal, setRenameVal] = useState("");

  useEffect(() => {
    taRef.current?.focus();
  }, [draft.id]);

  const commitRename = (i: number) => {
    const v = renameVal.trim();
    if (v) props.onRenameSlug(i, v);
    setRenaming(null);
  };

  return (
    <div
      style={{
        ...position(anchorRect),
        pointerEvents: "auto",
        background: "#1e1e2e",
        color: "#e5e7eb",
        border: "1px solid #3b3b52",
        borderRadius: 10,
        boxShadow: "0 8px 30px rgba(0,0,0,.5)",
        padding: 12,
        fontFamily: "system-ui, sans-serif",
        fontSize: 13,
        zIndex: 10,
      }}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") props.onSave();
        if (e.key === "Escape") props.onCancel();
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {draft.targets.map((t, i) =>
          renaming === i ? (
            <input
              key={t.slug}
              autoFocus
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={() => commitRename(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename(i);
                if (e.key === "Escape") setRenaming(null);
              }}
              style={{
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                width: 110,
                background: "#11111b",
                color: "#fff",
                border: `1px solid ${COLORS.normal}`,
                borderRadius: 8,
                padding: "2px 6px",
              }}
            />
          ) : (
            <span
              key={t.slug}
              title="Click to insert into comment · double-click to rename"
              onClick={() => props.onInsertSlug(t.slug)}
              onDoubleClick={() => {
                setRenameVal(t.slug);
                setRenaming(i);
              }}
              style={{
                cursor: "pointer",
                background: COLORS.normal,
                color: "#fff",
                borderRadius: 10,
                padding: "2px 8px",
                fontFamily: "ui-monospace, monospace",
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {t.slug}
            </span>
          ),
        )}
      </div>

      <textarea
        ref={taRef}
        value={draft.text}
        placeholder="Describe the change… reference elements by their slug."
        onChange={(e) => props.onChange(e.target.value)}
        rows={4}
        style={{
          width: "100%",
          boxSizing: "border-box",
          resize: "vertical",
          background: "#11111b",
          color: "#e5e7eb",
          border: "1px solid #3b3b52",
          borderRadius: 8,
          padding: 8,
          fontFamily: "inherit",
          fontSize: 13,
          outline: "none",
        }}
      />

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
        }}
      >
        <button onClick={props.onSave} style={btn(COLORS.normal)}>
          Save
        </button>
        <button onClick={props.onCancel} style={btn("#3b3b52")}>
          Cancel
        </button>
        {!draft.isNew && (
          <>
            <button onClick={props.onToggleResolved} style={btn(COLORS.select)}>
              {draft.status === "resolved" ? "Reopen" : "Resolve"}
            </button>
            <button
              onClick={props.onDelete}
              style={{ ...btn("transparent"), color: "#f87171", marginLeft: "auto" }}
            >
              Delete
            </button>
          </>
        )}
      </div>
      <div style={{ marginTop: 6, fontSize: 11, color: "#9ca3af" }}>
        ⌘/Ctrl+Enter to save · Esc to cancel
      </div>
    </div>
  );
}

function btn(bg: string): React.CSSProperties {
  return {
    background: bg,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "6px 12px",
    fontSize: 13,
    fontWeight: 600,
    cursor: "pointer",
  };
}
