import { app, BrowserWindow } from 'electron';

let mainWindow: BrowserWindow | null = null;

export const isDev = !app.isPackaged;

export function setMainWindow(win: BrowserWindow | null): void {
  mainWindow = win;
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}
