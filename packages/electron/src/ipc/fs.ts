import { ipcMain, dialog, shell } from "electron";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { getMainWindow } from "../app-state";

/** Expand ~ to the user's home directory */
function expandHome(filePath: string): string {
  if (filePath.startsWith("~/") || filePath.startsWith("~\\")) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

const TREE_SKIP_DIRS = new Set([".git"]);

function extToLanguage(ext: string): string {
  const map: Record<string, string> = {
    js: "javascript",
    jsx: "javascript",
    ts: "typescript",
    tsx: "typescript",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    json: "json",
    yaml: "yaml",
    yml: "yaml",
    toml: "toml",
    md: "markdown",
    html: "html",
    css: "css",
    scss: "scss",
    sql: "sql",
    sh: "shell",
    bash: "shell",
    zsh: "shell",
    xml: "xml",
    svg: "xml",
    c: "c",
    cpp: "cpp",
    h: "c",
    txt: "plaintext",
    log: "plaintext",
    env: "plaintext",
    gitignore: "plaintext",
    dockerfile: "dockerfile",
  };
  return map[ext.toLowerCase()] || "plaintext";
}

export function registerFsIPC(): void {
  ipcMain.handle(
    "fs:readDir",
    async (_event, { dirPath }: { dirPath: string }) => {
      try {
        const items = await fs.promises.readdir(dirPath, {
          withFileTypes: true,
        });
        const entries = [];

        for (const item of items) {
          if (item.isDirectory() && TREE_SKIP_DIRS.has(item.name)) continue;

          entries.push({
            name: item.name,
            path: path.join(dirPath, item.name).replace(/\\/g, "/"),
            isDir: item.isDirectory(),
            ext: item.isDirectory() ? null : path.extname(item.name).slice(1),
          });
        }

        entries.sort((a: any, b: any) => {
          if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
          return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
        });

        return { entries };
      } catch (err: any) {
        return { entries: [], error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:readFile",
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const resolved = expandHome(filePath);
        const content = await fs.promises.readFile(resolved, "utf-8");
        const ext = path.extname(resolved).slice(1);
        return { content, language: extToLanguage(ext) };
      } catch (err: any) {
        return { content: "", error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:readImageBase64",
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const resolved = expandHome(filePath);
        const buf = await fs.promises.readFile(resolved);
        const ext = path.extname(resolved).slice(1).toLowerCase();
        const mime =
          ext === "svg"
            ? "image/svg+xml"
            : ext === "jpg" || ext === "jpeg"
              ? "image/jpeg"
              : ext === "png"
                ? "image/png"
                : ext === "gif"
                  ? "image/gif"
                  : ext === "webp"
                    ? "image/webp"
                    : ext === "bmp"
                      ? "image/bmp"
                      : ext === "avif"
                        ? "image/avif"
                        : ext === "ico"
                          ? "image/x-icon"
                          : "image/png";
        return { dataUrl: `data:${mime};base64,${buf.toString("base64")}` };
      } catch (err: any) {
        return { dataUrl: "", error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:writeFile",
    async (
      _event,
      { filePath, content }: { filePath: string; content: string },
    ) => {
      try {
        const resolved = expandHome(filePath);
        await fs.promises.mkdir(path.dirname(resolved), { recursive: true });
        await fs.promises.writeFile(resolved, content, "utf-8");
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle("fs:selectFolder", async () => {
    const mainWindow = getMainWindow();
    const result = await dialog.showOpenDialog(mainWindow!, {
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0].replace(/\\/g, "/") };
  });

  ipcMain.handle(
    "fs:showSaveDialog",
    async (_event, { defaultName }: { defaultName?: string } = {}) => {
      const mainWindow = getMainWindow();
      const result = await dialog.showSaveDialog(mainWindow!, {
        defaultPath: defaultName || "Untitled",
      });
      if (result.canceled || !result.filePath) return { path: null };
      return { path: result.filePath.replace(/\\/g, "/") };
    },
  );

  ipcMain.handle(
    "fs:createFile",
    async (_event, { filePath }: { filePath: string }) => {
      try {
        try {
          await fs.promises.access(filePath);
          return { success: false, error: "File already exists" };
        } catch {
          // file does not exist, continue
        }
        await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
        await fs.promises.writeFile(filePath, "", "utf-8");
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:createFolder",
    async (_event, { dirPath }: { dirPath: string }) => {
      try {
        await fs.promises.mkdir(dirPath, { recursive: true });
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:rename",
    async (
      _event,
      { oldPath, newPath }: { oldPath: string; newPath: string },
    ) => {
      try {
        await fs.promises.rename(oldPath, newPath);
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:delete",
    async (
      _event,
      { targetPath, isDir }: { targetPath: string; isDir: boolean },
    ) => {
      try {
        if (isDir) {
          await fs.promises.rm(targetPath, { recursive: true, force: true });
        } else {
          await fs.promises.unlink(targetPath);
        }
        return { success: true };
      } catch (err: any) {
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle(
    "fs:revealInExplorer",
    async (_event, { targetPath }: { targetPath: string }) => {
      shell.showItemInFolder(targetPath);
    },
  );

  ipcMain.handle(
    "fs:stat",
    async (_event, { filePath }: { filePath: string }) => {
      try {
        const stat = await fs.promises.stat(expandHome(filePath));
        return { mtime: stat.mtimeMs };
      } catch {
        return { mtime: null };
      }
    },
  );
}
