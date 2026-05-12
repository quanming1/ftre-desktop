/**
 * GatewaySettings - Gateway 连接地址配置
 *
 * 允许用户配置 ai-base gateway 的 WebSocket 地址。
 * 修改后保存到 store 并触发 WS 重连。
 */

import { useState, useEffect } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { wsClient } from "@/services/websocket-client";
import { useWsStatus } from "@/stores/chat";

const DEFAULT_GATEWAY_URL = "ws://127.0.0.1:18790/";
const STORE_KEY = "gatewayUrl";

export function GatewaySettings() {
  const wsStatus = useWsStatus();
  const [url, setUrl] = useState(wsClient.url);
  const [saved, setSaved] = useState(false);

  // Load saved URL from store on mount
  useEffect(() => {
    if (window.desktop?.store) {
      window.desktop.store.get(STORE_KEY).then(({ value }) => {
        if (typeof value === "string" && value) {
          setUrl(value);
        }
      });
    }
  }, []);

  const handleSave = async () => {
    // Save to persistent store
    if (window.desktop?.store) {
      await window.desktop.store.set(STORE_KEY, url);
    }
    // Update WS client and always reconnect
    wsClient.setUrl(url);
    if (!wsClient.connected) {
      wsClient.reconnect();
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleReset = () => {
    setUrl(DEFAULT_GATEWAY_URL);
  };

  const handleReconnect = () => {
    wsClient.reconnect();
  };

  const statusIcon = () => {
    switch (wsStatus) {
      case "connected":
        return <Wifi size={14} className="text-green-400" />;
      case "reconnecting":
      case "connecting":
        return <RefreshCw size={14} className="text-yellow-400 animate-spin" />;
      default:
        return <WifiOff size={14} className="text-red-400" />;
    }
  };

  const statusText = () => {
    switch (wsStatus) {
      case "connected":
        return "已连接";
      case "reconnecting":
        return "重连中...";
      case "connecting":
        return "连接中...";
      default:
        return "未连接";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[16px] font-semibold text-t-primary mb-2">
          Gateway Connection
        </h2>
        <p className="text-[13px] text-t-secondary">
          配置 AI 后端 (ai-base gateway) 的 WebSocket 连接地址。
          修改后点击保存将自动重连到新地址。
        </p>
      </div>

      {/* Connection status */}
      <div className="flex items-center gap-2 p-3 rounded-md bg-elevated border border-border">
        {statusIcon()}
        <span className="text-[13px] text-t-primary">{statusText()}</span>
        {wsStatus !== "connected" && (
          <button
            onClick={handleReconnect}
            className="ml-auto text-[12px] px-2 py-1 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
          >
            重连
          </button>
        )}
      </div>

      {/* URL input */}
      <div className="space-y-2">
        <label className="text-[13px] font-medium text-t-primary">
          WebSocket 地址
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_GATEWAY_URL}
            className="flex-1 h-9 px-3 rounded-md bg-elevated border border-border text-[13px] text-t-primary placeholder:text-t-ghost focus:outline-none focus:border-accent"
          />
          <button
            onClick={handleReset}
            className="px-3 h-9 rounded-md border border-border text-[12px] text-t-secondary hover:bg-elevated transition-colors"
          >
            重置
          </button>
        </div>
        <p className="text-[12px] text-t-muted">
          默认: {DEFAULT_GATEWAY_URL}
        </p>
      </div>

      {/* Save button */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-4 h-9 rounded-md bg-accent text-white text-[13px] font-medium hover:bg-accent/90 transition-colors"
        >
          保存并重连
        </button>
        {saved && (
          <span className="text-[12px] text-green-400">已保存</span>
        )}
      </div>
    </div>
  );
}
