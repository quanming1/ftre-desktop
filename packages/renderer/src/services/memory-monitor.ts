import { create } from "zustand";
import { getTextModelResolverService } from "@ftre/editor";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

/** 单次内存采样数据 */
export interface MemorySample {
  timestamp: number;
  // 渲染进程 JS 堆（来自 performance.memory）
  jsHeapUsed: number; // bytes
  jsHeapTotal: number; // bytes
  jsHeapLimit: number; // bytes
  // 主进程内存（来自 IPC）
  mainRss: number; // bytes
  mainHeapUsed: number; // bytes
  mainHeapTotal: number; // bytes
  // 所有 Electron 进程的工作集总和（来自 app.getAppMetrics）
  totalWorkingSet: number; // KB
  // 编辑器相关
  editorSlotCount: number;
  editorPreloadedModelCount: number;
  editorViewStateCount: number;
  editorActiveSlot: string | null;
}

/** 内存监控 Store 状态 */
export interface MemoryMonitorState {
  /** 是否正在采集 */
  running: boolean;
  /** 采集间隔（毫秒） */
  intervalMs: number;
  /** 最新一次采样 */
  latest: MemorySample | null;
  /** 历史采样（环形缓冲区，最多 maxHistory 条） */
  history: MemorySample[];
  /** 历史采样上限（默认 120 条 = 5s 间隔下约 10 分钟） */
  maxHistory: number;

  // 操作
  start(): void;
  stop(): void;
  setInterval(ms: number): void;
  collectNow(): Promise<void>;
  clearHistory(): void;
}

// ══════════════════════════════════════════════════
//  模块级变量（不放进 Zustand 状态，避免序列化问题）
// ══════════════════════════════════════════════════

/** 定时器 ID，用于 start/stop 管理 */
let _timerId: ReturnType<typeof setInterval> | null = null;

// ══════════════════════════════════════════════════
//  Chrome-only performance.memory 类型守卫
// ══════════════════════════════════════════════════

interface PerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

function getPerformanceMemory(): PerformanceMemory | null {
  const perf = performance as any;
  if (perf && perf.memory) {
    return perf.memory as PerformanceMemory;
  }
  return null;
}

// ══════════════════════════════════════════════════
//  采集核心逻辑
// ══════════════════════════════════════════════════

async function collectSample(): Promise<MemorySample> {
  const timestamp = Date.now();

  // 1. 渲染进程 JS 堆
  const perfMemory = getPerformanceMemory();
  const jsHeapUsed = perfMemory?.usedJSHeapSize ?? 0;
  const jsHeapTotal = perfMemory?.totalJSHeapSize ?? 0;
  const jsHeapLimit = perfMemory?.jsHeapSizeLimit ?? 0;

  // 2. 主进程内存（通过 IPC，可能不可用）
  let mainRss = 0;
  let mainHeapUsed = 0;
  let mainHeapTotal = 0;
  let totalWorkingSet = 0;

  try {
    const usage = await window.desktop?.memory?.getUsage();
    if (usage) {
      mainRss = usage.main.rss;
      mainHeapUsed = usage.main.heapUsed;
      mainHeapTotal = usage.main.heapTotal;
      // 汇总所有进程的工作集大小（单位 KB）
      totalWorkingSet = usage.processes.reduce(
        (sum, p) => sum + (p.memory.workingSetSize ?? 0),
        0,
      );
    }
  } catch {
    // IPC 不可用（开发/测试环境），使用默认值 0
  }

  // 3. 编辑器内部状态
  let editorSlotCount = 0;
  let editorPreloadedModelCount = 0;
  let editorViewStateCount = 0;
  let editorActiveSlot: string | null = null;

  try {
    const modelService = getTextModelResolverService();
    if (modelService.isInitialized()) {
      const dirtyUris = modelService.getDirtyUris();
      editorPreloadedModelCount = dirtyUris.length;
      // 简化版：不再追踪 slot 数量
      editorSlotCount = 0;
      editorViewStateCount = 0;
    }
  } catch {
    // ModelService 可能尚未初始化
  }

  return {
    timestamp,
    jsHeapUsed,
    jsHeapTotal,
    jsHeapLimit,
    mainRss,
    mainHeapUsed,
    mainHeapTotal,
    totalWorkingSet,
    editorSlotCount,
    editorPreloadedModelCount,
    editorViewStateCount,
    editorActiveSlot,
  };
}

// ══════════════════════════════════════════════════
//  Zustand Store
// ══════════════════════════════════════════════════

export const useMemoryMonitor = create<MemoryMonitorState>((set, get) => ({
  running: false,
  intervalMs: 5000,
  latest: null,
  history: [],
  maxHistory: 120,

  start() {
    const state = get();
    if (state.running) return;

    // 立即采集一次
    get().collectNow();

    // 设置定时采集
    _timerId = setInterval(() => {
      get().collectNow();
    }, state.intervalMs);

    set({ running: true });
  },

  stop() {
    if (_timerId !== null) {
      clearInterval(_timerId);
      _timerId = null;
    }
    set({ running: false });
  },

  setInterval(ms: number) {
    const wasRunning = get().running;

    // 先停止旧定时器
    if (_timerId !== null) {
      clearInterval(_timerId);
      _timerId = null;
    }

    set({ intervalMs: ms });

    // 如果之前在运行，用新间隔重新启动
    if (wasRunning) {
      _timerId = setInterval(() => {
        get().collectNow();
      }, ms);
      set({ running: true });
    }
  },

  async collectNow() {
    const sample = await collectSample();
    const { history, maxHistory } = get();

    // 环形缓冲区：超出上限时丢弃最旧的条目
    const nextHistory =
      history.length >= maxHistory
        ? [...history.slice(1), sample]
        : [...history, sample];

    set({
      latest: sample,
      history: nextHistory,
    });
  },

  clearHistory() {
    set({ latest: null, history: [] });
  },
}));

// ══════════════════════════════════════════════════
//  格式化工具函数
// ══════════════════════════════════════════════════

/** 将字节数格式化为可读字符串（如 "12.3 MB"） */
export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const index = Math.min(i, sizes.length - 1);
  return `${(bytes / Math.pow(k, index)).toFixed(decimals)} ${sizes[index]}`;
}

/** 将 KB 值格式化为可读字符串 */
export function formatKB(kb: number, decimals = 1): string {
  return formatBytes(kb * 1024, decimals);
}
