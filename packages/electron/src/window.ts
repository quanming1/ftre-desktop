import { BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { isDev } from './app-state';

const VITE_DEV_URL = 'http://localhost:50000';

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'ftre',
    backgroundColor: '#00000000', // 透明背景
    transparent: true,
    frame: false,
    titleBarStyle: 'hidden',
    // Windows 11 毛玻璃效果
    ...(process.platform === 'win32' && {
      backgroundMaterial: 'mica' as const,
    }),
    // macOS 毛玻璃效果
    ...(process.platform === 'darwin' && {
      vibrancy: 'sidebar' as const,
      visualEffectState: 'followWindow' as const,
    }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // 去掉默认菜单栏
  mainWindow.setMenuBarVisibility(false);

  // 阻止 window.open / target="_blank" 在 Electron 内打开新窗口，改为默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  // 开发模式加载 Vite dev server，生产模式加载打包后的文件
  if (isDev) {
    mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
  }

  return mainWindow;
}
