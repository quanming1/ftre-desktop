import { performanceMetrics } from "@/services/performance-metrics";

interface IndexedFileItem {
  name: string;
  path: string;
  ext: string;
}

interface CacheEntry {
  files: IndexedFileItem[];
  loadedAt: number;
}

const SKIP_NAMES = new Set([
  ".git",
  "node_modules",
  "__pycache__",
  "dist",
  "build",
  ".next",
  "out",
  "coverage",
  "target",
  ".venv",
  "venv",
  ".idea",
  ".cache",
]);

const cache = new Map<string, CacheEntry>();
const inFlight = new Map<string, Promise<IndexedFileItem[]>>();
const suppressedInvalidations = new Map<string, number>();
const LOCAL_MUTATION_SUPPRESS_MS = 1500;
let watcherBound = false;
let listenerCleanup: (() => void) | null = null;

function shouldSkipEntry(name: string): boolean {
  return name.startsWith(".") || SKIP_NAMES.has(name);
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+$/, "");
}

function findRootsForPath(targetPath: string): string[] {
  const normalizedTarget = normalizePath(targetPath);
  const roots = new Set<string>();

  for (const root of [...cache.keys(), ...inFlight.keys()]) {
    if (
      normalizedTarget === root ||
      normalizedTarget.startsWith(root + "/") ||
      normalizedTarget.startsWith(root + "\\")
    ) {
      roots.add(root);
    }
  }

  return [...roots];
}

function sortAndTouch(entry: CacheEntry): void {
  entry.files.sort((a, b) => a.path.localeCompare(b.path));
  entry.loadedAt = Date.now();
}

function upsertFile(entry: CacheEntry, file: IndexedFileItem): void {
  const index = entry.files.findIndex((item) => item.path === file.path);
  if (index >= 0) {
    entry.files[index] = file;
  } else {
    entry.files.push(file);
  }
  sortAndTouch(entry);
}

function removeFileByPath(entry: CacheEntry, targetPath: string): void {
  const normalizedTarget = normalizePath(targetPath);
  const next = entry.files.filter(
    (file) => normalizePath(file.path) !== normalizedTarget,
  );
  if (next.length !== entry.files.length) {
    entry.files = next;
    sortAndTouch(entry);
  }
}

function removeFilesByPrefix(entry: CacheEntry, targetPath: string): void {
  const normalizedTarget = normalizePath(targetPath);
  const next = entry.files.filter((file) => {
    const normalizedFile = normalizePath(file.path);
    return !(
      normalizedFile === normalizedTarget ||
      normalizedFile.startsWith(normalizedTarget + "/")
    );
  });

  if (next.length !== entry.files.length) {
    entry.files = next;
    sortAndTouch(entry);
  }
}

function renameFileByPath(
  entry: CacheEntry,
  oldPath: string,
  newPath: string,
): void {
  const normalizedOld = normalizePath(oldPath);
  const normalizedNew = normalizePath(newPath);

  let changed = false;
  entry.files = entry.files.map((file) => {
    if (normalizePath(file.path) !== normalizedOld) return file;
    changed = true;
    return {
      ...file,
      name: normalizedNew.split("/").pop() ?? normalizedNew,
      path: normalizedNew,
    };
  });

  if (changed) {
    sortAndTouch(entry);
  }
}

function renameFilesByPrefix(
  entry: CacheEntry,
  oldPath: string,
  newPath: string,
): void {
  const normalizedOld = normalizePath(oldPath);
  const normalizedNew = normalizePath(newPath);

  let changed = false;
  entry.files = entry.files.map((file) => {
    const normalizedFile = normalizePath(file.path);
    if (
      normalizedFile !== normalizedOld &&
      !normalizedFile.startsWith(normalizedOld + "/")
    ) {
      return file;
    }

    changed = true;
    const nextPath = normalizedNew + normalizedFile.slice(normalizedOld.length);
    return {
      ...file,
      name: nextPath.split("/").pop() ?? nextPath,
      path: nextPath,
    };
  });

  if (changed) {
    sortAndTouch(entry);
  }
}

function pruneSuppressedInvalidations(now: number = Date.now()): void {
  for (const [path, expiresAt] of suppressedInvalidations.entries()) {
    if (expiresAt <= now) {
      suppressedInvalidations.delete(path);
    }
  }
}

function suppressInvalidation(targetPath: string): void {
  suppressedInvalidations.set(
    normalizePath(targetPath),
    Date.now() + LOCAL_MUTATION_SUPPRESS_MS,
  );
}

function isSuppressedInvalidation(targetPath: string): boolean {
  const normalizedTarget = normalizePath(targetPath);
  const now = Date.now();
  pruneSuppressedInvalidations(now);

  for (const [path, expiresAt] of suppressedInvalidations.entries()) {
    if (expiresAt <= now) continue;
    if (
      normalizedTarget === path ||
      normalizedTarget.startsWith(path + "/") ||
      path.startsWith(normalizedTarget + "/")
    ) {
      return true;
    }
  }

  return false;
}

function invalidateRoot(rootPath: string): void {
  performanceMetrics.count("fileIndex.invalidations");
  cache.delete(normalizePath(rootPath));
  inFlight.delete(normalizePath(rootPath));
}

function ensureWatcherBound(): void {
  if (watcherBound || !window.desktop?.fs?.onFileChanged) return;
  watcherBound = true;
  listenerCleanup = window.desktop.fs.onFileChanged((changedPath: string) => {
    const normalizedChanged = normalizePath(changedPath);

    if (isSuppressedInvalidation(normalizedChanged)) {
      return;
    }

    for (const root of [...cache.keys(), ...inFlight.keys()]) {
      if (
        normalizedChanged === root ||
        normalizedChanged.startsWith(root + "/") ||
        normalizedChanged.startsWith(root + "\\")
      ) {
        invalidateRoot(root);
      }
    }
  });
}

async function collectFiles(rootPath: string): Promise<IndexedFileItem[]> {
  const files: IndexedFileItem[] = [];
  const queue: string[] = [rootPath];

  while (queue.length > 0) {
    const dir = queue.shift()!;
    const result = await window.desktop.fs.readDir(dir);
    if (result.error || !result.entries) continue;

    for (const entry of result.entries) {
      if (shouldSkipEntry(entry.name)) continue;

      if (entry.isDir) {
        queue.push(entry.path);
      } else {
        files.push({
          name: entry.name,
          path: entry.path,
          ext: entry.ext || "",
        });
      }
    }
  }

  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

export async function getIndexedFiles(
  rootPath: string,
): Promise<IndexedFileItem[]> {
  const normalizedRoot = normalizePath(rootPath);
  ensureWatcherBound();

  const cached = cache.get(normalizedRoot);
  if (cached) return cached.files;

  const pending = inFlight.get(normalizedRoot);
  if (pending) return pending;

  const promise = performanceMetrics
    .measureAsync("fileIndex.build.ms", async () => {
      performanceMetrics.count("fileIndex.builds");
      const files = await collectFiles(normalizedRoot);
      cache.set(normalizedRoot, { files, loadedAt: Date.now() });
      inFlight.delete(normalizedRoot);
      return files;
    })
    .catch((err) => {
      inFlight.delete(normalizedRoot);
      throw err;
    });

  inFlight.set(normalizedRoot, promise);
  return promise;
}

export function addFileToIndex(filePath: string): void {
  const normalizedPath = normalizePath(filePath);
  const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
  if (shouldSkipEntry(fileName)) return;

  suppressInvalidation(normalizedPath);

  for (const root of findRootsForPath(normalizedPath)) {
    const entry = cache.get(root);
    if (!entry) continue;
    upsertFile(entry, {
      name: fileName,
      path: normalizedPath,
      ext: fileName.includes(".") ? (fileName.split(".").pop() ?? "") : "",
    });
    performanceMetrics.count("fileIndex.incremental.add");
  }
}

export function removeFileFromIndex(targetPath: string, isDir: boolean): void {
  const normalizedTarget = normalizePath(targetPath);

  suppressInvalidation(normalizedTarget);

  for (const root of findRootsForPath(normalizedTarget)) {
    const entry = cache.get(root);
    if (!entry) continue;
    if (isDir) {
      removeFilesByPrefix(entry, normalizedTarget);
    } else {
      removeFileByPath(entry, normalizedTarget);
    }
    performanceMetrics.count("fileIndex.incremental.remove");
  }
}

export function renamePathInIndex(
  oldPath: string,
  newPath: string,
  isDir: boolean,
): void {
  const normalizedOld = normalizePath(oldPath);
  const normalizedNew = normalizePath(newPath);

  suppressInvalidation(normalizedOld);
  suppressInvalidation(normalizedNew);

  for (const root of findRootsForPath(normalizedOld)) {
    const entry = cache.get(root);
    if (!entry) continue;
    if (isDir) {
      renameFilesByPrefix(entry, normalizedOld, normalizedNew);
    } else {
      renameFileByPath(entry, normalizedOld, normalizedNew);
    }
    performanceMetrics.count("fileIndex.incremental.rename");
  }
}

export function invalidateFileIndex(rootPath?: string): void {
  if (!rootPath) {
    cache.clear();
    inFlight.clear();
    return;
  }
  invalidateRoot(rootPath);
}

export function getFileIndexMeta(rootPath: string): {
  count: number;
  loadedAt: number | null;
} {
  const cached = cache.get(normalizePath(rootPath));
  return {
    count: cached?.files.length ?? 0,
    loadedAt: cached?.loadedAt ?? null,
  };
}

export function disposeFileIndexService(): void {
  listenerCleanup?.();
  listenerCleanup = null;
  watcherBound = false;
  cache.clear();
  inFlight.clear();
  suppressedInvalidations.clear();
}

export type { IndexedFileItem };
