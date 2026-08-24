import { BrowserWindow, shell } from 'electron';
import * as path from 'path';
import { isDev } from './app-state';

// dev server 端口由根 scripts/dev.mjs 解析 ~/.ftre/config.json 的
// servers.frontend.port 后通过 FTRE_FRONTEND_PORT 注入；缺省回退 48651。
const VITE_DEV_PORT = Number(process.env.FTRE_FRONTEND_PORT) || 48651;
const VITE_DEV_URL = `http://localhost:${VITE_DEV_PORT}`;

// 生产入口通过 renderer/index.html 声明相同策略；开发入口还需要在主文档
// 响应头中声明，才能让 Electron 在加载 Vite dev server 时建立安全基线。
const RENDERER_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http: https: ws: wss:",
  "media-src 'self' data: blob:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

let devCspRegistered = false;

function registerDevCsp(mainWindow: BrowserWindow): void {
  if (devCspRegistered) return;
  devCspRegistered = true;
  mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    if (details.resourceType !== "mainFrame") {
      callback({ responseHeaders: details.responseHeaders });
      return;
    }
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [RENDERER_CSP],
      },
    });
  });
}

export function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 800,
    minHeight: 600,
    title: 'ftre',
    backgroundColor: '#1e1e1e',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // preload 加载失败时 Electron 默认只在 DevTools 控制台给出弱提示；记录
  // 绝对路径和原始错误，避免 Renderer 只看到 window.desktop undefined。
  mainWindow.webContents.on("preload-error", (_event, preloadPath, error) => {
    console.error(`[window] preload 加载失败: ${preloadPath}`, error);
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
    registerDevCsp(mainWindow);
    // dev server 可能比 electron 晚就绪；加载失败时自动重试，避免停在
    // chrome-error 页（黑屏）。
    const loadDev = () => mainWindow.loadURL(VITE_DEV_URL);
    mainWindow.webContents.on('did-fail-load', (_e, errorCode) => {
      // -3 是 ERR_ABORTED（正常导航打断），忽略
      if (errorCode === -3) return;
      console.warn(`[window] 加载 ${VITE_DEV_URL} 失败(${errorCode})，1s 后重试`);
      setTimeout(loadDev, 1000);
    });
    loadDev();
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'));
  }

  return mainWindow;
}
