import { ipcMain } from 'electron';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import type { GitInfo, GitFileStatus } from '@ftre/shared';

function gitExec(args: string, cwd: string, opts: any = {}): string | null {
  try {
    return execSync(`git ${args}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
      ...opts,
    }).trimEnd();
  } catch {
    return null;
  }
}

function gitShowFile(cwd: string, ref: string, fp: string): string {
  const spec = ref ? `${ref}:${fp}` : `:${fp}`;
  const result = gitExec(`show "${spec}"`, cwd);
  return result ?? '';
}

function readDiskFile(rootPath: string, filePath: string): string {
  try {
    return fs.readFileSync(path.join(rootPath, filePath), 'utf-8');
  } catch {
    return '';
  }
}

const CONFLICT_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function charToStatus(c: string): GitFileStatus['status'] {
  switch (c) {
    case 'M': case 'T': return 'modified';
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'R': return 'renamed';
    case 'C': return 'added';
    default: return 'modified';
  }
}

function parseStatusLine(line: string, rootPath: string): GitFileStatus[] {
  if (line.length < 3) return [];

  const X = line[0];
  const Y = line[1];
  const XY = X + Y;
  const rawPath = line.slice(3);

  if (X === '?' && Y === '?') {
    const isDir = rawPath.endsWith('/');
    const cleanPath = rawPath.replace(/\/$/, '');
    return [{
      path: cleanPath,
      absolutePath: path.join(rootPath, cleanPath).replace(/\\/g, '/'),
      status: 'untracked',
      staged: false,
      isDir,
    }];
  }

  if (CONFLICT_PAIRS.has(XY) || X === 'U' || Y === 'U') {
    return [{
      path: rawPath,
      absolutePath: path.join(rootPath, rawPath).replace(/\\/g, '/'),
      status: 'conflict',
      staged: false,
      isDir: false,
    }];
  }

  let filePath = rawPath;
  let oldPath: string | undefined = undefined;
  if (X === 'R' || X === 'C' || Y === 'R' || Y === 'C') {
    const arrowIdx = rawPath.indexOf(' -> ');
    if (arrowIdx !== -1) {
      oldPath = rawPath.slice(0, arrowIdx);
      filePath = rawPath.slice(arrowIdx + 4);
    }
  }

  const indexActive = X !== ' ' && X !== '?';
  const workTreeActive = Y !== ' ' && Y !== '?';
  const results: GitFileStatus[] = [];

  if (indexActive) {
    results.push({
      path: filePath, oldPath,
      absolutePath: path.join(rootPath, filePath).replace(/\\/g, '/'),
      status: charToStatus(X),
      staged: true,
      isDir: false,
    });
  }
  if (workTreeActive) {
    results.push({
      path: filePath,
      absolutePath: path.join(rootPath, filePath).replace(/\\/g, '/'),
      status: charToStatus(Y),
      staged: false,
      isDir: false,
    });
  }

  return results;
}

export function registerGitIPC(): void {
  ipcMain.handle('git:info', async (_event, { rootPath }: { rootPath: string }): Promise<GitInfo> => {
    try {
      const branch = gitExec('rev-parse --abbrev-ref HEAD', rootPath);
      const statusOutput = gitExec('status --porcelain', rootPath);
      const changedFiles = statusOutput ? statusOutput.split('\n').length : 0;
      return { branch, changedFiles, isGitRepo: true };
    } catch {
      return { branch: null, changedFiles: 0, isGitRepo: false };
    }
  });

  ipcMain.handle('git:status', async (_event, { rootPath }: { rootPath: string }) => {
    try {
      const output = gitExec('status --porcelain -uall', rootPath);
      if (!output) return { files: [] };

      const files: GitFileStatus[] = [];
      for (const line of output.split('\n')) {
        files.push(...parseStatusLine(line, rootPath));
      }
      return { files };
    } catch (err: any) {
      return { files: [], error: err.message };
    }
  });

  ipcMain.handle('git:stage', async (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    const result = gitExec(`add "${filePath}"`, rootPath);
    return result !== null ? { success: true } : { success: false, error: 'git add failed' };
  });

  ipcMain.handle('git:unstage', async (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    const result = gitExec(`reset HEAD "${filePath}"`, rootPath);
    return result !== null ? { success: true } : { success: false, error: 'git reset failed' };
  });

  ipcMain.handle('git:commit', async (_event, { rootPath, message }: { rootPath: string; message: string }) => {
    const escaped = message.replace(/"/g, '\\"');
    const result = gitExec(`commit -m "${escaped}"`, rootPath);
    return result !== null ? { success: true } : { success: false, error: 'git commit failed' };
  });

  ipcMain.handle('git:show', async (_event, { rootPath, filePath }: { rootPath: string; filePath: string }) => {
    const content = gitShowFile(rootPath, 'HEAD', filePath);
    return { content };
  });

  ipcMain.handle('git:diff-file', async (_event, { rootPath, filePath, status, staged, oldPath }: { rootPath: string; filePath: string; status: string; staged: boolean; oldPath?: string }) => {
    try {
      const lookupPath = oldPath || filePath;

      if (status === 'untracked' || status === 'added') {
        return { original: '', modified: readDiskFile(rootPath, filePath) };
      }

      if (status === 'deleted') {
        return { original: gitShowFile(rootPath, 'HEAD', lookupPath), modified: '' };
      }

      if (staged) {
        return {
          original: gitShowFile(rootPath, 'HEAD', lookupPath),
          modified: gitShowFile(rootPath, '', filePath),
        };
      }

      let original = gitShowFile(rootPath, '', filePath);
      if (!original) original = gitShowFile(rootPath, 'HEAD', lookupPath);
      return { original, modified: readDiskFile(rootPath, filePath) };
    } catch (err: any) {
      return { original: '', modified: '', error: err.message };
    }
  });
}
