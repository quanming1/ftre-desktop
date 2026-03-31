import { ipcMain } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { getMainWindow } from '../app-state';

const watchers = new Map<string, fs.FSWatcher>();

export function registerWatcherIPC(): void {
  ipcMain.handle('fs:watch', async (_event, { filePath }: { filePath: string }) => {
    if (watchers.has(filePath)) return;
    try {
      let debounceTimer: NodeJS.Timeout | null = null;
      const pendingPaths = new Set<string>();

      const watcher = fs.watch(filePath, { recursive: true }, (_eventType, filename) => {
        const mainWindow = getMainWindow();
        if (!mainWindow || mainWindow.isDestroyed()) return;
        const changedPath = filename
          ? path.join(filePath, filename).replace(/\\/g, '/')
          : filePath;

        pendingPaths.add(changedPath);
        if (!debounceTimer) {
          debounceTimer = setTimeout(() => {
            for (const p of pendingPaths) {
              mainWindow.webContents.send('fs:fileChanged', { filePath: p });
            }
            pendingPaths.clear();
            debounceTimer = null;
          }, 150);
        }
      });
      watchers.set(filePath, watcher);
    } catch (err) {
      // Silently ignore watcher errors
    }
  });

  ipcMain.handle('fs:unwatch', async (_event, { filePath }: { filePath: string }) => {
    const watcher = watchers.get(filePath);
    if (watcher) {
      watcher.close();
      watchers.delete(filePath);
    }
  });
}
