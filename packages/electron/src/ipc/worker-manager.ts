import { Worker } from 'worker_threads';

let nextTaskId = 1;

interface TaskConfig {
  workerPath: string;
  mode: 'exclusive' | 'pool' | 'spawn';
  timeout: number;
  poolSize?: number;
}

interface TaskMessage {
  taskId: number;
  payload: any;
}

interface ResultMessage {
  taskId: number;
  result?: any;
  error?: string;
}

class ExclusiveChannel {
  private workerPath: string;
  private timeout: number;
  private activeWorker: Worker | null = null;
  private activeTimer: NodeJS.Timeout | null = null;

  constructor(workerPath: string, timeout: number) {
    this.workerPath = workerPath;
    this.timeout = timeout;
  }

  run(payload: any): Promise<any> {
    this.cancel();

    return new Promise((resolve) => {
      const taskId = nextTaskId++;
      const worker = new Worker(this.workerPath);
      this.activeWorker = worker;

      this.activeTimer = setTimeout(() => {
        this.cancel();
        resolve({ error: 'Worker timed out' });
      }, this.timeout);

      worker.on('message', (msg: ResultMessage) => {
        if (msg.taskId !== taskId) return;
        this.clear(worker);
        worker.terminate();
        if (msg.error) {
          resolve({ error: msg.error });
        } else {
          resolve(msg.result);
        }
      });

      worker.on('error', (err: Error) => {
        this.clear(worker);
        worker.terminate();
        resolve({ error: err.message });
      });

      worker.on('exit', (code: number) => {
        if (this.activeWorker === worker) {
          this.clear(worker);
          resolve({ error: `Worker exited with code ${code}` });
        }
      });

      worker.postMessage({ taskId, payload });
    });
  }

  private cancel(): void {
    if (this.activeTimer) {
      clearTimeout(this.activeTimer);
      this.activeTimer = null;
    }
    if (this.activeWorker) {
      try { this.activeWorker.terminate(); } catch { }
      this.activeWorker = null;
    }
  }

  private clear(worker: Worker): void {
    if (this.activeWorker === worker) {
      if (this.activeTimer) {
        clearTimeout(this.activeTimer);
        this.activeTimer = null;
      }
      this.activeWorker = null;
    }
  }

  dispose(): void {
    this.cancel();
  }
}

class PoolChannel {
  private workerPath: string;
  private timeout: number;
  private poolSize: number;
  private idle: Worker[] = [];
  private busy = new Set<Worker>();
  private queue: Array<{ payload: any; resolve: (value: any) => void }> = [];
  private tasks = new Map<Worker, Map<number, { resolve: (value: any) => void; timer: NodeJS.Timeout }>>();
  private disposed = false;

  constructor(workerPath: string, timeout: number, poolSize: number) {
    this.workerPath = workerPath;
    this.timeout = timeout;
    this.poolSize = poolSize;
  }

  run(payload: any): Promise<any> {
    if (this.disposed) {
      return Promise.resolve({ error: 'Channel disposed' });
    }

    return new Promise((resolve) => {
      const worker = this.idle.pop();
      if (worker) {
        this.dispatch(worker, payload, resolve);
      } else if (this.busy.size < this.poolSize) {
        const w = this.createWorker();
        this.dispatch(w, payload, resolve);
      } else {
        this.queue.push({ payload, resolve });
      }
    });
  }

  private createWorker(): Worker {
    const worker = new Worker(this.workerPath);
    this.tasks.set(worker, new Map());

    worker.on('message', (msg: ResultMessage) => {
      const taskMap = this.tasks.get(worker);
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

      this.recycle(worker);
    });

    worker.on('error', (err: Error) => {
      const taskMap = this.tasks.get(worker);
      if (taskMap) {
        for (const [, task] of taskMap) {
          clearTimeout(task.timer);
          task.resolve({ error: err.message });
        }
      }
      this.remove(worker);
    });

    worker.on('exit', () => {
      const taskMap = this.tasks.get(worker);
      if (taskMap) {
        for (const [, task] of taskMap) {
          clearTimeout(task.timer);
          task.resolve({ error: 'Worker exited unexpectedly' });
        }
      }
      this.remove(worker);
    });

    return worker;
  }

  private dispatch(worker: Worker, payload: any, resolve: (value: any) => void): void {
    const taskId = nextTaskId++;
    this.busy.add(worker);
    this.idle = this.idle.filter(w => w !== worker);

    const timer = setTimeout(() => {
      const taskMap = this.tasks.get(worker);
      if (taskMap) taskMap.delete(taskId);
      resolve({ error: 'Worker timed out' });
      this.recycle(worker);
    }, this.timeout);

    const taskMap = this.tasks.get(worker) || new Map();
    taskMap.set(taskId, { resolve, timer });
    this.tasks.set(worker, taskMap);

    worker.postMessage({ taskId, payload });
  }

  private recycle(worker: Worker): void {
    this.busy.delete(worker);
    if (this.disposed) {
      worker.terminate();
      return;
    }
    if (this.queue.length > 0) {
      const { payload, resolve } = this.queue.shift()!;
      this.dispatch(worker, payload, resolve);
    } else {
      this.idle.push(worker);
    }
  }

  private remove(worker: Worker): void {
    this.busy.delete(worker);
    this.idle = this.idle.filter(w => w !== worker);
    this.tasks.delete(worker);
    try { worker.terminate(); } catch { }

    if (!this.disposed && this.queue.length > 0) {
      const w = this.createWorker();
      const { payload, resolve } = this.queue.shift()!;
      this.dispatch(w, payload, resolve);
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const { resolve } of this.queue) {
      resolve({ error: 'Channel disposed' });
    }
    this.queue = [];
    for (const worker of [...this.idle, ...this.busy]) {
      const taskMap = this.tasks.get(worker);
      if (taskMap) {
        for (const [, task] of taskMap) {
          clearTimeout(task.timer);
          task.resolve({ error: 'Channel disposed' });
        }
      }
      try { worker.terminate(); } catch { }
    }
    this.idle = [];
    this.busy.clear();
    this.tasks.clear();
  }
}

class SpawnChannel {
  private workerPath: string;
  private timeout: number;
  private workers = new Set<Worker>();

  constructor(workerPath: string, timeout: number) {
    this.workerPath = workerPath;
    this.timeout = timeout;
  }

  run(payload: any): Promise<any> {
    return new Promise((resolve) => {
      const taskId = nextTaskId++;
      const worker = new Worker(this.workerPath);
      this.workers.add(worker);

      const timer = setTimeout(() => {
        this.workers.delete(worker);
        try { worker.terminate(); } catch { }
        resolve({ error: 'Worker timed out' });
      }, this.timeout);

      let resolved = false;

      worker.on('message', (msg: ResultMessage) => {
        if (msg.taskId !== taskId || resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.workers.delete(worker);
        worker.terminate();
        if (msg.error) {
          resolve({ error: msg.error });
        } else {
          resolve(msg.result);
        }
      });

      worker.on('error', (err: Error) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.workers.delete(worker);
        worker.terminate();
        resolve({ error: err.message });
      });

      worker.on('exit', (code: number) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timer);
        this.workers.delete(worker);
        resolve({ error: `Worker exited with code ${code}` });
      });

      worker.postMessage({ taskId, payload });
    });
  }

  dispose(): void {
    for (const worker of this.workers) {
      try { worker.terminate(); } catch { }
    }
    this.workers.clear();
  }
}

export class WorkerManager {
  private channels = new Map<string, ExclusiveChannel | PoolChannel | SpawnChannel>();

  register(name: string, { workerPath, mode = 'exclusive', timeout = 30_000, poolSize = 4 }: TaskConfig): void {
    if (this.channels.has(name)) {
      throw new Error(`WorkerManager: channel "${name}" already registered`);
    }

    let channel: ExclusiveChannel | PoolChannel | SpawnChannel;
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

    this.channels.set(name, channel);
  }

  async run(name: string, payload: any): Promise<any> {
    const channel = this.channels.get(name);
    if (!channel) {
      throw new Error(`WorkerManager: channel "${name}" not registered`);
    }
    return channel.run(payload);
  }

  has(name: string): boolean {
    return this.channels.has(name);
  }

  unregister(name: string): void {
    const channel = this.channels.get(name);
    if (channel) {
      channel.dispose();
      this.channels.delete(name);
    }
  }

  dispose(): void {
    for (const [, channel] of this.channels) {
      channel.dispose();
    }
    this.channels.clear();
  }
}
