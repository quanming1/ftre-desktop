import { create } from 'zustand';
import {
    fetchScheduledTasks,
    createScheduledTask,
    deleteScheduledTask,
    triggerScheduledTask,
    cancelScheduledTask,
    fetchScheduledTaskRuns,
    type TaskItem,
} from '@/services/api';

// ─── 类型 ──────────────────────────────────────────────────────────

export interface CreateFormData {
    name: string;
    strategy: string;
    cron: string;
    workspace: string;
    agentId: string;
    model: string;
    prompt: string;
}

const EMPTY_FORM: CreateFormData = {
    name: '',
    strategy: 'agent_auto',
    cron: '0 9 * * *',
    workspace: '',
    agentId: '',
    model: '',
    prompt: '',
};

// ─── Store ──────────────────────────────────────────────────────────

export interface ScheduledTaskState {
    // 列表
    tasks: TaskItem[];
    total: number;
    loading: boolean;
    _fetching: boolean;
    _pollTimer: ReturnType<typeof setInterval> | null;

    // 创建表单
    showCreateForm: boolean;
    createForm: CreateFormData;
    creating: boolean;

    // 执行历史
    runsTaskId: string | null;
    runs: TaskItem[];
    runsTotal: number;
    runsLoading: boolean;

    // 动作
    loadTasks: (showLoading?: boolean) => Promise<void>;
    startPolling: () => void;
    stopPolling: () => void;
    openCreateForm: (workspace: string, model?: string | null) => void;
    closeCreateForm: () => void;
    setCreateField: <K extends keyof CreateFormData>(key: K, value: CreateFormData[K]) => void;
    submitCreate: () => Promise<{ error?: string }>;
    deleteTask: (id: string) => Promise<void>;
    triggerTask: (id: string) => Promise<void>;
    cancelTask: (id: string) => Promise<void>;
    openRuns: (taskId: string) => Promise<void>;
    closeRuns: () => void;
}

export const useScheduledTaskStore = create<ScheduledTaskState>((set, get) => ({
    tasks: [],
    total: 0,
    loading: false,
    _fetching: false,
    _pollTimer: null,

    showCreateForm: false,
    createForm: { ...EMPTY_FORM },
    creating: false,

    runsTaskId: null,
    runs: [],
    runsTotal: 0,
    runsLoading: false,

    loadTasks: async (showLoading = false) => {
        if (get()._fetching) return;
        set({ _fetching: true });
        if (showLoading) set({ loading: true });
        try {
            const result = await fetchScheduledTasks({ limit: 100 });
            set({ tasks: result.tasks, total: result.total });
        } finally {
            set({ loading: false, _fetching: false });
        }
    },

    startPolling: () => {
        get().stopPolling();
        get().loadTasks(true);
        const timer = setInterval(() => get().loadTasks(false), 5000);
        set({ _pollTimer: timer });
    },

    stopPolling: () => {
        const timer = get()._pollTimer;
        if (timer) {
            clearInterval(timer);
            set({ _pollTimer: null });
        }
    },

    openCreateForm: (workspace, model) => {
        set({
            showCreateForm: true,
            createForm: {
                ...EMPTY_FORM,
                workspace,
                model: model || '',
            },
        });
    },

    closeCreateForm: () => {
        set({ showCreateForm: false, createForm: { ...EMPTY_FORM } });
    },

    setCreateField: (key, value) => {
        set((s) => ({ createForm: { ...s.createForm, [key]: value } }));
    },

    submitCreate: async () => {
        const { createForm } = get();
        set({ creating: true });
        try {
            const config: Record<string, unknown> = { agent_id: createForm.agentId };
            if (createForm.model) config.model = createForm.model;
            if (createForm.prompt.trim()) config.prompt = createForm.prompt.trim();

            const res = await createScheduledTask({
                name: createForm.name,
                strategy: createForm.strategy,
                cron: createForm.cron,
                workspace: createForm.workspace,
                config,
            });
            if (res.error) return { error: res.detail || res.error };
            get().closeCreateForm();
            await get().loadTasks(true);
            return {};
        } finally {
            set({ creating: false });
        }
    },

    deleteTask: async (id) => {
        await deleteScheduledTask(id);
        await get().loadTasks(true);
    },

    triggerTask: async (id) => {
        await triggerScheduledTask(id);
        await get().loadTasks(false);
    },

    cancelTask: async (id) => {
        await cancelScheduledTask(id);
        await get().loadTasks(false);
    },

    openRuns: async (taskId) => {
        set({ runsTaskId: taskId, runsLoading: true, runs: [], runsTotal: 0 });
        const res = await fetchScheduledTaskRuns(taskId, { limit: 20 });
        set({ runs: res.runs, runsTotal: res.total, runsLoading: false });
    },

    closeRuns: () => {
        set({ runsTaskId: null, runs: [], runsTotal: 0 });
    },
}));
