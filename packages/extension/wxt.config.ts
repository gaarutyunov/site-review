import { defineConfig } from "wxt";

// https://wxt.dev/api/config.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],
  manifest: {
    name: "Site Review",
    description:
      "Leave comments on website elements for AI agents to fix. Option+C to comment.",
    action: {
      default_icon: {
        "16": "icon/16.png",
        "32": "icon/32.png",
        "48": "icon/48.png",
        "128": "icon/128.png",
      },
    },
    permissions: ["storage", "activeTab", "scripting", "unlimitedStorage"],
    host_permissions: ["http://localhost/*", "http://127.0.0.1/*"],
    commands: {
      "toggle-comment-mode": {
        suggested_key: { default: "Alt+C", mac: "Alt+C" },
        description: "Start commenting on an element",
      },
      "toggle-multi-mode": {
        suggested_key: { default: "Alt+Shift+C", mac: "Alt+Shift+C" },
        description: "Start a multi-element comment",
      },
    },
  },
});
