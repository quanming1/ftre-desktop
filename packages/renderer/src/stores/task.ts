import { create } from 'zustand';
import { fetchTasks, type TaskItem } from '@/services/api';
import { createManagedPoller } from '@/services/visibility-manager';

// ─── 类型 ──────────────────────────────────────────────────────────

export type TaskStatusFilter = '' | 'pending' | 'running' | 'completed' | 'failed' | 'stopped';
export type TaskTypeFilter = '' | 'compaction' | 'memory_update' | 'scheduled' | 'scheduled_result';

export interface TaskFilters {
  status: TaskStatusFilter;
  type: TaskTypeFilter;
}

// ─── Store ──────────────────────────────────────────────────────────

export const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
export type PageSize = typeof PAGE_SIZE_OPTIONS[number];

export interface TaskState {
  tasks: TaskItem[];
  total: number;
  loading: boolean;       // 仅首次/手动刷新时为 true，轮询不设置
  filters: TaskFilters;
  page: number;           // 当前页码（从 1 开始）
  pageSize: PageSize;     // 每页条数
  _pollTimer: (() => void) | null;
  _fetching: boolean;     // 并发 guard，防止请求堆积

  loadTasks: (showLoading?: boolean) => Promise<void>;
  setFilter: (filters: Partial<TaskFilters>) => void;
  setPage: (page: number) => void;
  setPageSize: (size: PageSize) => void;
  startPolling: () => void;
  stopPolling: () => void;

  // 计算属性
  totalPages: () => number;
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  total: 0,
  loading: false,
  filters: { status: '', type: '' },
  page: 1,
  pageSize: 20,
  _pollTimer: null,
  _fetching: false,

  loadTasks: async (showLoading = false) => {
    // 并发 guard：上一次请求还没完成就跳过
    if (get()._fetching) return;
    set({ _fetching: true });
    if (showLoading) set({ loading: true });
    try {
      const { filters, page, pageSize } = get();
      const offset = (page - 1) * pageSize;
      const result = await fetchTasks({
        status: filters.status || undefined,
        type: filters.type || undefined,
        limit: pageSize,
        offset,
      });
      set({ tasks: result.tasks, total: result.total });
    } finally {
      set({ loading: false, _fetching: false });
    }
  },

  setFilter: (partial) => {
    // 切换筛选时重置到第 1 页
    set((s) => ({ filters: { ...s.filters, ...partial }, page: 1 }));
    get().loadTasks(true);
  },

  setPage: (page) => {
    const totalPages = get().totalPages();
    const clamped = Math.max(1, Math.min(page, totalPages || 1));
    set({ page: clamped });
    get().loadTasks(true);
  },

  setPageSize: (size) => {
    // 切换 pageSize 时重置到第 1 页
    set({ pageSize: size, page: 1 });
    get().loadTasks(true);
  },

  startPolling: () => {
    get().stopPolling();
    const cancel = createManagedPoller(() => get().loadTasks(false), 3000);
    set({ _pollTimer: cancel });
  },

  stopPolling: () => {
    const cancel = get()._pollTimer;
    if (cancel) {
      cancel();
      set({ _pollTimer: null });
    }
  },

  totalPages: () => {
    const { total, pageSize } = get();
    return Math.max(1, Math.ceil(total / pageSize));
  },
}));
