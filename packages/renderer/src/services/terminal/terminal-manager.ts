/**
 * TerminalSessionManager — 全局终端管理器
 *
 * - 全局单例，生命周期与 App 一致
 * - 终端实例按工作区分组，切换工作区时仅 detach/attach DOM
 * - Zustand useTerminal store 作为 thin UI view，由 manager 同步驱动
 */

import { Terminal } from '@xterm/xterm';
import { useTerminal } from '@/stores/terminal';
import { useNotification } from '@/stores/notification';
import {
    type TerminalInstanceInfo,
    type ManagedTerminal,
    type WorkspaceTerminals,
    TERM_OPTIONS,
    generateId,
    extractDirName,
    isContainerVisible,
} from './terminal-config';
import { loadAddons } from './terminal-addons';
import { attachKeybindings, clampFontSize, getDefaultFontSize } from './terminal-keybindings';

// ═══════════════════════════════════════════════════════════════════════
// TerminalSessionManager
// ═══════════════════════════════════════════════════════════════════════

export class TerminalSessionManager {
    /** 所有工作区的终端分组 */
    private workspaces = new Map<string, WorkspaceTerminals>();
    /** 当前活跃工作区路径 */
    private activeWorkspace: string | null = null;
    /** 全局字体大小（所有终端共享） */
    private fontSize: number = getDefaultFontSize();

    // ── 工作区分组 ──────────────────────────────────────────────────

    private getOrCreateWorkspace(workspace: string): WorkspaceTerminals {
        let ws = this.workspaces.get(workspace);
        if (!ws) {
            ws = { terminals: new Map(), activeTerminalId: null, nextIndex: 1 };
            this.workspaces.set(workspace, ws);
        }
        return ws;
    }

    private getActiveWorkspaceGroup(): WorkspaceTerminals | null {
        if (!this.activeWorkspace) return null;
        return this.workspaces.get(this.activeWorkspace) ?? null;
    }

    // ── 创建终端 ────────────────────────────────────────────────────

    /**
     * 创建新终端实例。
     * 在主进程创建 PTY、创建 xterm.js Terminal、注册 IPC 监听。
     * @param shell 可选，指定 shell 路径（如 cmd.exe / bash）
     */
    async createTerminal(workspace: string, cwd?: string, shell?: string): Promise<string | null> {
        try {
            const effectiveCwd = cwd ?? workspace;
            const { id: ptyId } = await window.desktop.terminal.create({
                cols: 80,
                rows: 24,
                cwd: effectiveCwd,
                shell,
            });

            const ws = this.getOrCreateWorkspace(workspace);
            const id = generateId();

            // 生成唯一标签
            let label = effectiveCwd ? extractDirName(effectiveCwd) : `Terminal ${ws.nextIndex}`;
            const existingLabels = new Set(
                Array.from(ws.terminals.values()).map((t) => t.info.label),
            );
            if (existingLabels.has(label)) {
                let suffix = 2;
                while (existingLabels.has(`${label} (${suffix})`)) suffix++;
                label = `${label} (${suffix})`;
            }

            // 创建 xterm.js 实例
            const term = new Terminal({ ...TERM_OPTIONS, fontSize: this.fontSize });
            const { fit, search } = loadAddons(term);

            // 注册按键处理
            attachKeybindings(
                term,
                (delta) => this.changeFontSize(delta),
                () => this.resetFontSize(),
            );

            // PTY IPC 监听
            const onDataDisposable = term.onData((data) => {
                window.desktop.terminal.write(ptyId, data);
            });

            const cleanupData = window.desktop.terminal.onData((incomingId, data) => {
                if (incomingId === ptyId) term.write(data);
            });

            const cleanupExit = window.desktop.terminal.onExit((exitId, code) => {
                if (exitId === ptyId) {
                    this.handlePtyExit(id, code);
                }
            });

            const info: TerminalInstanceInfo = {
                id,
                ptyId,
                label,
                createdAt: Date.now(),
                exited: false,
                exitCode: null,
            };

            const managed: ManagedTerminal = {
                info,
                term,
                fit,
                search,
                cleanupOnData: () => onDataDisposable.dispose(),
                cleanupData,
                cleanupExit,
                cleanupRestartListener: null,
                observer: null,
                container: null,
                needsRefit: true,
                workspace,
            };

            ws.terminals.set(id, managed);
            ws.activeTerminalId = id;
            ws.nextIndex += 1;

            // 确保 activeWorkspace 已设置（防止 HMR 后单例重建导致丢失）
            if (!this.activeWorkspace) {
                this.activeWorkspace = workspace;
            }
            if (workspace === this.activeWorkspace) {
                this.syncToStore();
            }

            return id;
        } catch (err) {
            console.error('[TerminalManager] createTerminal failed:', err);
            return null;
        }
    }

    // ── PTY 退出处理 ────────────────────────────────────────────────

    /**
     * PTY 退出后：显示提示、标记退出状态、注册"按任意键重启"监听
     */
    private handlePtyExit(id: string, code: number): void {
        const managed = this.findTerminal(id);
        if (!managed) return;

        managed.info = { ...managed.info, exited: true, exitCode: code };
        managed.term.write(`\r\n\x1b[90m[进程已退出，退出码 ${code}] 按任意键重启终端\x1b[0m\r\n`);

        if (code !== 0) {
            useNotification.getState().addNotification({
                level: 'warning',
                message: `终端进程已退出，退出码 ${code}`,
            });
        }

        // 注册"按任意键重启"
        const disposable = managed.term.onKey(() => {
            disposable.dispose();
            managed.cleanupRestartListener = null;
            this.restartTerminal(id);
        });
        managed.cleanupRestartListener = () => disposable.dispose();

        // 同步退出状态到 UI
        if (managed.workspace === this.activeWorkspace) {
            this.syncToStore();
        }
    }

    /**
     * 在同一个 tab 位置重启终端（重建 PTY，复用 xterm 实例）
     */
    async restartTerminal(id: string): Promise<void> {
        const managed = this.findTerminal(id);
        if (!managed) return;

        // 清理"按任意键重启"监听（右键菜单调用时该监听器仍存活）
        managed.cleanupRestartListener?.();
        managed.cleanupRestartListener = null;

        try {
            // 清空终端内容
            managed.term.reset();

            // 创建新 PTY
            const { id: ptyId } = await window.desktop.terminal.create({
                cols: managed.term.cols || 80,
                rows: managed.term.rows || 24,
                cwd: managed.workspace,
            });

            // 清理旧 IPC 监听
            managed.cleanupOnData();
            managed.cleanupData();
            managed.cleanupExit();

            // 注册新 IPC 监听
            const onDataDisposable = managed.term.onData((data) => {
                window.desktop.terminal.write(ptyId, data);
            });
            managed.cleanupOnData = () => onDataDisposable.dispose();
            managed.cleanupData = window.desktop.terminal.onData((incomingId, data) => {
                if (incomingId === ptyId) managed.term.write(data);
            });
            managed.cleanupExit = window.desktop.terminal.onExit((exitId, code) => {
                if (exitId === ptyId) {
                    this.handlePtyExit(id, code);
                }
            });

            // 更新状态
            managed.info = {
                ...managed.info,
                ptyId,
                exited: false,
                exitCode: null,
            };

            if (managed.workspace === this.activeWorkspace) {
                this.syncToStore();
            }
        } catch (err) {
            console.error('[TerminalManager] restartTerminal failed:', err);
            managed.term.write('\r\n\x1b[31m[重启终端失败]\x1b[0m\r\n');
        }
    }

    // ── 关闭终端 ────────────────────────────────────────────────────

    closeTerminal(id: string): void {
        for (const [wsPath, ws] of this.workspaces) {
            const managed = ws.terminals.get(id);
            if (!managed) continue;

            this.disposeManaged(managed);
            ws.terminals.delete(id);

            if (ws.activeTerminalId === id) {
                const remaining = Array.from(ws.terminals.values());
                ws.activeTerminalId = remaining.length > 0
                    ? remaining[remaining.length - 1].info.id
                    : null;
            }

            if (wsPath === this.activeWorkspace) {
                this.syncToStore();
            }
            return;
        }
    }

    closeAllTerminals(workspace?: string): void {
        const target = workspace ?? this.activeWorkspace;
        if (!target) return;
        const ws = this.workspaces.get(target);
        if (!ws) return;

        for (const managed of ws.terminals.values()) {
            this.disposeManaged(managed);
        }
        ws.terminals.clear();
        ws.activeTerminalId = null;
        ws.nextIndex = 1;

        if (target === this.activeWorkspace) {
            this.syncToStore();
        }
    }

    // ── 终端操作 ────────────────────────────────────────────────────

    setActiveTerminal(id: string): void {
        const ws = this.getActiveWorkspaceGroup();
        if (!ws) return;
        if (ws.terminals.has(id)) {
            ws.activeTerminalId = id;
            this.syncToStore();
        }
    }

    renameTerminal(id: string, label: string): void {
        const ws = this.getActiveWorkspaceGroup();
        if (!ws) return;
        const managed = ws.terminals.get(id);
        if (managed) {
            managed.info = { ...managed.info, label };
            this.syncToStore();
        }
    }

    clearTerminal(id: string): void {
        const managed = this.findTerminal(id);
        if (managed) {
            managed.term.clear();
        }
    }

    // ── 搜索 ────────────────────────────────────────────────────────

    /** 在指定终端中搜索文本 */
    searchInTerminal(id: string, query: string): boolean {
        const managed = this.findTerminal(id);
        if (!managed || !query) return false;
        return managed.search.findNext(query);
    }

    /** 搜索上一个匹配 */
    searchPrevious(id: string, query: string): boolean {
        const managed = this.findTerminal(id);
        if (!managed || !query) return false;
        return managed.search.findPrevious(query);
    }

    /** 清除搜索高亮 */
    clearSearch(id: string): void {
        const managed = this.findTerminal(id);
        if (managed) managed.search.clearDecorations();
    }

    // ── 字体缩放 ────────────────────────────────────────────────────

    /** 改变所有终端的字体大小 */
    changeFontSize(delta: number): void {
        this.fontSize = clampFontSize(this.fontSize, delta);
        this.applyFontSizeToAll();
    }

    /** 重置字体大小为默认值 */
    resetFontSize(): void {
        this.fontSize = getDefaultFontSize();
        this.applyFontSizeToAll();
    }

    private applyFontSizeToAll(): void {
        for (const ws of this.workspaces.values()) {
            for (const managed of ws.terminals.values()) {
                managed.term.options.fontSize = this.fontSize;
                // refit 以适配新字号
                if (managed.container && isContainerVisible(managed.container)) {
                    managed.fit.fit();
                }
            }
        }
    }

    // ── DOM 挂载 / 卸载 ─────────────────────────────────────────────

    attachToContainer(id: string, container: HTMLDivElement): void {
        const managed = this.findTerminal(id);
        if (!managed) return;
        if (managed.container === container) return;

        const term = managed.term;

        if (term.element) {
            container.appendChild(term.element);
        } else {
            term.open(container);
        }

        managed.container = container;

        // ResizeObserver
        if (managed.observer) managed.observer.disconnect();
        let resizeRaf: number | null = null;
        managed.observer = new ResizeObserver(() => {
            if (!isContainerVisible(container)) return;
            if (resizeRaf) return;
            resizeRaf = requestAnimationFrame(() => {
                resizeRaf = null;
                if (!isContainerVisible(container)) return;
                managed.fit.fit();
                if (term.cols > 0 && term.rows > 0) {
                    window.desktop.terminal.resize(managed.info.ptyId, term.cols, term.rows);
                }
            });
        });
        managed.observer.observe(container);

        // 立即 fit
        if (isContainerVisible(container)) {
            requestAnimationFrame(() => {
                managed.fit.fit();
                if (term.cols > 0 && term.rows > 0) {
                    window.desktop.terminal.resize(managed.info.ptyId, term.cols, term.rows);
                }
                managed.needsRefit = false;
            });
        } else {
            managed.needsRefit = true;
        }
    }

    detachFromContainer(id: string): void {
        const managed = this.findTerminal(id);
        if (!managed) return;

        if (managed.observer) {
            managed.observer.disconnect();
            managed.observer = null;
        }
        managed.container = null;
        managed.needsRefit = true;
    }

    // ── Refit / Focus ───────────────────────────────────────────────

    refitActiveTerminal(): void {
        const ws = this.getActiveWorkspaceGroup();
        if (!ws?.activeTerminalId) return;
        this.refitTerminal(ws.activeTerminalId);
    }

    refitTerminal(id: string): void {
        const managed = this.findTerminal(id);
        if (!managed?.container || !isContainerVisible(managed.container)) return;

        requestAnimationFrame(() => {
            managed.fit.fit();
            if (managed.term.cols > 0 && managed.term.rows > 0) {
                window.desktop.terminal.resize(managed.info.ptyId, managed.term.cols, managed.term.rows);
            }
            managed.term.focus();
            managed.needsRefit = false;
        });
    }

    // ── 工作区切换 ──────────────────────────────────────────────────

    switchWorkspace(newWorkspace: string): void {
        const oldWorkspace = this.activeWorkspace;
        if (oldWorkspace === newWorkspace) return;

        if (oldWorkspace) {
            const oldWs = this.workspaces.get(oldWorkspace);
            if (oldWs) {
                for (const managed of oldWs.terminals.values()) {
                    this.detachFromContainer(managed.info.id);
                }
            }
        }

        this.activeWorkspace = newWorkspace;
        this.syncToStore();
    }

    setActiveWorkspace(workspace: string): void {
        this.activeWorkspace = workspace;
        this.syncToStore();
    }

    getActiveWorkspace(): string | null {
        return this.activeWorkspace;
    }

    // ── Tab 排序 ────────────────────────────────────────────────────

    /** 交换两个终端 tab 的顺序 */
    reorderTerminals(fromId: string, toId: string): void {
        const ws = this.getActiveWorkspaceGroup();
        if (!ws || fromId === toId) return;

        const entries = Array.from(ws.terminals.entries());
        const fromIndex = entries.findIndex(([key]) => key === fromId);
        const toIndex = entries.findIndex(([key]) => key === toId);
        if (fromIndex < 0 || toIndex < 0) return;

        // 交换位置
        const [fromEntry] = entries.splice(fromIndex, 1);
        entries.splice(toIndex, 0, fromEntry);

        // 重建有序 Map
        ws.terminals = new Map(entries);
        this.syncToStore();
    }

    // ── 查询 ────────────────────────────────────────────────────────

    getTerminals(workspace?: string): TerminalInstanceInfo[] {
        const ws = this.workspaces.get(workspace ?? this.activeWorkspace ?? '');
        if (!ws) return [];
        return Array.from(ws.terminals.values()).map((m) => m.info);
    }

    getActiveTerminalId(workspace?: string): string | null {
        const ws = this.workspaces.get(workspace ?? this.activeWorkspace ?? '');
        return ws?.activeTerminalId ?? null;
    }

    getXterm(id: string): Terminal | null {
        return this.findTerminal(id)?.term ?? null;
    }

    hasTerminals(workspace?: string): boolean {
        const ws = this.workspaces.get(workspace ?? this.activeWorkspace ?? '');
        return ws ? ws.terminals.size > 0 : false;
    }

    /** 获取终端实例信息（用于右键菜单等 UI 操作） */
    getTerminalInfo(id: string): TerminalInstanceInfo | null {
        return this.findTerminal(id)?.info ?? null;
    }

    // ── 清理 ────────────────────────────────────────────────────────

    disposeAll(): void {
        for (const ws of this.workspaces.values()) {
            for (const managed of ws.terminals.values()) {
                this.disposeManaged(managed);
            }
            ws.terminals.clear();
        }
        this.workspaces.clear();
        this.activeWorkspace = null;
        this.syncToStore();
    }

    // ── 内部 ────────────────────────────────────────────────────────

    private findTerminal(id: string): ManagedTerminal | null {
        for (const ws of this.workspaces.values()) {
            const managed = ws.terminals.get(id);
            if (managed) return managed;
        }
        return null;
    }

    private disposeManaged(managed: ManagedTerminal): void {
        if (managed.observer) {
            managed.observer.disconnect();
            managed.observer = null;
        }
        managed.cleanupOnData();
        managed.cleanupData();
        managed.cleanupExit();
        managed.cleanupRestartListener?.();
        if (!managed.info.exited) {
            window.desktop?.terminal.kill(managed.info.ptyId).catch(() => {});
        }
        managed.term.dispose();
        managed.container = null;
    }

    private syncToStore(): void {
        const ws = this.activeWorkspace
            ? this.workspaces.get(this.activeWorkspace)
            : null;

        if (!ws || ws.terminals.size === 0) {
            useTerminal.getState().syncFrom({
                instances: [],
                activeTerminalId: null,
                nextIndex: 1,
            });
            return;
        }

        useTerminal.getState().syncFrom({
            instances: Array.from(ws.terminals.values()).map((m) => m.info),
            activeTerminalId: ws.activeTerminalId,
            nextIndex: ws.nextIndex,
        });
    }
}
