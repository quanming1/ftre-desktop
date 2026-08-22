import { ipcMain } from "electron";
import * as path from "path";
import * as fs from "fs";
import { getMainWindow } from "../app-state";

type WatcherEntry = {
  watcher: fs.FSWatcher;
  debounceTimer: NodeJS.Timeout | null;
  pendingPaths: Set<string>;
};

const watchers = new Map<string, WatcherEntry>();

export function registerWatcherIPC(): void {
  ipcMain.handle("fs:watch", async (_event, { filePath }: { filePath: string }) => {
    if (watchers.has(filePath)) return;
    try {
      let entry: WatcherEntry;
      const watcher = fs.watch(filePath, { recursive: true }, (_eventType, filename) => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const changedPath = filename
          ? path.join(filePath, filename).replace(/\\/g, "/")
          : filePath;

        entry.pendingPaths.add(changedPath);
        if (!entry.debounceTimer) {
          entry.debounceTimer = setTimeout(() => {
            for (const changed of entry.pendingPaths) {
              mainWindow.webContents.send("fs:fileChanged", { filePath: changed });
            }
            entry.pendingPaths.clear();
            entry.debounceTimer = null;
          }, 150);
        }
      });
      entry = { watcher, debounceTimer: null, pendingPaths: new Set<string>() };
      watchers.set(filePath, entry);
    } catch {
      // 目录可能被删除或当前系统不支持 recursive watch；调用方保持可重试。
    }
  });

  ipcMain.handle("fs:unwatch", async (_event, { filePath }: { filePath: string }) => {
    disposeWatcher(filePath);
  });
}

function disposeWatcher(filePath: string): void {
  const entry = watchers.get(filePath);
  if (!entry) return;
  if (entry.debounceTimer) clearTimeout(entry.debounceTimer);
  entry.debounceTimer = null;
  entry.pendingPaths.clear();
  entry.watcher.close();
  watchers.delete(filePath);
}

/** 应用退出时由主进程调用；重复调用安全且不会留下 debounce timer。 */
export function disposeWatcherIPC(): void {
  for (const filePath of Array.from(watchers.keys())) disposeWatcher(filePath);
}
