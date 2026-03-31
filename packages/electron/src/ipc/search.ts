import { ipcMain } from 'electron';
import * as path from 'path';
import { WorkerManager } from './worker-manager';

const CHANNEL = 'search';
const WORKER_PATH = path.join(__dirname, '..', 'workers', 'search.js');

export function registerSearchIPC(manager: WorkerManager): void {
  manager.register(CHANNEL, {
    workerPath: WORKER_PATH,
    mode: 'exclusive',
    timeout: 30_000,
  });

  ipcMain.handle('fs:search', async (_event, { rootPath, query, options = {} }: { rootPath: string; query: string; options?: any }) => {
    if (!query) {
      return { results: [] };
    }

    const result = await manager.run(CHANNEL, { rootPath, query, options });

    if (result.error && !result.results) {
      return { results: [], error: result.error };
    }
    return result;
  });
}
