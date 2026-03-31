import { ipcMain, app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';

const STATE_FILE = path.join(app.getPath('userData'), 'ftre-state.json');

function loadAppState(): Record<string, any> {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch { }
  return {};
}

function saveAppState(state: Record<string, any>): void {
  try {
    const current = loadAppState();
    const merged = { ...current, ...state };
    fs.writeFileSync(STATE_FILE, JSON.stringify(merged, null, 2), 'utf-8');
  } catch (err: any) {
    console.error('[desktop] 保存状态失败:', err.message);
  }
}

export function registerStoreIPC(): void {
  ipcMain.handle('store:get', async (_event, { key }: { key: string }) => {
    const state = loadAppState();
    return { value: state[key] ?? null };
  });

  ipcMain.handle('store:set', async (_event, { key, value }: { key: string; value: any }) => {
    saveAppState({ [key]: value });
    return { success: true };
  });
}
