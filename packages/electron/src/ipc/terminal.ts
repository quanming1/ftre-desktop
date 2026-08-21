import { ipcMain } from 'electron';
import * as pty from 'node-pty';
import * as os from 'os';
import { getMainWindow } from '../app-state';

const terminals = new Map<number, pty.IPty>();
let termIdCounter = 0;

function shellName(shell: string): string {
  return shell.replace(/\\/g, '/').split('/').pop()?.toLowerCase() ?? '';
}

/**
 * Windows PowerShell 5.1 默认仍使用系统代码页读取无 BOM 的 UTF-8 文件。
 * 终端里执行 Get-Content/cat 时会先在 shell 内把中文读坏，PTY 本身再转发
 * 也无法恢复，所以在交互 shell 启动前统一切到 UTF-8。
 */
function getShellArgs(shell: string): string[] {
  if (process.platform !== 'win32') return [];

  const name = shellName(shell);
  if (name === 'powershell' || name === 'powershell.exe' || name === 'pwsh' || name === 'pwsh.exe') {
    const utf8Bootstrap = [
      '$utf8 = [System.Text.UTF8Encoding]::new($false)',
      '[Console]::InputEncoding = $utf8',
      '[Console]::OutputEncoding = $utf8',
      '$OutputEncoding = $utf8',
      "$PSDefaultParameterValues['*:Encoding'] = 'utf8'",
    ].join('; ');
    return ['-NoLogo', '-NoProfile', '-NoExit', '-Command', utf8Bootstrap];
  }

  if (name === 'cmd' || name === 'cmd.exe') {
    return ['/K', 'chcp 65001>nul'];
  }

  return [];
}

export function registerTerminalIPC(): void {
  ipcMain.handle('pty:create', (_event, { cols, rows, cwd, shell: requestedShell }: { cols?: number; rows?: number; cwd?: string; shell?: string }) => {
    const id = ++termIdCounter;
    const shell = requestedShell || (process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash');
    const term = pty.spawn(shell, getShellArgs(shell), {
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
