import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { DEFAULT_WS_URL, normalizeGatewayUrl, wsClient } from "@/services/websocket-client";
import { useWsStatus } from "@/stores/chat";

const STORE_KEY = "gatewayUrl";

export function GatewaySettings() {
  const wsStatus = useWsStatus();
  const [url, setUrl] = useState(wsClient.url);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (window.desktop?.store) {
      window.desktop.store.get(STORE_KEY).then(({ value }) => {
        if (typeof value === "string" && value) {
          const normalized = normalizeGatewayUrl(value);
          setUrl(normalized);
          if (normalized !== value) {
            void window.desktop.store?.set(STORE_KEY, normalized);
          }
        }
      });
    }
  }, []);

  const handleSave = async () => {
    const normalized = normalizeGatewayUrl(url);
    setUrl(normalized);
    if (window.desktop?.store) {
      await window.desktop.store.set(STORE_KEY, normalized);
    }
    wsClient.setUrl(normalized);
    if (!wsClient.connected) {
      wsClient.reconnect();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => setUrl(DEFAULT_WS_URL);
  const handleReconnect = () => wsClient.reconnect();

  const statusLabel = () => {
    switch (wsStatus) {
      case "connected": return "已连接";
      case "reconnecting": return "重连中...";
      case "connecting": return "连接中...";
      default: return "未连接";
    }
  };

  const isConnected = wsStatus === "connected";
  const isTransitioning = wsStatus === "connecting" || wsStatus === "reconnecting";

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-black">网关连接</h2>
        <p className="text-[12px] text-black/40 mt-1">配置 ftre gateway 的 WebSocket 连接地址</p>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-black/[0.01] border border-black/[0.06]">
        <span className={`h-2 w-2 rounded-full ${isConnected ? "bg-black/50" : isTransitioning ? "bg-black/30 animate-pulse" : "bg-black/15"}`} />
        <span className="text-[13px] text-black/70">{statusLabel()}</span>
        {!isConnected && (
          <button onClick={handleReconnect} className="ml-auto text-[12px] text-black/40 hover:text-black active:scale-[0.96] transition-[color,transform]">
            重连
          </button>
        )}
      </div>

      <div>
        <div className="text-[12px] font-semibold text-black/70 mb-2">WebSocket 地址</div>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_WS_URL}
            className="flex-1 h-10 px-3.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white font-mono transition-all"
          />
          <button onClick={handleReset} className="h-10 px-4 rounded-lg border border-black/[0.08] text-[12px] text-black/50 hover:text-black hover:bg-black/[0.02] active:scale-[0.96] transition-[color,background-color,transform]">
            重置
          </button>
        </div>
        <div className="text-[11px] text-black/30 mt-1.5">默认: {DEFAULT_WS_URL}</div>
      </div>

      <div className="flex items-center gap-3 pt-4 border-t border-black/[0.06]">
        <button
          onClick={handleSave}
          className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform]"
        >
          保存并重连
        </button>
        {saved && <span className="text-[12px] text-black/40">已保存</span>}
      </div>
    </div>
  );
}