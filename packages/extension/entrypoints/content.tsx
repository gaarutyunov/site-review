import { defineContentScript } from "wxt/utils/define-content-script";
import { createShadowRootUi } from "wxt/utils/content-script-ui/shadow-root";
import ReactDOM from "react-dom/client";
import { App } from "../components/App";

export default defineContentScript({
  matches: ["<all_urls>"],
  cssInjectionMode: "ui",
  runAt: "document_idle",
  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: "site-review-ui",
      position: "overlay",
      anchor: "body",
      // keep the host on top of everything and click-through by default
      append: "last",
      onMount(container) {
        const host = (container.getRootNode() as ShadowRoot).host as HTMLElement;
        host.style.position = "fixed";
        host.style.inset = "0";
        host.style.zIndex = "2147483647";
        host.style.pointerEvents = "none";
        container.style.pointerEvents = "none";
        const root = ReactDOM.createRoot(container);
        root.render(<App host={host} />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
  },
});
