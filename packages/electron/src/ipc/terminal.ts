import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'os';
import { getMainWindow } from '../app-state';

const terminals = new Map<number, pty.IPty>();
let termIdCounter = 0;

export function registerTerminalIPC(): void {
  ipcMain.handle('pty:create', (_event, { cols, rows, cwd, shell: requestedShell }: { cols?: number; rows?: number; cwd?: string; shell?: string }) => {
    const id = ++termIdCounter;
    const shell = requestedShell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const term = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: cols || 80,
      rows: rows || 24,
      cwd: cwd || os.homedir(),
      env: process.env as { [key: string]: string },
    });

    terminals.set(id, term);

    term.onData((data: string) => {
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:data', { id, data });
      }
    });

    term.onExit(({ exitCode }: { exitCode: number }) => {
      terminals.delete(id);
      const mainWindow = getMainWindow();
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('pty:exit', { id, exitCode });
      }
    });

    return { id };
  });

  ipcMain.handle('pty:write', (_event, { id, data }: { id: number; data: string }) => {
    const term = terminals.get(id);
    if (term) term.write(data);
  });

  ipcMain.handle('pty:resize', (_event, { id, cols, rows }: { id: number; cols: number; rows: number }) => {
    const term = terminals.get(id);
    if (term) term.resize(cols, rows);
  });

  ipcMain.handle('pty:kill', (_event, { id }: { id: number }) => {
    const term = terminals.get(id);
    if (term) {
      term.kill();
      terminals.delete(id);
    }
  });
}
