/** A user-configurable keyboard shortcut, keyed on the physical key code. */
export interface Shortcut {
  /** KeyboardEvent.code, e.g. "KeyC" — layout-robust (Option+C => key "ç"). */
  code: string;
  alt: boolean;
  shift: boolean;
  ctrl: boolean;
  meta: boolean;
}

export interface Settings {
  /** Base URL of the MCP/ingest server. */
  serverUrl: string;
  /** Whether to push comments to the server. */
  syncEnabled: boolean;
  /** Start a single-element comment. */
  shortcutSingle: Shortcut;
  /** Start a multi-element comment. */
  shortcutMulti: Shortcut;
}

export const DEFAULT_SETTINGS: Settings = {
  serverUrl: "http://localhost:4711",
  syncEnabled: true,
  shortcutSingle: { code: "KeyC", alt: true, shift: false, ctrl: false, meta: false },
  shortcutMulti: { code: "KeyC", alt: true, shift: true, ctrl: false, meta: false },
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const res = await chrome.storage.sync.get(KEY);
  return { ...DEFAULT_SETTINGS, ...(res[KEY] as Partial<Settings> | undefined) };
}

export async function saveSettings(s: Settings): Promise<void> {
  await chrome.storage.sync.set({ [KEY]: s });
}

export function onSettingsChanged(cb: (s: Settings) => void): () => void {
  const handler = (
    changes: Record<string, chrome.storage.StorageChange>,
    area: string,
  ) => {
    if (area === "sync" && changes[KEY]) {
      cb({ ...DEFAULT_SETTINGS, ...(changes[KEY].newValue as Partial<Settings>) });
    }
  };
  chrome.storage.onChanged.addListener(handler);
  return () => chrome.storage.onChanged.removeListener(handler);
}

/** True if a keydown event matches the given shortcut. */
export function matchShortcut(e: KeyboardEvent, sc: Shortcut): boolean {
  return (
    e.code === sc.code &&
    e.altKey === sc.alt &&
    e.shiftKey === sc.shift &&
    e.ctrlKey === sc.ctrl &&
    e.metaKey === sc.meta
  );
}

/** Human-readable label for a shortcut, e.g. "⌥ + C". */
export function formatShortcut(sc: Shortcut): string {
  const parts: string[] = [];
  if (sc.ctrl) parts.push("Ctrl");
  if (sc.alt) parts.push("⌥");
  if (sc.shift) parts.push("⇧");
  if (sc.meta) parts.push("⌘");
  parts.push(sc.code.replace(/^Key/, "").replace(/^Digit/, ""));
  return parts.join(" + ");
}

/** Build a Shortcut from a raw keydown event (for the "record" widget). */
export function shortcutFromEvent(e: KeyboardEvent): Shortcut | null {
  // Ignore pure modifier presses.
  if (["AltLeft", "AltRight", "ShiftLeft", "ShiftRight", "ControlLeft", "ControlRight", "MetaLeft", "MetaRight"].includes(e.code)) {
    return null;
  }
  return {
    code: e.code,
    alt: e.altKey,
    shift: e.shiftKey,
    ctrl: e.ctrlKey,
    meta: e.metaKey,
  };
}
