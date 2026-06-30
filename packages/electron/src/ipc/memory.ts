import { ipcMain, app } from 'electron';

/** 应用启动时间戳，模块加载时记录一次 */
const appStartTime = Date.now();

/**
 * 注册内存/进程指标相关的 IPC handlers
 */
export function registerMemoryIPC(): void {
  // 获取详细的内存与进程使用情况
  ipcMain.handle('memory:getUsage', async () => {
    const processMemory = process.memoryUsage();
    const appMetrics = app.getAppMetrics();

    return {
      timestamp: Date.now(),
      startTime: appStartTime,
      main: {
        rss: processMemory.rss,
        heapUsed: processMemory.heapUsed,
        heapTotal: processMemory.heapTotal,
        external: processMemory.external,
        arrayBuffers: processMemory.arrayBuffers,
      },
      processes: appMetrics.map(metric => ({
        type: metric.type,
        pid: metric.pid,
        memory: {
          workingSetSize: metric.memory.workingSetSize,
          peakWorkingSetSize: metric.memory.peakWorkingSetSize,
          privateBytes: metric.memory.privateBytes,
        },
        cpu: {
          percentCPUUsage: metric.cpu.percentCPUUsage,
        },
      })),
    };
  });
}
