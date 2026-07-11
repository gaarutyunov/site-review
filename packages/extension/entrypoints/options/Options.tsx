import { useEffect, useState } from "react";
import {
  DEFAULT_SETTINGS,
  formatShortcut,
  loadSettings,
  saveSettings,
  shortcutFromEvent,
  type Settings,
  type Shortcut,
} from "../../lib/settings";

function ShortcutField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Shortcut;
  onChange: (s: Shortcut) => void;
}) {
  const [recording, setRecording] = useState(false);

  useEffect(() => {
    if (!recording) return;
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      const sc = shortcutFromEvent(e);
      if (sc) {
        onChange(sc);
        setRecording(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [recording, onChange]);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
      <span style={{ width: 200 }}>{label}</span>
      <button
        onClick={() => setRecording((r) => !r)}
        style={{
          minWidth: 130,
          padding: "8px 14px",
          borderRadius: 8,
          border: recording ? "2px solid #4f46e5" : "1px solid #cbd5e1",
          background: recording ? "#eef2ff" : "#fff",
          cursor: "pointer",
          fontFamily: "ui-monospace, monospace",
          fontWeight: 600,
        }}
      >
        {recording ? "Press keys…" : formatShortcut(value)}
      </button>
    </div>
  );
}

export function Options() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const update = (patch: Partial<Settings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    setSaved(false);
  };

  const save = async () => {
    await saveSettings(settings);
    setSaved(true);
  };

  return (
    <div
      style={{
        maxWidth: 560,
        margin: "40px auto",
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
        padding: "0 20px",
      }}
    >
      <h1 style={{ fontSize: 22 }}>Site Review — Settings</h1>
      <p style={{ color: "#475569" }}>
        Leave comments on website elements for AI agents to fix.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>Shortcuts</h2>
      <ShortcutField
        label="Comment on an element"
        value={settings.shortcutSingle}
        onChange={(shortcutSingle) => update({ shortcutSingle })}
      />
      <ShortcutField
        label="Comment on multiple elements"
        value={settings.shortcutMulti}
        onChange={(shortcutMulti) => update({ shortcutMulti })}
      />
      <p style={{ color: "#64748b", fontSize: 12 }}>
        Shortcuts are captured by the page itself, so they work even if the
        browser-level command is unset. Some pages (the Web Store, browser
        internal pages) block content scripts.
      </p>

      <h2 style={{ fontSize: 16, marginTop: 28 }}>Server</h2>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <span style={{ width: 200 }}>MCP / ingest server URL</span>
        <input
          value={settings.serverUrl}
          onChange={(e) => update({ serverUrl: e.target.value })}
          style={{
            flex: 1,
            padding: "8px 10px",
            borderRadius: 8,
            border: "1px solid #cbd5e1",
            fontFamily: "ui-monospace, monospace",
          }}
        />
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <input
          type="checkbox"
          checked={settings.syncEnabled}
          onChange={(e) => update({ syncEnabled: e.target.checked })}
        />
        Push comments to the server so AI agents can read them
      </label>

      <div style={{ marginTop: 28, display: "flex", alignItems: "center", gap: 14 }}>
        <button
          onClick={save}
          style={{
            background: "#4f46e5",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            padding: "10px 20px",
            fontWeight: 700,
            fontSize: 14,
            cursor: "pointer",
          }}
        >
          Save
        </button>
        {saved && <span style={{ color: "#16a34a" }}>Saved ✓</span>}
      </div>
    </div>
  );
}
