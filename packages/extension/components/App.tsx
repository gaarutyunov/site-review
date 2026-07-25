import { useCallback, useEffect, useRef, useState } from "react";
import {
  normalizeUrl,
  type Comment,
  type CommentStatus,
} from "@site-review/shared";
import { buildTarget, relocate } from "../lib/selector";
import { sendToBackground } from "../lib/messaging";
import {
  loadSettings,
  matchShortcut,
  onSettingsChanged,
  type Settings,
} from "../lib/settings";
import { useElementPicker, useLatest, useViewportTick } from "../lib/hooks";
import { Highlights } from "./Highlights";
import { CommentEditor } from "./CommentEditor";
import { Curtain } from "./Curtain";
import {
  rectOf,
  type Draft,
  type Highlight,
  type HighlightState,
  type Rect,
} from "./types";

type Mode = "idle" | "picking-single" | "picking-multi";

const PAGE_URL = normalizeUrl(location.href);

export function App({ host }: { host: HTMLElement }) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [mode, setMode] = useState<Mode>("idle");
  const [hoverEl, setHoverEl] = useState<Element | null>(null);
  const [multiSel, setMultiSel] = useState<Element[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [curtainOpen, setCurtainOpen] = useState(false);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const settingsRef = useRef<Settings | null>(null);
  const resolvedCache = useRef<Map<string, Element>>(new Map());
  const tick = useViewportTick(true);
  void tick; // re-render on scroll/resize so rects stay aligned

  // --- load comments + settings ----------------------------------------
  useEffect(() => {
    void sendToBackground({ type: "getComments", pageUrl: PAGE_URL }).then((r) =>
      setComments(r.comments),
    );
    void loadSettings().then((s) => (settingsRef.current = s));
    return onSettingsChanged((s) => (settingsRef.current = s));
  }, []);

  // --- element resolution + geometry -----------------------------------
  const resolve = useCallback(
    (commentId: string, slug: string, target: Parameters<typeof relocate>[0]): Element | null => {
      const key = `${commentId}::${slug}`;
      const cached = resolvedCache.current.get(key);
      if (cached && cached.isConnected) return cached;
      const el = relocate(target);
      if (el) resolvedCache.current.set(key, el);
      else resolvedCache.current.delete(key);
      return el;
    },
    [],
  );

  const startMode = useCallback((m: "single" | "multi") => {
    setDraft(null);
    setHoverEl(null);
    setMultiSel([]);
    setMode(m === "single" ? "picking-single" : "picking-multi");
  }, []);

  const cancel = useCallback(() => {
    setMode("idle");
    setMultiSel([]);
    setHoverEl(null);
  }, []);

  const alloc = useCallback(async (n: number): Promise<string[]> => {
    const { slugs } = await sendToBackground({ type: "allocateSlugs", count: n });
    return slugs;
  }, []);

  // --- picking ----------------------------------------------------------
  const onPick = useCallback(
    async (el: Element) => {
      if (mode === "picking-multi") {
        setMultiSel((cur) =>
          cur.includes(el) ? cur.filter((x) => x !== el) : [...cur, el],
        );
        return;
      }
      // single
      const [idSlug, elSlug] = await alloc(2);
      const target = buildTarget(el, elSlug);
      setMode("idle");
      setHoverEl(null);
      setDraft({
        id: idSlug,
        isNew: true,
        text: "",
        status: "open",
        targets: [target],
        elements: [el],
      });
    },
    [mode, alloc],
  );

  const confirmMulti = useCallback(async () => {
    if (mode !== "picking-multi") return;
    if (multiSel.length === 0) {
      cancel();
      return;
    }
    const slugs = await alloc(multiSel.length + 1);
    const targets = multiSel.map((el, i) => buildTarget(el, slugs[i + 1]));
    setMode("idle");
    setDraft({
      id: slugs[0],
      isNew: true,
      text: "",
      status: "open",
      targets,
      elements: [...multiSel],
    });
    setMultiSel([]);
  }, [mode, multiSel, alloc, cancel]);

  useElementPicker({
    active: mode === "picking-single",
    host,
    onHover: setHoverEl,
    onPick,
    onCancel: cancel,
    onConfirm: cancel,
  });
  useElementPicker({
    active: mode === "picking-multi",
    host,
    onHover: setHoverEl,
    onPick,
    onCancel: cancel,
    onConfirm: confirmMulti,
  });

  // --- keyboard shortcuts (primary path) -------------------------------
  const startRef = useLatest(startMode);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = settingsRef.current;
      if (!s) return;
      if (document.activeElement === host) return; // typing in our own UI
      if (matchShortcut(e, s.shortcutMulti)) {
        e.preventDefault();
        startRef.current("multi");
      } else if (matchShortcut(e, s.shortcutSingle)) {
        e.preventDefault();
        startRef.current("single");
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [host]);

  // --- background-triggered command modes ------------------------------
  useEffect(() => {
    const onMsg = (msg: { type?: string; mode?: "single" | "multi" }) => {
      if (msg?.type === "start-mode" && msg.mode) startRef.current(msg.mode);
    };
    chrome.runtime.onMessage.addListener(onMsg);
    return () => chrome.runtime.onMessage.removeListener(onMsg);
  }, []);

  // --- persistence helpers ---------------------------------------------
  const persist = useCallback(async (c: Comment) => {
    await sendToBackground({ type: "saveComment", comment: c });
    setComments((cur) => {
      const i = cur.findIndex((x) => x.id === c.id);
      if (i === -1) return [c, ...cur];
      const next = [...cur];
      next[i] = c;
      return next;
    });
  }, []);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const now = new Date().toISOString();
    const existing = comments.find((c) => c.id === draft.id);
    const comment: Comment = {
      id: draft.id,
      pageUrl: PAGE_URL,
      pageTitle: document.title,
      text: draft.text,
      status: draft.status,
      targets: draft.targets,
      createdAt: existing?.createdAt ?? draft.createdAt ?? now,
      updatedAt: now,
      resolvedAt: draft.status === "resolved" ? now : null,
    };
    // prime the resolve cache for freshly-picked elements
    draft.targets.forEach((t, i) => {
      const el = draft.elements[i];
      if (el) resolvedCache.current.set(`${draft.id}::${t.slug}`, el);
    });
    await persist(comment);
    setDraft(null);
    setFocusedId(comment.id);
  }, [draft, comments, persist]);

  const removeComment = useCallback(async (id: string) => {
    await sendToBackground({ type: "deleteComment", id });
    setComments((cur) => cur.filter((c) => c.id !== id));
  }, []);

  const deleteDraft = useCallback(async () => {
    if (!draft) return;
    if (!draft.isNew) await removeComment(draft.id);
    setDraft(null);
  }, [draft, removeComment]);

  const openEdit = useCallback(
    (c: Comment) => {
      setDraft({
        id: c.id,
        isNew: false,
        text: c.text,
        status: c.status,
        targets: c.targets,
        elements: c.targets.map((t) => resolve(c.id, t.slug, t)),
        createdAt: c.createdAt,
      });
      setFocusedId(c.id);
    },
    [resolve],
  );

  const toggleResolved = useCallback(
    async (c: Comment) => {
      const status: CommentStatus = c.status === "resolved" ? "open" : "resolved";
      await persist({ ...c, status, updatedAt: new Date().toISOString() });
    },
    [persist],
  );

  const selectFromCurtain = useCallback(
    (c: Comment) => {
      const el = resolve(c.id, c.targets[0]?.slug ?? "", c.targets[0]);
      el?.scrollIntoView({ block: "center", behavior: "smooth" });
      setFocusedId(c.id);
    },
    [resolve],
  );

  // --- slug rename / insert (in editor) --------------------------------
  const renameSlug = useCallback((index: number, newSlug: string) => {
    setDraft((d) => {
      if (!d) return d;
      const old = d.targets[index].slug;
      const targets = d.targets.map((t, i) =>
        i === index ? { ...t, slug: newSlug } : t,
      );
      // also rewrite references in the comment text
      const text = d.text.split(old).join(newSlug);
      return { ...d, targets, text };
    });
  }, []);

  const insertSlug = useCallback((slug: string) => {
    setDraft((d) => (d ? { ...d, text: `${d.text}${d.text ? " " : ""}${slug}` } : d));
  }, []);

  // --- derive highlights for render ------------------------------------
  const stateFor = (id: string): HighlightState => {
    if (focusedId === id || draft?.id === id) return "focused";
    if (hoveredId === id) return "hovered";
    return "normal";
  };

  const highlights: Highlight[] = [];
  for (const c of comments) {
    for (const t of c.targets) {
      const el = resolve(c.id, t.slug, t);
      if (!el) continue;
      highlights.push({
        commentId: c.id,
        slug: t.slug,
        rect: rectOf(el),
        status: c.status,
        state: stateFor(c.id),
      });
    }
  }

  const hoverRect: Rect | null =
    hoverEl && hoverEl.isConnected ? rectOf(hoverEl) : null;
  const selectionRects = multiSel.filter((e) => e.isConnected).map(rectOf);

  let anchorRect: Rect | null = null;
  if (draft) {
    const el =
      draft.elements[0]?.isConnected
        ? draft.elements[0]
        : resolve(draft.id, draft.targets[0]?.slug ?? "", draft.targets[0]);
    if (el) anchorRect = rectOf(el);
  }

  const commentById = (id: string) => comments.find((c) => c.id === id);

  return (
    <>
      <Highlights
        highlights={highlights}
        hoverRect={hoverRect}
        selectionRects={selectionRects}
        onBadgeClick={(id) => {
          const c = commentById(id);
          if (c) openEdit(c);
        }}
        onBadgeHover={setHoveredId}
      />

      {mode === "picking-multi" && (
        <div
          style={{
            position: "fixed",
            bottom: 20,
            left: "50%",
            transform: "translateX(-50%)",
            pointerEvents: "auto",
            background: "#1e1e2e",
            color: "#fff",
            borderRadius: 10,
            padding: "10px 14px",
            display: "flex",
            gap: 10,
            alignItems: "center",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            boxShadow: "0 8px 30px rgba(0,0,0,.5)",
          }}
        >
          <span>
            Multi-select: {multiSel.length} element{multiSel.length === 1 ? "" : "s"} —
            click to toggle
          </span>
          <button
            onClick={confirmMulti}
            disabled={multiSel.length === 0}
            style={{
              background: "#10b981",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              fontWeight: 700,
              cursor: multiSel.length ? "pointer" : "not-allowed",
              opacity: multiSel.length ? 1 : 0.5,
            }}
          >
            Comment ↵
          </button>
          <button
            onClick={cancel}
            style={{
              background: "#3b3b52",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "6px 12px",
              cursor: "pointer",
            }}
          >
            Esc
          </button>
        </div>
      )}

      {draft && (
        <CommentEditor
          draft={draft}
          anchorRect={anchorRect}
          onChange={(text) => setDraft((d) => (d ? { ...d, text } : d))}
          onToggleResolved={() =>
            setDraft((d) =>
              d
                ? { ...d, status: d.status === "resolved" ? "open" : "resolved" }
                : d,
            )
          }
          onRenameSlug={renameSlug}
          onInsertSlug={insertSlug}
          onSave={saveDraft}
          onCancel={() => setDraft(null)}
          onDelete={deleteDraft}
        />
      )}

      <Curtain
        open={curtainOpen}
        comments={comments}
        pageUrl={PAGE_URL}
        pageTitle={document.title}
        hoveredId={hoveredId}
        focusedId={focusedId}
        onToggle={() => setCurtainOpen((o) => !o)}
        onSelect={selectFromCurtain}
        onHover={setHoveredId}
        onResolveToggle={toggleResolved}
        onDelete={(c) => removeComment(c.id)}
      />
    </>
  );
}
