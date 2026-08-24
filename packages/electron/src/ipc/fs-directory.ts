import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type {
  DirectoryError,
  DirectoryErrorCode,
  FileEntry,
  ListDirectoryResult,
} from "@ftre/shared";

const DIRECTORY_ERROR_MESSAGES: Record<DirectoryErrorCode, string> = {
  INVALID_PATH: "目录路径无效",
  NOT_FOUND: "目录不存在或已被移除",
  NOT_DIRECTORY: "目标路径不是目录",
  PERMISSION_DENIED: "没有权限读取该目录",
  READ_FAILED: "读取目录失败",
};

function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

function errorCodeOf(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

function directoryError(code: DirectoryErrorCode): DirectoryError {
  return { code, message: DIRECTORY_ERROR_MESSAGES[code] };
}

function mapDirectoryError(error: unknown): DirectoryError {
  switch (errorCodeOf(error)) {
    case "ENOENT":
      return directoryError("NOT_FOUND");
    case "ENOTDIR":
      return directoryError("NOT_DIRECTORY");
    case "EACCES":
    case "EPERM":
      return directoryError("PERMISSION_DENIED");
    default:
      console.error("[fs:listDirectory] 读取目录失败", error);
      return directoryError("READ_FAILED");
  }
}

function normalizeDirectoryPath(input: unknown): { path?: string; error?: DirectoryError } {
  if (typeof input !== "string" || input.trim() === "") {
    return { error: directoryError("INVALID_PATH") };
  }
  const expanded = expandHome(input.trim());
  return { path: path.resolve(expanded) };
}

/**
 * 统一的只读目录枚举实现。
 *
 * 该 helper 同时服务预览浮层的 fs:listDirectory 和旧文件树的 fs:readDir，
 * 确保路径规范化、过滤、排序和错误映射只有一份实现。
 */
export async function listDirectoryEntries(input: unknown): Promise<ListDirectoryResult> {
  const normalized = normalizeDirectoryPath(input);
  if (normalized.error || !normalized.path) {
    return { entries: [], error: normalized.error ?? directoryError("INVALID_PATH") };
  }

  try {
    const stat = await fs.promises.lstat(normalized.path);
    if (stat.isSymbolicLink() || !stat.isDirectory()) {
      return { entries: [], error: directoryError("NOT_DIRECTORY") };
    }

    const items = await fs.promises.readdir(normalized.path, { withFileTypes: true });
    const entries: FileEntry[] = [];
    for (const item of items) {
      // 隐藏目录和 .git 不进入预览树；隐藏文件仍可被直接浏览。
      if (item.name === ".git" || (item.isDirectory() && item.name.startsWith("."))) {
        continue;
      }
      const isDir = item.isDirectory();
      entries.push({
        name: item.name,
        path: path.join(normalized.path, item.name).replace(/\\/g, "/"),
        isDir,
        ext: isDir ? null : path.extname(item.name).slice(1),
      });
    }

    entries.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    });
    return { entries };
  } catch (error) {
    return { entries: [], error: mapDirectoryError(error) };
  }
}
