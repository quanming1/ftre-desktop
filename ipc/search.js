/**
 * Search IPC 模块
 *
 * 通过 WorkerManager 将文件内容搜索委托给 Worker 线程，
 * 主线程完全不参与文件 I/O。
 *
 * main.js 中调用 registerSearchIPC(workerManager) 注册。
 */

'use strict';

const { ipcMain } = require('electron');
const path = require('path');

const CHANNEL = 'search';
const WORKER_PATH = path.join(__dirname, 'workers', 'search.js');

/**
 * 注册搜索 channel 并绑定 IPC handler
 *
 * @param {import('./worker-manager').WorkerManager} manager
 */
function registerSearchIPC(manager) {
    // 注册 Worker 通道：exclusive 模式，新搜索自动取消旧搜索
    manager.register(CHANNEL, {
        workerPath: WORKER_PATH,
        mode: 'exclusive',
        timeout: 30_000,
    });

    ipcMain.handle('fs:search', async (_event, { rootPath, query, options = {} }) => {
        if (!query) {
            return { results: [] };
        }

        const result = await manager.run(CHANNEL, { rootPath, query, options });

        // WorkerManager 统一用 { error } 表示失败
        // search worker 成功时返回 { results, error? }
        if (result.error && !result.results) {
            return { results: [], error: result.error };
        }
        return result;
    });
}

module.exports = { registerSearchIPC };
