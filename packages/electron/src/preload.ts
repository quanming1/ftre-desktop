import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAPI } from "@ftre/shared";

const api: DesktopAPI = {
  platform: process.platform,
  isElectron: true,
  openExternal: (url: string) => ipcRenderer.invoke("shell:openExternal", url),

  fs: {
    readDir: (dirPath: string) => ipcRenderer.invoke("fs:readDir", { dirPath }),
    readFile: (filePath: string) =>
      ipcRenderer.invoke("fs:readFile", { filePath }),
    writeFile: (filePath: string, content: string) =>
      ipcRenderer.invoke("fs:writeFile", { filePath, content }),
    selectFolder: () => ipcRenderer.invoke("fs:selectFolder"),
    showSaveDialog: (opts?: { defaultName?: string }) =>
      ipcRenderer.invoke("fs:showSaveDialog", opts || {}),
    search: (rootPath: string, query: string, options: any) =>
      ipcRenderer.invoke("fs:search", { rootPath, query, options }),
    createFile: (filePath: string) =>
      ipcRenderer.invoke("fs:createFile", { filePath }),
    createFolder: (dirPath: string) =>
      ipcRenderer.invoke("fs:createFolder", { dirPath }),
    rename: (oldPath: string, newPath: string) =>
      ipcRenderer.invoke("fs:rename", { oldPath, newPath }),
    delete: (targetPath: string, isDir: boolean) =>
      ipcRenderer.invoke("fs:delete", { targetPath, isDir }),
    revealInExplorer: (targetPath: string) =>
      ipcRenderer.invoke("fs:revealInExplorer", { targetPath }),
    watch: (filePath: string) => ipcRenderer.invoke("fs:watch", { filePath }),
    unwatch: (filePath: string) =>
      ipcRenderer.invoke("fs:unwatch", { filePath }),
    onFileChanged: (callback: (filePath: string) => void) => {
      const handler = (_event: any, payload: { filePath: string }) =>
        callback(payload.filePath);
      ipcRenderer.on("fs:fileChanged", handler);
      return () => ipcRenderer.removeListener("fs:fileChanged", handler);
    },
  },

  git: {
    info: (rootPath: string) => ipcRenderer.invoke("git:info", { rootPath }),
    status: (rootPath: string) =>
      ipcRenderer.invoke("git:status", { rootPath }),
    stage: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("git:stage", { rootPath, filePath }),
    stageMany: (rootPath: string, filePaths: string[]) =>
      ipcRenderer.invoke("git:stage-bulk", { rootPath, filePaths }),
    unstage: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("git:unstage", { rootPath, filePath }),
    unstageMany: (rootPath: string, filePaths: string[]) =>
      ipcRenderer.invoke("git:unstage-bulk", { rootPath, filePaths }),
    commit: (rootPath: string, message: string) =>
      ipcRenderer.invoke("git:commit", { rootPath, message }),
    show: (rootPath: string, filePath: string) =>
      ipcRenderer.invoke("git:show", { rootPath, filePath }),
    diffFile: (
      rootPath: string,
      filePath: string,
      status: string,
      staged: boolean,
      oldPath?: string,
    ) =>
      ipcRenderer.invoke("git:diff-file", {
        rootPath,
        filePath,
        status,
        staged,
        oldPath,
      }),
  },

  window: {
    minimize: () => ipcRenderer.invoke("window:minimize"),
    maximize: () => ipcRenderer.invoke("window:maximize"),
    close: () => ipcRenderer.invoke("window:close"),
    getPosition: () => ipcRenderer.invoke("window:getPosition"),
    setPosition: (x: number, y: number) =>
      ipcRenderer.invoke("window:setPosition", { x, y }),
    isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  },

  store: {
    get: (key: string) => ipcRenderer.invoke("store:get", { key }),
    set: (key: string, value: unknown) =>
      ipcRenderer.invoke("store:set", { key, value }),
  },

  terminal: {
    create: (opts?: {
      cols?: number;
      rows?: number;
      cwd?: string;
      shell?: string;
    }) => ipcRenderer.invoke("pty:create", opts || {}),
    write: (id: number, data: string) =>
      ipcRenderer.invoke("pty:write", { id, data }),
    resize: (id: number, cols: number, rows: number) =>
      ipcRenderer.invoke("pty:resize", { id, cols, rows }),
    kill: (id: number) => ipcRenderer.invoke("pty:kill", { id }),
    onData: (callback: (id: number, data: string) => void) => {
      const handler = (_event: any, payload: { id: number; data: string }) =>
        callback(payload.id, payload.data);
      ipcRenderer.on("pty:data", handler);
      return () => ipcRenderer.removeListener("pty:data", handler);
    },
    onExit: (callback: (id: number, exitCode: number) => void) => {
      const handler = (
        _event: any,
        payload: { id: number; exitCode: number },
      ) => callback(payload.id, payload.exitCode);
      ipcRenderer.on("pty:exit", handler);
      return () => ipcRenderer.removeListener("pty:exit", handler);
    },
  },
};

contextBridge.exposeInMainWorld("desktop", api);
