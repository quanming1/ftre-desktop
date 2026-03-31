/**
 * WorkerManager — 通用 Worker 线程管理器
 *
 * 为 Electron 主进程提供统一的 Worker 线程管理能力，
 * 让任何需要多线程的功能都能快速接入，而不必各自重复管理 Worker 生命周期。
 *
 * ────────────────────────────────────────────────────────────────────
 * 核心概念:
 *
 *   Channel — 一条命名的任务通道，对应一个 Worker 脚本文件。
 *     每个 channel 独立配置：并发策略、超时、Worker 复用等。
 *
 *   调度策略 (mode):
 *     'exclusive'  — 同一时刻只允许一个 Worker 运行。新任务自动取消旧任务。
 *                    适合搜索、lint 等"只关心最新结果"的场景。
 *     'pool'       — 维护一个固定大小的 Worker 池，任务排队等待空闲 Worker。
 *                    适合批量文件处理、编译等需要并行但要限流的场景。
 *     'spawn'      — 每次任务创建新 Worker，完成后销毁。无并发限制。
 *                    适合低频、独立的一次性任务。
 *
 * ────────────────────────────────────────────────────────────────────
 * 使用示例:
 *
 *   const { WorkerManager } = require('./worker-manager');
 *   const manager = new WorkerManager();
 *
 *   // 注册 channel
 *   manager.register('search', {
 *       workerPath: path.join(__dirname, 'workers/search.js'),
 *       mode: 'exclusive',
 *       timeout: 30_000,
 *   });
 *
 *   // 执行任务
 *   const result = await manager.run('search', { query: 'foo', rootPath: '/project' });
 *
 *   // 应用退出时清理
 *   manager.dispose();
 *
 * ────────────────────────────────────────────────────────────────────
 * Worker 脚本通信协议:
 *
 *   主线程 → Worker:  { taskId, payload }
 *   Worker → 主线程:  { taskId, result }  或  { taskId, error }
 *
 *   Worker 脚本示例:
 *     const { parentPort } = require('worker_threads');
 *     parentPort.on('message', ({ taskId, payload }) => {
 *         try {
 *             const result = doWork(payload);
 *             parentPort.postMessage({ taskId, result });
 *         } catch (err) {
 *             parentPort.postMessage({ taskId, error: err.message });
 *         }
 *     });
 */

'use strict';

const { Worker } = require('worker_threads');

let nextTaskId = 1;

// ── Channel 策略实现 ────────────────────────────────────────────────

/**
 * Exclusive 策略：同一时刻只有一个活跃任务。
 * 新任务到来时自动 terminate 旧 Worker。
 */
class ExclusiveChannel {
    constructor(workerPath, timeout) {
        this.workerPath = workerPath;
        this.timeout = timeout;
        this._activeWorker = null;
        this._activeTimer = null;
        this._activeReject = null;
    }

    run(payload) {
        // 取消旧任务
        this._cancel();

        return new Promise((resolve, reject) => {
            const taskId = nextTaskId++;
            const worker = new Worker(this.workerPath);
            this._activeWorker = worker;
            this._activeReject = reject;

            // 超时保护
            this._activeTimer = setTimeout(() => {
                this._cancel();
                resolve({ error: 'Worker timed out' });
            }, this.timeout);

            worker.on('message', (msg) => {
                if (msg.taskId !== taskId) return;
                this._clear(worker);
                worker.terminate();
                if (msg.error) {
                    resolve({ error: msg.error });
                } else {
                    resolve(msg.result);
                }
            });

            worker.on('error', (err) => {
                this._clear(worker);
                worker.terminate();
                resolve({ error: err.message });
            });

            worker.on('exit', (code) => {
                // 还没 resolve 说明是被 terminate 或异常退出
                if (this._activeWorker === worker) {
                    this._clear(worker);
                    resolve({ error: `Worker exited with code ${code}` });
                }
            });

            worker.postMessage({ taskId, payload });
        });
    }

    _cancel() {
        if (this._activeTimer) {
            clearTimeout(this._activeTimer);
            this._activeTimer = null;
        }
        if (this._activeWorker) {
            try { this._activeWorker.terminate(); } catch { /* already exited */ }
            this._activeWorker = null;
        }
        this._activeReject = null;
    }

    _clear(worker) {
        if (this._activeWorker === worker) {
            clearTimeout(this._activeTimer);
            this._activeTimer = null;
            this._activeWorker = null;
            this._activeReject = null;
        }
    }

    dispose() {
        this._cancel();
    }
}

/**
 * Pool 策略：固定大小的 Worker 池，任务排队等待空闲 Worker。
 * Worker 常驻复用，减少创建/销毁开销。
 */
class PoolChannel {
    constructor(workerPath, timeout, poolSize) {
        this.workerPath = workerPath;
        this.timeout = timeout;
        this.poolSize = poolSize;

        /** @type {Worker[]} 空闲 Worker */
        this._idle = [];
        /** @type {Set<Worker>} 忙碌 Worker */
        this._busy = new Set();
        /** @type {Array<{payload, resolve, reject}>} 等待队列 */
        this._queue = [];
        /** @type {Map<Worker, Map<number, {resolve, timer}>>} 每个 Worker 上的活跃任务 */
        this._tasks = new Map();
        this._disposed = false;
    }

    run(payload) {
        if (this._disposed) {
            return Promise.resolve({ error: 'Channel disposed' });
        }

        return new Promise((resolve, reject) => {
            const worker = this._idle.pop();
            if (worker) {
                this._dispatch(worker, payload, resolve);
            } else if (this._busy.size < this.poolSize) {
                // 池未满，创建新 Worker
                const w = this._createWorker();
                this._dispatch(w, payload, resolve);
            } else {
                // 排队
                this._queue.push({ payload, resolve, reject });
            }
        });
    }

    _createWorker() {
        const worker = new Worker(this.workerPath);
        this._tasks.set(worker, new Map());

        worker.on('message', (msg) => {
            const taskMap = this._tasks.get(worker);
            if (!taskMap) return;
            const task = taskMap.get(msg.taskId);
            if (!task) return;

            clearTimeout(task.timer);
            taskMap.delete(msg.taskId);

            if (msg.error) {
                task.resolve({ error: msg.error });
            } else {
                task.resolve(msg.result);
            }

            this._recycle(worker);
        });

        worker.on('error', (err) => {
            // Worker 崩溃，resolve 所有待处理任务
            const taskMap = this._tasks.get(worker);
            if (taskMap) {
                for (const [, task] of taskMap) {
                    clearTimeout(task.timer);
                    task.resolve({ error: err.message });
                }
            }
            this._remove(worker);
        });

        worker.on('exit', () => {
            // 异常退出，resolve 残留任务
            const taskMap = this._tasks.get(worker);
            if (taskMap) {
                for (const [, task] of taskMap) {
                    clearTimeout(task.timer);
                    task.resolve({ error: 'Worker exited unexpectedly' });
                }
            }
            this._remove(worker);
        });

        return worker;
    }

    _dispatch(worker, payload, resolve) {
        const taskId = nextTaskId++;
        this._busy.add(worker);
        this._idle = this._idle.filter(w => w !== worker);

        const timer = setTimeout(() => {
            const taskMap = this._tasks.get(worker);
            if (taskMap) taskMap.delete(taskId);
            resolve({ error: 'Worker timed out' });
            // 超时后回收 Worker（而非销毁，它可能还能用）
            this._recycle(worker);
        }, this.timeout);

        const taskMap = this._tasks.get(worker) || new Map();
        taskMap.set(taskId, { resolve, timer });
        this._tasks.set(worker, taskMap);

        worker.postMessage({ taskId, payload });
    }

    _recycle(worker) {
        this._busy.delete(worker);
        if (this._disposed) {
            worker.terminate();
            return;
        }
        // 有排队任务就立即分配
        if (this._queue.length > 0) {
            const { payload, resolve } = this._queue.shift();
            this._dispatch(worker, payload, resolve);
        } else {
            this._idle.push(worker);
        }
    }

    _remove(worker) {
        this._busy.delete(worker);
        this._idle = this._idle.filter(w => w !== worker);
        this._tasks.delete(worker);
        try { worker.terminate(); } catch { /* noop */ }

        // 如果有排队任务且池空间允许，创建新 Worker 来处理
        if (!this._disposed && this._queue.length > 0) {
            const w = this._createWorker();
            const { payload, resolve } = this._queue.shift();
            this._dispatch(w, payload, resolve);
        }
    }

    dispose() {
        this._disposed = true;
        // resolve 所有排队任务
        for (const { resolve } of this._queue) {
            resolve({ error: 'Channel disposed' });
        }
        this._queue = [];
        // 终止所有 Worker
        for (const worker of [...this._idle, ...this._busy]) {
            const taskMap = this._tasks.get(worker);
            if (taskMap) {
                for (const [, task] of taskMap) {
                    clearTimeout(task.timer);
                    task.resolve({ error: 'Channel disposed' });
                }
            }
            try { worker.terminate(); } catch { /* noop */ }
        }
        this._idle = [];
        this._busy.clear();
        this._tasks.clear();
    }
}

/**
 * Spawn 策略：每次任务创建新 Worker，完成后销毁。
 * 最简单，适合低频独立任务。
 */
class SpawnChannel {
    constructor(workerPath, timeout) {
        this.workerPath = workerPath;
        this.timeout = timeout;
        /** @type {Set<Worker>} 追踪所有活跃 Worker，用于 dispose */
        this._workers = new Set();
    }

    run(payload) {
        return new Promise((resolve) => {
            const taskId = nextTaskId++;
            const worker = new Worker(this.workerPath);
            this._workers.add(worker);

            const timer = setTimeout(() => {
                this._workers.delete(worker);
                try { worker.terminate(); } catch { /* noop */ }
                resolve({ error: 'Worker timed out' });
            }, this.timeout);

            let resolved = false;

            worker.on('message', (msg) => {
                if (msg.taskId !== taskId || resolved) return;
                resolved = true;
                clearTimeout(timer);
                this._workers.delete(worker);
                worker.terminate();
                if (msg.error) {
                    resolve({ error: msg.error });
                } else {
                    resolve(msg.result);
                }
            });

            worker.on('error', (err) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                this._workers.delete(worker);
                worker.terminate();
                resolve({ error: err.message });
            });

            worker.on('exit', (code) => {
                if (resolved) return;
                resolved = true;
                clearTimeout(timer);
                this._workers.delete(worker);
                resolve({ error: `Worker exited with code ${code}` });
            });

            worker.postMessage({ taskId, payload });
        });
    }

    dispose() {
        for (const worker of this._workers) {
            try { worker.terminate(); } catch { /* noop */ }
        }
        this._workers.clear();
    }
}

// ── WorkerManager ───────────────────────────────────────────────────

class WorkerManager {
    constructor() {
        /** @type {Map<string, ExclusiveChannel|PoolChannel|SpawnChannel>} */
        this._channels = new Map();
    }

    /**
     * 注册一条任务通道
     *
     * @param {string} name — 通道名（唯一标识）
     * @param {object} options
     * @param {string} options.workerPath — Worker 脚本绝对路径
     * @param {'exclusive'|'pool'|'spawn'} [options.mode='exclusive'] — 调度策略
     * @param {number} [options.timeout=30000] — 单个任务超时（ms）
     * @param {number} [options.poolSize=4] — pool 模式下的最大 Worker 数量
     */
    register(name, { workerPath, mode = 'exclusive', timeout = 30_000, poolSize = 4 }) {
        if (this._channels.has(name)) {
            throw new Error(`WorkerManager: channel "${name}" already registered`);
        }

        let channel;
        switch (mode) {
            case 'exclusive':
                channel = new ExclusiveChannel(workerPath, timeout);
                break;
            case 'pool':
                channel = new PoolChannel(workerPath, timeout, poolSize);
                break;
            case 'spawn':
                channel = new SpawnChannel(workerPath, timeout);
                break;
            default:
                throw new Error(`WorkerManager: unknown mode "${mode}"`);
        }

        this._channels.set(name, channel);
    }

    /**
     * 在指定通道上执行任务
     *
     * @param {string} name — 通道名
     * @param {*} payload — 传给 Worker 的数据（可序列化）
     * @returns {Promise<*>} — Worker 返回的结果
     */
    async run(name, payload) {
        const channel = this._channels.get(name);
        if (!channel) {
            throw new Error(`WorkerManager: channel "${name}" not registered`);
        }
        return channel.run(payload);
    }

    /**
     * 检查通道是否已注册
     * @param {string} name
     * @returns {boolean}
     */
    has(name) {
        return this._channels.has(name);
    }

    /**
     * 销毁指定通道，终止其所有 Worker
     * @param {string} name
     */
    unregister(name) {
        const channel = this._channels.get(name);
        if (channel) {
            channel.dispose();
            this._channels.delete(name);
        }
    }

    /**
     * 销毁所有通道，终止所有 Worker。
     * 应在 app.on('before-quit') 时调用。
     */
    dispose() {
        for (const [, channel] of this._channels) {
            channel.dispose();
        }
        this._channels.clear();
    }
}

module.exports = { WorkerManager };
