import { useState, useEffect } from "react";
import { Workbench } from "./Workbench";
import { LoadingScreen } from "./LoadingScreen";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus } from "@/services/websocket-client";

function useWsStatus(): WsConnectionStatus {
  const [status, setStatus] = useState<WsConnectionStatus>(wsClient.status);
  useEffect(() => {
    return wsClient.onStatusChange(setStatus);
  }, []);
  return status;
}

export function App() {
  const status = useWsStatus();
  const isElectron = !!window.desktop?.isElectron;
  const connected = status === "connected";

  // 打包模式：WS 未连接时显示 loading，连上后显示主界面
  // 开发模式：直接显示主界面（后端已单独启动）
  if (isElectron && !connected) {
    return <LoadingScreen />;
  }

  return <Workbench />;
}
