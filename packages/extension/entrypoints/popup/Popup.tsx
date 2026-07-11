import { useEffect, useState } from "react";
import { formatShortcut, loadSettings, type Settings } from "../../lib/settings";
import type { TabCommand } from "../../lib/messaging";

async function send(mode: "single" | "multi") {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    const cmd: TabCommand = { type: "start-mode", mode };
    chrome.tabs.sendMessage(tab.id, cmd).catch(() => {});
    window.close();
  }
}

export function Popup() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    void loadSettings().then(setSettings);
  }, []);

  const btn: React.CSSProperties = {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    width: "100%",
    padding: "10px 12px",
    border: "none",
    borderRadius: 8,
    background: "#4f46e5",
    color: "#fff",
    fontWeight: 600,
    fontSize: 13,
    cursor: "pointer",
    marginBottom: 8,
  };

  return (
    <div
      style={{
        width: 260,
        padding: 14,
        fontFamily: "system-ui, sans-serif",
        color: "#0f172a",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 10 }}>
        Site Review
      </div>
      <button style={btn} onClick={() => send("single")}>
        <span>Comment on element</span>
        <kbd style={{ opacity: 0.85 }}>
          {settings ? formatShortcut(settings.shortcutSingle) : "…"}
        </kbd>
      </button>
      <button style={btn} onClick={() => send("multi")}>
        <span>Comment on many</span>
        <kbd style={{ opacity: 0.85 }}>
          {settings ? formatShortcut(settings.shortcutMulti) : "…"}
        </kbd>
      </button>
      <button
        style={{
          ...btn,
          background: "#f1f5f9",
          color: "#0f172a",
          marginBottom: 0,
        }}
        onClick={() => chrome.runtime.openOptionsPage()}
      >
        Settings ⚙️
      </button>
    </div>
  );
}
