import { ipcMain } from "electron";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import type { GitInfo, GitFileStatus } from "@ftre/shared";

function gitExec(
  args: string[],
  cwd: string,
  opts: any = {},
): Promise<string | null> {
  return new Promise((resolve) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf-8",
        windowsHide: true,
        maxBuffer: 10 * 1024 * 1024,
        ...opts,
      },
      (error, stdout) => {
        if (error) {
          resolve(null);
          return;
        }
        resolve(String(stdout ?? "").trimEnd());
      },
    );
  });
}

async function gitShowFile(
  cwd: string,
  ref: string,
  fp: string,
): Promise<string> {
  const spec = ref ? `${ref}:${fp}` : `:${fp}`;
  const result = await gitExec(["show", spec], cwd);
  return result ?? "";
}

async function readDiskFile(
  rootPath: string,
  filePath: string,
): Promise<string> {
  try {
    return await fs.promises.readFile(path.join(rootPath, filePath), "utf-8");
  } catch {
    return "";
  }
}

async function gitExecForPaths(
  baseArgs: string[],
  cwd: string,
  filePaths: string[],
  chunkSize = 200,
): Promise<boolean> {
  const uniquePaths = Array.from(
    new Set(filePaths.map((p) => p.trim()).filter(Boolean)),
  );
  if (uniquePaths.length === 0) return true;

  for (let i = 0; i < uniquePaths.length; i += chunkSize) {
    const chunk = uniquePaths.slice(i, i + chunkSize);
    const result = await gitExec([...baseArgs, "--", ...chunk], cwd);
    if (result === null) return false;
  }

  return true;
}

const CONFLICT_PAIRS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);

/** porcelain 状态位的合法字符集；不在此列的行不是状态行（防御裸路径误喂） */
const VALID_STATUS_CHARS = new Set([" ", "M", "A", "D", "R", "C", "T", "?", "U", "!"]);

function charToStatus(c: string): GitFileStatus["status"] {
  switch (c) {
    case "M":
    case "T":
      return "modified";
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    case "C":
      return "added";
    default:
      return "modified";
  }
}

function parseStatusLine(
  line: string,
  rootPath: string,
  zOldPath?: string,
): GitFileStatus[] {
  if (line.length < 3) return [];

  const X = line[0];
  const Y = line[1];
  const XY = X + Y;
  const rawPath = line.slice(3);

  // 状态位不合法说明这不是一条 porcelain 状态行（例如 -z 模式下被误当
  // 状态行的裸旧路径），直接丢弃，避免产出路径被截断的垃圾条目。
  if (!VALID_STATUS_CHARS.has(X) || !VALID_STATUS_CHARS.has(Y)) return [];

  if (X === "?" && Y === "?") {
    const isDir = rawPath.endsWith("/");
    const cleanPath = rawPath.replace(/\/$/, "");
    return [
      {
        path: cleanPath,
        absolutePath: path.join(rootPath, cleanPath).replace(/\\/g, "/"),
        status: "untracked",
        staged: false,
        isDir,
      },
    ];
  }

  if (CONFLICT_PAIRS.has(XY) || X === "U" || Y === "U") {
    return [
      {
        path: rawPath,
        absolutePath: path.join(rootPath, rawPath).replace(/\\/g, "/"),
        status: "conflict",
        staged: false,
        isDir: false,
      },
    ];
  }

  let filePath = rawPath;
  // -z 模式的 rename 由调用方配对传入旧路径（zOldPath）；无 -z 的调用
  // （git:status）仍走 " -> " 分支。
  let oldPath = zOldPath;
  if (!oldPath && (X === "R" || X === "C" || Y === "R" || Y === "C")) {
    const arrowIdx = rawPath.indexOf(" -> ");
    if (arrowIdx !== -1) {
      oldPath = rawPath.slice(0, arrowIdx);
      filePath = rawPath.slice(arrowIdx + 4);
    }
  }

  const indexActive = X !== " " && X !== "?";
  const workTreeActive = Y !== " " && Y !== "?";
  const results: GitFileStatus[] = [];

  if (indexActive) {
    results.push({
      path: filePath,
      oldPath,
      absolutePath: path.join(rootPath, filePath).replace(/\\/g, "/"),
      status: charToStatus(X),
      staged: true,
      isDir: false,
    });
  }
  if (workTreeActive) {
    results.push({
      path: filePath,
      absolutePath: path.join(rootPath, filePath).replace(/\\/g, "/"),
      status: charToStatus(Y),
      staged: false,
      isDir: false,
    });
  }

  return results;
}

export function registerGitIPC(): void {
  // 一次性获取所有变更文件的增删行数（git diff --numstat + git diff --cached --numstat）
  ipcMain.handle(
    "git:numstat",
    async (_event, { rootPath }: { rootPath: string }) => {
      try {
        const [unstaged, staged] = await Promise.all([
          gitExec(["diff", "--numstat", "--no-renames"], rootPath),
          gitExec(["diff", "--cached", "--numstat", "--no-renames"], rootPath),
        ]);
        // 格式: "3\t1\tpath/to/file"
        const map: Record<string, { additions: number; deletions: number }> = {};
        const parse = (output: string, stagedFlag: boolean) => {
          if (!output) return;
          for (const line of output.trim().split("\n")) {
            const parts = line.split("\t");
            if (parts.length < 3) continue;
            const adds = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
            const dels = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
            const fp = parts.slice(2).join("\t");
            const abs = path.join(rootPath, fp).replace(/\\/g, "/");
            const key = abs.toLowerCase();
            if (!map[key]) {
              map[key] = { additions: 0, deletions: 0 };
            }
            // staged 和 unstaged 取最大值（同一文件两区都有变更时）
            map[key].additions = Math.max(map[key].additions, adds);
            map[key].deletions = Math.max(map[key].deletions, dels);
            void stagedFlag;
          }
        };
        parse(unstaged ?? "", false);
        parse(staged ?? "", true);
        return { stats: map };
      } catch {
        return { stats: {} };
      }
    },
  );

  // 协商缓存式 git 状态轮询：
  // Phase 1: stat .git/index + .git/HEAD 拼成 etag（<1ms），与客户端传入的 lastEtag 比较
  // Phase 2: etag 变了才跑 git status --porcelain + git diff --numstat
  // force=true 时跳过 Phase 1 直接走 Phase 2（兜底：外部编辑器改文件不触发 git 操作）
  ipcMain.handle(
    "git:poll",
    async (
      _event,
      { rootPath, lastEtag, force }: { rootPath: string; lastEtag?: string; force?: boolean },
    ) => {
      try {
        const gitDir = path.join(rootPath, ".git");

        // Phase 1: 构建 etag
        const indexPath = path.join(gitDir, "index");
        const headPath = path.join(gitDir, "HEAD");
        const [indexStat, headStat] = await Promise.all([
          fs.promises.stat(indexPath).catch(() => null),
          fs.promises.stat(headPath).catch(() => null),
        ]);
        const etag = `${indexStat?.mtimeMs ?? 0}:${indexStat?.size ?? 0}:${headStat?.mtimeMs ?? 0}:${headStat?.size ?? 0}`;

        // etag 没变 → 跳过
        if (!force && lastEtag && etag === lastEtag) {
          return { changed: false, etag };
        }

        // Phase 2: etag 变了（或首次/强制），跑完整 git status + numstat
        const statusResult = await gitExec(["status", "--porcelain", "-z"], rootPath);
        const numstatUnstaged = await gitExec(["diff", "--numstat", "--no-renames"], rootPath);
        const numstatStaged = await gitExec(["diff", "--cached", "--numstat", "--no-renames"], rootPath);

        // 解析 status
        const files: GitFileStatus[] = [];
        const entries = statusResult ? statusResult.replace(/\0$/g, "").split("\0").filter(Boolean) : [];
        // -z 模式下 rename/copy 条目是 "XY newpath\0oldpath\0"：旧路径是紧随其后的
        // 独立 NUL 字段（无状态前缀、不含 " -> "），必须配对消费；否则裸旧路径会被
        // 误当状态行解析，产出路径被截断的重复垃圾条目（Changes 列表 key 冲突根源）。
        for (let i = 0; i < entries.length; i++) {
          const line = entries[i];
          if (line.length < 3) continue;
          const X = line[0];
          const Y = line[1];
          let zOldPath: string | undefined;
          if (X === "R" || X === "C" || Y === "R" || Y === "C") {
            if (i + 1 < entries.length) {
              zOldPath = entries[i + 1];
              i++;
            }
          }
          const parsed = parseStatusLine(line, rootPath, zOldPath);
          files.push(...parsed);
        }

        // 解析 numstat
        const stats: Record<string, { additions: number; deletions: number }> = {};
        const parseNumstat = (output: string) => {
          if (!output) return;
          for (const line of output.trim().split("\n")) {
            const parts = line.split("\t");
            if (parts.length < 3) continue;
            const adds = parts[0] === "-" ? 0 : parseInt(parts[0], 10) || 0;
            const dels = parts[1] === "-" ? 0 : parseInt(parts[1], 10) || 0;
            const fp = parts.slice(2).join("\t");
            const abs = path.join(rootPath, fp).replace(/\\/g, "/");
            const key = abs.toLowerCase();
            if (!stats[key]) stats[key] = { additions: 0, deletions: 0 };
            stats[key].additions = Math.max(stats[key].additions, adds);
            stats[key].deletions = Math.max(stats[key].deletions, dels);
          }
        };
        parseNumstat(numstatUnstaged ?? "");
        parseNumstat(numstatStaged ?? "");

        return { changed: true, etag, files, stats };
      } catch {
        return { changed: false, etag: lastEtag ?? "" };
      }
    },
  );

  ipcMain.handle(
    "git:info",
    async (_event, { rootPath }: { rootPath: string }): Promise<GitInfo> => {
      try {
        const branch = await gitExec(
          ["rev-parse", "--abbrev-ref", "HEAD"],
          rootPath,
        );
        return {
          branch,
          changedFiles: 0,
          isGitRepo: branch !== null,
        };
      } catch {
        return { branch: null, changedFiles: 0, isGitRepo: false };
      }
    },
  );

  ipcMain.handle(
    "git:status",
    async (_event, { rootPath }: { rootPath: string }) => {
      try {
        const output = await gitExec(
          ["status", "--porcelain", "-uall"],
          rootPath,
        );
        if (!output) return { files: [] };

        const files: GitFileStatus[] = [];
        for (const line of output.split("\n")) {
          files.push(...parseStatusLine(line, rootPath));
        }
        return { files };
      } catch (err: any) {
        return { files: [], error: err.message };
      }
    },
  );

  ipcMain.handle(
    "git:stage",
    async (
      _event,
      { rootPath, filePath }: { rootPath: string; filePath: string },
    ) => {
      const result = await gitExec(["add", "--", filePath], rootPath);
      return result !== null
        ? { success: true }
        : { success: false, error: "git add failed" };
    },
  );

  ipcMain.handle(
    "git:unstage",
    async (
      _event,
      { rootPath, filePath }: { rootPath: string; filePath: string },
    ) => {
      const result = await gitExec(["reset", "HEAD", "--", filePath], rootPath);
      return result !== null
        ? { success: true }
        : { success: false, error: "git reset failed" };
    },
  );

  ipcMain.handle(
    "git:stage-bulk",
    async (
      _event,
      { rootPath, filePaths }: { rootPath: string; filePaths: string[] },
    ) => {
      const success = await gitExecForPaths(["add"], rootPath, filePaths);
      return success
        ? { success: true }
        : { success: false, error: "git add failed" };
    },
  );

  ipcMain.handle(
    "git:unstage-bulk",
    async (
      _event,
      { rootPath, filePaths }: { rootPath: string; filePaths: string[] },
    ) => {
      const success = await gitExecForPaths(
        ["reset", "HEAD"],
        rootPath,
        filePaths,
      );
      return success
        ? { success: true }
        : { success: false, error: "git reset failed" };
    },
  );

  ipcMain.handle(
    "git:commit",
    async (
      _event,
      { rootPath, message }: { rootPath: string; message: string },
    ) => {
      const result = await gitExec(["commit", "-m", message], rootPath);
      return result !== null
        ? { success: true }
        : { success: false, error: "git commit failed" };
    },
  );

  ipcMain.handle(
    "git:show",
    async (
      _event,
      { rootPath, filePath }: { rootPath: string; filePath: string },
    ) => {
      const content = await gitShowFile(rootPath, "HEAD", filePath);
      return { content };
    },
  );

  ipcMain.handle(
    "git:diff-file",
    async (
      _event,
      {
        rootPath,
        filePath,
        status,
        staged,
        oldPath,
      }: {
        rootPath: string;
        filePath: string;
        status: string;
        staged: boolean;
        oldPath?: string;
      },
    ) => {
      try {
        const lookupPath = oldPath || filePath;

        if (status === "untracked" || status === "added") {
          return {
            original: "",
            modified: await readDiskFile(rootPath, filePath),
          };
        }

        if (status === "deleted") {
          return {
            original: await gitShowFile(rootPath, "HEAD", lookupPath),
            modified: "",
          };
        }

        if (staged) {
          return {
            original: await gitShowFile(rootPath, "HEAD", lookupPath),
            modified: await gitShowFile(rootPath, "", filePath),
          };
        }

        let original = await gitShowFile(rootPath, "", filePath);
        if (!original)
          original = await gitShowFile(rootPath, "HEAD", lookupPath);
        return { original, modified: await readDiskFile(rootPath, filePath) };
      } catch (err: any) {
        return { original: "", modified: "", error: err.message };
      }
    },
  );

  // 暂存区 Diff 前置查询：按文件绝对路径定位其所在仓库并读取暂存区版本。
  // 与工作区级 status 缓存解耦——Inspector 预览的文件可能位于任意仓库，
  // 应用工作区根目录本身甚至不是 git 仓库。
  ipcMain.handle(
    "git:index-diff",
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const dir = path.dirname(filePath);
        // porcelain 输出 "XY path"：X = 暂存区状态，Y = 工作区状态；
        // Y 为 M/T 表示工作区相对暂存区有修改（未暂存的 M）
        const status = await gitExec(
          ["status", "--porcelain", "--", filePath],
          dir,
        );
        if (!status) return { available: false };
        const y = status[1];
        if (y !== "M" && y !== "T") return { available: false };
        // ":./名字" = 相对 cwd 的索引（暂存区）版本；cwd 是文件所在目录
        const staged = await gitExec(
          ["show", `:./${path.basename(filePath)}`],
          dir,
        );
        return { available: true, staged: staged ?? "" };
      } catch (err: any) {
        return { available: false, error: err.message };
      }
    },
  );
}
