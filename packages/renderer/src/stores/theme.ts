/**
 * Theme Manager Store
 *
 * 负责模式状态管理、DOM 标记、持久化、系统偏好监听。
 * 支持 light / dark / system 三态切换。
 *
 * 持久化策略：
 * - window.desktop.store (IPC): 主持久化，跨窗口一致
 * - localStorage (ftre-theme-mode-cache): 首屏防闪同步读取的镜像缓存
 */

import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedMode = "light" | "dark";

const VALID_MODES: Set<string> = new Set(["light", "dark", "system"]);
const STORAGE_KEY = "ftre-theme-mode";
const CACHE_KEY = "ftre-theme-mode-cache";

export interface ThemeState {
    mode: ThemeMode;
    resolvedMode: ResolvedMode;
    setMode: (mode: ThemeMode) => void;
    /** 内部：系统偏好变化时调用 */
    _onSystemChange: (prefersDark: boolean) => void;
    /** 初始化（在 React 渲染前调用） */
    init: () => Promise<void>;
}

function resolveMode(mode: ThemeMode, prefersDark: boolean): ResolvedMode {
    if (mode === "light") return "light";
    if (mode === "dark") return "dark";
    return prefersDark ? "dark" : "light";
}

function getSystemPrefersDark(): boolean {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function applyToDOM(resolved: ResolvedMode): void {
    document.documentElement.setAttribute("data-theme", resolved);
}

export const useTheme = create<ThemeState>((set, get) => ({
    mode: "system",
    resolvedMode: getSystemPrefersDark() ? "dark" : "light",

    setMode: (newMode) => {
        if (!VALID_MODES.has(newMode)) {
            console.warn(
                `[ThemeManager] Invalid mode "${newMode}", falling back to "system"`,
            );
            newMode = "system";
        }
        const resolved = resolveMode(newMode, getSystemPrefersDark());
        applyToDOM(resolved);
        set({ mode: newMode, resolvedMode: resolved });

        // 同步写入 localStorage 缓存（首屏防闪脚本使用）
        try {
            localStorage.setItem(CACHE_KEY, newMode);
        } catch {
            // localStorage 不可用时静默忽略
        }

        // 异步写入 IPC store
        window.desktop?.store?.set(STORAGE_KEY, newMode).catch(() => { });
    },

    _onSystemChange: (prefersDark) => {
        const { mode } = get();
        if (mode !== "system") return;
        const resolved = prefersDark ? "dark" : "light";
        applyToDOM(resolved);
        set({ resolvedMode: resolved });
    },

    init: async () => {
        let persisted: string | null = null;

        // 优先从 IPC store 读取
        try {
            if (window.desktop?.store) {
                const { value } = await window.desktop.store.get(STORAGE_KEY);
                if (typeof value === "string") persisted = value;
            }
        } catch {
            // IPC 失败，静默回退
        }

        // IPC 失败时回退到 localStorage 缓存
        if (persisted === null) {
            try {
                persisted = localStorage.getItem(CACHE_KEY);
            } catch {
                // localStorage 不可用
            }
        }

        let mode: ThemeMode = "system";
        if (persisted && VALID_MODES.has(persisted)) {
            mode = persisted as ThemeMode;
        } else if (persisted) {
            console.warn(
                `[ThemeManager] Invalid persisted mode "${persisted}", falling back to "system"`,
            );
        }

        const resolved = resolveMode(mode, getSystemPrefersDark());
        applyToDOM(resolved);
        set({ mode, resolvedMode: resolved });

        // 监听系统偏好变化
        const mql = window.matchMedia("(prefers-color-scheme: dark)");
        mql.addEventListener("change", (e) => {
            get()._onSystemChange(e.matches);
        });
    },
}));
