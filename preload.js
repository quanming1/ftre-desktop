/**
 * Preload - 通过 contextBridge 安全暴露原生能力给渲染进程
 */
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
    platform: process.platform,
    isElectron: true,
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

    // 文件系统
    fs: {
        readDir: (dirPath) => ipcRenderer.invoke('fs:readDir', { dirPath }),
        readFile: (filePath) => ipcRenderer.invoke('fs:readFile', { filePath }),
        writeFile: (filePath, content) => ipcRenderer.invoke('fs:writeFile', { filePath, content }),
        selectFolder: () => ipcRenderer.invoke('fs:selectFolder'),
        showSaveDialog: (opts) => ipcRenderer.invoke('fs:showSaveDialog', opts || {}),
        search: (rootPath, query, options) => ipcRenderer.invoke('fs:search', { rootPath, query, options }),
        createFile: (filePath) => ipcRenderer.invoke('fs:createFile', { filePath }),
        createFolder: (dirPath) => ipcRenderer.invoke('fs:createFolder', { dirPath }),
        rename: (oldPath, newPath) => ipcRenderer.invoke('fs:rename', { oldPath, newPath }),
        delete: (targetPath, isDir) => ipcRenderer.invoke('fs:delete', { targetPath, isDir }),
        revealInExplorer: (targetPath) => ipcRenderer.invoke('fs:revealInExplorer', { targetPath }),
        watch: (filePath) => ipcRenderer.invoke('fs:watch', { filePath }),
        unwatch: (filePath) => ipcRenderer.invoke('fs:unwatch', { filePath }),
        onFileChanged: (callback) => {
            const handler = (_event, payload) => callback(payload.filePath);
            ipcRenderer.on('fs:fileChanged', handler);
            return () => ipcRenderer.removeListener('fs:fileChanged', handler);
        },
    },

    // Git
    git: {
        info: (rootPath) => ipcRenderer.invoke('git:info', { rootPath }),
        status: (rootPath) => ipcRenderer.invoke('git:status', { rootPath }),
        stage: (rootPath, filePath) => ipcRenderer.invoke('git:stage', { rootPath, filePath }),
        unstage: (rootPath, filePath) => ipcRenderer.invoke('git:unstage', { rootPath, filePath }),
        commit: (rootPath, message) => ipcRenderer.invoke('git:commit', { rootPath, message }),
        show: (rootPath, filePath) => ipcRenderer.invoke('git:show', { rootPath, filePath }),
        diffFile: (rootPath, filePath, status, staged, oldPath) => ipcRenderer.invoke('git:diff-file', { rootPath, filePath, status, staged, oldPath }),
    },

    // 窗口控制
    window: {
        minimize: () => ipcRenderer.invoke('window:minimize'),
        maximize: () => ipcRenderer.invoke('window:maximize'),
        close: () => ipcRenderer.invoke('window:close'),
        getPosition: () => ipcRenderer.invoke('window:getPosition'),
        setPosition: (x, y) => ipcRenderer.invoke('window:setPosition', { x, y }),
        isMaximized: () => ipcRenderer.invoke('window:isMaximized'),
    },

    // 持久化存储
    store: {
        get: (key) => ipcRenderer.invoke('store:get', { key }),
        set: (key, value) => ipcRenderer.invoke('store:set', { key, value }),
    },

    // 终端
    terminal: {
        create: (opts) => ipcRenderer.invoke('pty:create', opts || {}),
        write: (id, data) => ipcRenderer.invoke('pty:write', { id, data }),
        resize: (id, cols, rows) => ipcRenderer.invoke('pty:resize', { id, cols, rows }),
        kill: (id) => ipcRenderer.invoke('pty:kill', { id }),
        onData: (callback) => {
            const handler = (_event, payload) => callback(payload.id, payload.data);
            ipcRenderer.on('pty:data', handler);
            return () => ipcRenderer.removeListener('pty:data', handler);
        },
        onExit: (callback) => {
            const handler = (_event, payload) => callback(payload.id, payload.exitCode);
            ipcRenderer.on('pty:exit', handler);
            return () => ipcRenderer.removeListener('pty:exit', handler);
        },
    },
});
