import React from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary, TooltipProvider } from "@ftre/ui";
import { App } from "./App";
import { setHljsTheme } from "@/lib/hljs-theme-loader";
import { useTheme } from "@/stores/theme";
import { initConnection } from "@/services/api";
import { normalizeGatewayUrl, wsClient } from "@/services/websocket-client";

import "../styles/tokens.css";
import "../styles/tailwind.css";
import "../styles/reset.css";
import "../styles/global.css";
import "../styles/markdown.css";
import "@ftre/ui/styles.css";
import "overlayscrollbars/styles/overlayscrollbars.css";
import "sonner/dist/styles.css";
import "katex/dist/katex.min.css";
import "@jiang_quan_ming/react-code-diff/style.css";

void (async () => {
  if (window.desktop?.store) {
    const { value } = await window.desktop.store.get("gatewayUrl");
    if (typeof value === "string" && value) {
      const normalized = normalizeGatewayUrl(value);
      if (normalized !== value) {
        await window.desktop.store.set("gatewayUrl", normalized);
      }
      wsClient.setUrl(normalized);
    }
  }
  initConnection();
})();

void (async () => {
  await useTheme.getState().init();
  setHljsTheme(useTheme.getState().resolvedMode);

  useTheme.subscribe((state, previous) => {
    if (state.resolvedMode !== previous.resolvedMode) {
      setHljsTheme(state.resolvedMode);
    }
  });

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <TooltipProvider>
        <ErrorBoundary level="app">
          <App />
        </ErrorBoundary>
      </TooltipProvider>
    </React.StrictMode>,
  );

  requestIdleCallback(() => {
    void import("@jiang_quan_ming/react-code-diff").then(({ prewarm }) =>
      prewarm(),
    );
  });

  // 仅 dev：MessageList 性能压测入口（window.__ftrePerf），生产构建被静态消除
  if (import.meta.env.DEV) {
    void import("@/dev/perfHarness").then((m) => m.registerPerfHarness());
  }
})();
