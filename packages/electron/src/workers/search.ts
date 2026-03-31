/**
 * Search Worker — 在 Worker 线程中执行文件内容搜索
 */

import { parentPort } from 'worker_threads';
import * as fs from 'fs';
import * as path from 'path';
import { minimatch } from 'minimatch';

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

function isBinaryFile(filePath: string): boolean {
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

function collectFiles(dirPath: string, includePattern: string, excludePattern: string): string[] {
  const results: string[] = [];
  let hitLimit = false;

  function walk(dir: string): void {
    if (hitLimit) return;
    let items: fs.Dirent[];
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

interface SearchOptions {
  caseSensitive?: boolean;
  wholeWord?: boolean;
  useRegex?: boolean;
  includePattern?: string;
  excludePattern?: string;
}

interface SearchMatch {
  lineNumber: number;
  lineContent: string;
  matchStart: number;
  matchEnd: number;
}

interface SearchResult {
  filePath: string;
  fileName: string;
  matches: SearchMatch[];
}

function executeSearch({ rootPath, query, options = {} }: { rootPath: string; query: string; options?: SearchOptions }): { results: SearchResult[]; error?: string } {
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

  let pattern: RegExp;
  try {
    let src = useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (wholeWord) {
      src = `\\b${src}\\b`;
    }
    const flags = caseSensitive ? 'g' : 'gi';
    pattern = new RegExp(src, flags);
  } catch (err: any) {
    return { results: [], error: `Invalid regex: ${err.message}` };
  }

  const files = collectFiles(rootPath, includePattern, excludePattern);
  const results: SearchResult[] = [];

  for (const filePath of files) {
    if (results.length >= MAX_RESULT_FILES) break;

    try {
      const stat = fs.statSync(filePath);
      if (stat.size > MAX_FILE_SIZE) continue;
    } catch {
      continue;
    }

    if (isBinaryFile(filePath)) continue;

    let content: string;
    try {
      content = fs.readFileSync(filePath, 'utf-8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    const matches: SearchMatch[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
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

parentPort?.on('message', ({ taskId, payload }: { taskId: number; payload: any }) => {
  try {
    const result = executeSearch(payload);
    parentPort?.postMessage({ taskId, result });
  } catch (err: any) {
    parentPort?.postMessage({ taskId, error: err.message });
  }
});
