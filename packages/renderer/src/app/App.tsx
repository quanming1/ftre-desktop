import { useSyncExternalStore } from "react";
import { Workbench } from "./Workbench";
import { LoadingScreen } from "./LoadingScreen";
import { wsClient } from "@/services/websocket-client";
import type { WsConnectionStatus } from "@/services/websocket-client";

// useSyncExternalStore 订阅后会重新校验快照：
// loopback 下 WS 可能在 render 读取快照与 effect 完成订阅之间极速连通，
// 旧的 useState+useEffect 写法会永久丢失 "connected" 通知（启动卡 LoadingScreen 的根因）。
function useWsStatus(): WsConnectionStatus {
  return useSyncExternalStore(
    (callback) => wsClient.onStatusChange(callback),
    () => wsClient.status,
  );
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
