/**
 * Search Worker — 在 Worker 线程中执行文件内容搜索
 *
 * 所有文件 I/O（readdirSync / readFileSync）都在此线程中同步执行，
 * 不会阻塞 Electron 主进程的事件循环。
 *
 * 通信协议 (WorkerManager 标准):
 *   主线程 → Worker:  { taskId, payload: { rootPath, query, options } }
 *   Worker → 主线程:  { taskId, result: { results, error? } }
 *                  或  { taskId, error: string }
 */

'use strict';

const { parentPort } = require('worker_threads');
const fs = require('fs');
const path = require('path');
const { minimatch } = require('minimatch');

// ── 常量 ────────────────────────────────────────────────────────────

const SEARCH_SKIP_DIRS = new Set([
    '.git', '.hg', '.svn',
    'node_modules', '__pycache__',
    'dist', 'build', 'out',
    '.next', '.nuxt',
    'vendor', '.venv', 'venv', 'env',
    'target', '.ftre', 'coverage', '.cache',
    '.turbo', '.parcel-cache', '.output',
    '.tox', '.mypy_cache', '.pytest_cache',
]);

const MAX_SEARCH_FILES = 20_000;
const MAX_RESULT_FILES = 200;
const MAX_FILE_SIZE = 1_048_576; // 1 MB

// ── 工具函数 ────────────────────────────────────────────────────────

/**
 * 判断文件是否为二进制文件（通过检查前 8KB 是否包含 NULL 字节）
 */
function isBinaryFile(filePath) {
    try {
        const fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        fs.closeSync(fd);
        for (let i = 0; i < bytesRead; i++) {
            if (buf[i] === 0) return true;
        }
        return false;
    } catch {
        return true;
    }
}

/**
 * 递归收集目录下所有文件路径，跳过 SEARCH_SKIP_DIRS 和隐藏目录。
 * 受 MAX_SEARCH_FILES 限制。
 */
function collectFiles(dirPath, includePattern, excludePattern) {
    const results = [];
    let hitLimit = false;

    function walk(dir) {
        if (hitLimit) return;
        let items;
        try {
            items = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }
        for (const item of items) {
            if (hitLimit) return;
            if (item.name.startsWith('.') && item.isDirectory()) continue;
            const fullPath = path.join(dir, item.name).replace(/\\/g, '/');
            if (item.isDirectory()) {
                if (SEARCH_SKIP_DIRS.has(item.name)) continue;
                walk(fullPath);
            } else {
                results.push(fullPath);
                if (results.length >= MAX_SEARCH_FILES) {
                    hitLimit = true;
                    return;
                }
            }
        }
    }

    walk(dirPath);

    // Apply glob filters
    return results.filter((fp) => {
        const relativePath = path.relative(dirPath, fp).replace(/\\/g, '/');
        if (includePattern) {
            const patterns = includePattern.split(',').map(p => p.trim()).filter(Boolean);
            if (patterns.length > 0) {
                const matches = patterns.some(p => minimatch(relativePath, p, { matchBase: true }));
                if (!matches) return false;
            }
        }
        if (excludePattern) {
            const patterns = excludePattern.split(',').map(p => p.trim()).filter(Boolean);
            if (patterns.length > 0) {
                const excluded = patterns.some(p => minimatch(relativePath, p, { matchBase: true }));
                if (excluded) return false;
            }
        }
        return true;
    });
}

/**
 * 执行文件内容搜索
 */
function executeSearch({ rootPath, query, options = {} }) {
    const {
        caseSensitive = false,
        wholeWord = false,
        useRegex = false,
        includePattern = '',
        excludePattern = '',
    } = options;

    if (!query) {
        return { results: [] };
    }

    // Build the regex pattern
    let pattern;
    try {
        let src = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        if (wholeWord) {
            src = `\\b${src}\\b`;
        }
        const flags = caseSensitive ? 'g' : 'gi';
        pattern = new RegExp(src, flags);
    } catch (err) {
        return { results: [], error: `Invalid regex: ${err.message}` };
    }

    const files = collectFiles(rootPath, includePattern, excludePattern);
    const results = [];

    for (const filePath of files) {
        if (results.length >= MAX_RESULT_FILES) break;

        // 跳过大文件
        try {
            const stat = fs.statSync(filePath);
            if (stat.size > MAX_FILE_SIZE) continue;
        } catch {
            continue;
        }

        if (isBinaryFile(filePath)) continue;

        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch {
            continue;
        }

        const lines = content.split('\n');
        const matches = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(line)) !== null) {
                matches.push({
                    lineNumber: i + 1,
                    lineContent: line,
                    matchStart: match.index,
                    matchEnd: match.index + match[0].length,
                });
                if (match[0].length === 0) {
                    pattern.lastIndex++;
                }
                if (matches.length >= 100) break;
            }
            if (matches.length >= 100) break;
        }

        if (matches.length > 0) {
            results.push({
                filePath: filePath.replace(/\\/g, '/'),
                fileName: path.basename(filePath),
                matches,
            });
        }
    }

    return { results };
}

// ── Worker 消息处理（WorkerManager 标准协议）────────────────────────

parentPort.on('message', ({ taskId, payload }) => {
    try {
        const result = executeSearch(payload);
        parentPort.postMessage({ taskId, result });
    } catch (err) {
        parentPort.postMessage({ taskId, error: err.message });
    }
});
