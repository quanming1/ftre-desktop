import { BrowserWindow } from 'electron';
import * as path from 'path';
import { isDev } from './app-state';

const VITE_DEV_URL = 'http://localhost:5173';

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'AI IDE',
    backgroundColor: '#1e1e1e',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 去掉默认菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 开发模式加载 Vite dev server，生产模式加载打包后的文件
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
  }

  return mainWindow;
}
