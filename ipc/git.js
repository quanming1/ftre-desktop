/**
 * Git IPC 模块
 *
 * 封装所有 git 相关的 IPC handler。
 * main.js 中调用 registerGitIPC() 注册。
 */

const { ipcMain } = require('electron');
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// ── 工具函数 ────────────────────────────────────────────────────────

/** 在指定 cwd 执行 git 命令，返回 stdout 字符串。失败返回 null。 */
function gitExec(args, cwd, opts = {}) {
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

/**
 * 读取 git 中某个 ref 下的文件内容。
 *
 * @param {string} cwd    仓库路径
 * @param {string} ref    引用：'HEAD'、分支名、空字符串(INDEX)
 * @param {string} fp     文件相对路径
 * @returns {string}      文件内容，失败返回空字符串
 */
function gitShowFile(cwd, ref, fp) {
    // ref 为空 → 读 INDEX（暂存区）：git show :path
    // ref 非空 → 读指定 ref：git show HEAD:path
    const spec = ref ? `${ref}:${fp}` : `:${fp}`;
    const result = gitExec(`show "${spec}"`, cwd);
    return result ?? '';
}

/** 读取磁盘文件内容。失败返回空字符串。 */
function readDiskFile(rootPath, filePath) {
    try {
        return fs.readFileSync(path.join(rootPath, filePath), 'utf-8');
    } catch {
        return '';
    }
}

// ── 状态解析 ────────────────────────────────────────────────────────

const CONFLICT_PAIRS = new Set(['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']);

function charToStatus(c) {
    switch (c) {
        case 'M': case 'T': return 'modified';
        case 'A': return 'added';
        case 'D': return 'deleted';
        case 'R': return 'renamed';
        case 'C': return 'added';
        default:  return 'modified';
    }
}

function parseStatusLine(line, rootPath) {
    if (line.length < 3) return [];

    const X = line[0];
    const Y = line[1];
    const XY = X + Y;
    const rawPath = line.slice(3);

    // 未跟踪
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

    // 冲突
    if (CONFLICT_PAIRS.has(XY) || X === 'U' || Y === 'U') {
        return [{
            path: rawPath,
            absolutePath: path.join(rootPath, rawPath).replace(/\\/g, '/'),
            status: 'conflict',
            staged: false,
            isDir: false,
        }];
    }

    // 重命名/复制路径拆分
    let filePath = rawPath;
    let oldPath = undefined;
    if (X === 'R' || X === 'C' || Y === 'R' || Y === 'C') {
        const arrowIdx = rawPath.indexOf(' -> ');
        if (arrowIdx !== -1) {
            oldPath = rawPath.slice(0, arrowIdx);
            filePath = rawPath.slice(arrowIdx + 4);
        }
    }

    // 双状态拆分
    const indexActive = X !== ' ' && X !== '?';
    const workTreeActive = Y !== ' ' && Y !== '?';
    const results = [];

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
    // 只有 index 变更但 work-tree 干净（如 'M ' 或 'A '）
    if (indexActive && !workTreeActive && results.length === 1) {
        // 已经在上面 push 了
    }
    // 只有 work-tree 变更（如 ' M'）
    if (!indexActive && workTreeActive && results.length === 1) {
        // 已经在上面 push 了
    }

    return results;
}

// ── IPC 注册 ────────────────────────────────────────────────────────

function registerGitIPC() {

    // git:info — 分支名 + 变更文件数
    ipcMain.handle('git:info', async (_event, { rootPath }) => {
        try {
            const branch = gitExec('rev-parse --abbrev-ref HEAD', rootPath);
            const statusOutput = gitExec('status --porcelain', rootPath);
            const changedFiles = statusOutput ? statusOutput.split('\n').length : 0;
            return { branch, changedFiles, isGitRepo: true };
        } catch {
            return { branch: null, changedFiles: 0, isGitRepo: false };
        }
    });

    // git:status — 变更文件列表
    ipcMain.handle('git:status', async (_event, { rootPath }) => {
        try {
            const output = gitExec('status --porcelain -uall', rootPath);
            if (!output) return { files: [] };

            const files = [];
            for (const line of output.split('\n')) {
                files.push(...parseStatusLine(line, rootPath));
            }
            return { files };
        } catch (err) {
            return { files: [], error: err.message };
        }
    });

    // git:stage — 暂存文件
    ipcMain.handle('git:stage', async (_event, { rootPath, filePath }) => {
        const result = gitExec(`add "${filePath}"`, rootPath);
        return result !== null ? { success: true } : { success: false, error: 'git add failed' };
    });

    // git:unstage — 取消暂存
    ipcMain.handle('git:unstage', async (_event, { rootPath, filePath }) => {
        const result = gitExec(`reset HEAD "${filePath}"`, rootPath);
        return result !== null ? { success: true } : { success: false, error: 'git reset failed' };
    });

    // git:commit — 提交
    ipcMain.handle('git:commit', async (_event, { rootPath, message }) => {
        const escaped = message.replace(/"/g, '\\"');
        const result = gitExec(`commit -m "${escaped}"`, rootPath);
        return result !== null ? { success: true } : { success: false, error: 'git commit failed' };
    });

    // git:show — 读取 HEAD 版本文件内容
    ipcMain.handle('git:show', async (_event, { rootPath, filePath }) => {
        const content = gitShowFile(rootPath, 'HEAD', filePath);
        return { content };
    });

    // git:diff-file — 获取 diff 两边内容（一次调用搞定所有场景）
    ipcMain.handle('git:diff-file', async (_event, { rootPath, filePath, status, staged, oldPath }) => {
        try {
            const lookupPath = oldPath || filePath;

            if (status === 'untracked' || status === 'added') {
                return { original: '', modified: readDiskFile(rootPath, filePath) };
            }

            if (status === 'deleted') {
                return { original: gitShowFile(rootPath, 'HEAD', lookupPath), modified: '' };
            }

            if (staged) {
                // 已暂存：HEAD vs INDEX
                return {
                    original: gitShowFile(rootPath, 'HEAD', lookupPath),
                    modified: gitShowFile(rootPath, '', filePath),
                };
            }

            // 未暂存：INDEX（或 HEAD）vs 磁盘
            let original = gitShowFile(rootPath, '', filePath);
            if (!original) original = gitShowFile(rootPath, 'HEAD', lookupPath);
            return { original, modified: readDiskFile(rootPath, filePath) };
        } catch (err) {
            return { original: '', modified: '', error: err.message };
        }
    });
}

module.exports = { registerGitIPC };
