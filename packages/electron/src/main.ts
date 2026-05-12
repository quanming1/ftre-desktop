import { app, BrowserWindow, ipcMain, shell } from "electron";
import { isDev, setMainWindow, getMainWindow } from "./app-state";
import { createWindow } from "./window";
import { registerFsIPC } from "./ipc/fs";
import { registerGitIPC } from "./ipc/git";
import { registerTerminalIPC } from "./ipc/terminal";
import { registerStoreIPC } from "./ipc/store";
import { registerSearchIPC } from "./ipc/search";
import { registerWatcherIPC } from "./ipc/watcher";
import { registerMemoryIPC } from "./ipc/memory";
import { WorkerManager } from "./ipc/worker-manager";

// GPU 加速 + 滚动性能优化
app.commandLine.appendSwitch("enable-gpu-rasterization");
app.commandLine.appendSwitch("enable-zero-copy");
app.commandLine.appendSwitch("enable-features", "CanvasOopRasterization");

// Worker 线程管理
const workerManager = new WorkerManager();

// --- 窗口控制 IPC ---
ipcMain.handle("window:minimize", () => {
  getMainWindow()?.minimize();
});
ipcMain.handle("window:maximize", () => {
  const win = getMainWindow();
  if (win?.isMaximized()) win.unmaximize();
  else win?.maximize();
});
ipcMain.handle("window:close", () => {
  getMainWindow()?.close();
});
ipcMain.handle("window:getPosition", () => {
  const win = getMainWindow();
  return win ? win.getPosition() : [0, 0];
});
ipcMain.handle(
  "window:setPosition",
  (_event, { x, y }: { x: number; y: number }) => {
    getMainWindow()?.setPosition(x, y);
  },
);
ipcMain.handle(
  "window:isMaximized",
  () => getMainWindow()?.isMaximized() ?? false,
);

// --- Shell ---
ipcMain.handle("shell:openExternal", (_event, url: string) => {
  return shell.openExternal(url);
});

// --- 生命周期 ---

app.whenReady().then(() => {
  // 注册 IPC handlers
  registerFsIPC();
  registerGitIPC();
  registerTerminalIPC();
  registerStoreIPC();
  registerSearchIPC(workerManager);
  registerWatcherIPC();
  registerMemoryIPC();

  // 创建窗口
  const win = createWindow();
  setMainWindow(win);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const newWin = createWindow();
      setMainWindow(newWin);
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  workerManager.dispose();
});
