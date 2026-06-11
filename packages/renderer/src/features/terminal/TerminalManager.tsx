/**
 * TerminalManager — 终端主组件
 *
 * 组装 TabBar + SearchBar + TerminalPane，
 * 管理终端的自动创建、DOM 挂载、事件监听。
 */

import { useEffect, useRef, useCallback, useState } from "react";
import { useTerminal } from "@/stores/terminal";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";
import { useChat } from "@/stores/chat";
import { useSession } from "@/stores/session";
import { terminalManager } from "@/services/terminal";
import { TerminalTabBar } from "./components/TerminalTabBar";
import { TerminalPane } from "./components/TerminalPane";
import { TerminalSearchBar } from "./components/TerminalSearchBar";
import "@xterm/xterm/css/xterm.css";

/** 获取当前 session 的工作区路径，优先级：session.workspace > pendingWorkspace > rootPath */
function getCurrentSessionWorkspace(): string | null {
    const chat = useChat.getState();
    const session = useSession.getState();
    // 有 sessionId 时，从 session 列表查找 workspace
    if (chat.sessionId) {
        const s = session.allSessions.find((s) => s.session_id === chat.sessionId);
        if (s?.workspace) return s.workspace;
    }
    // 新会话还没创建 session 时，用 pendingWorkspace
    if (chat.pendingWorkspace) return chat.pendingWorkspace;
    // 兜底用全局 rootPath
    return useWorkspace.getState().rootPath;
}

export function TerminalManager() {
    const instances = useTerminal((s) => s.instances);
    const activeTerminalId = useTerminal((s) => s.activeTerminalId);
    const [showSearch, setShowSearch] = useState(false);

    /** 追踪哪些终端已经挂载过 DOM 容器 */
    const attachedIds = useRef<Set<string>>(new Set());

    // ── 自动创建第一个终端（cwd 为当前 session 工作区） ──────────────

    const rootPath = useWorkspace((s) => s.rootPath);

    useEffect(() => {
        if (!rootPath) return;
        if (terminalManager.hasTerminals(rootPath)) return;
        if (!terminalManager.getActiveWorkspace()) {
            terminalManager.setActiveWorkspace(rootPath);
        }
        const cwd = getCurrentSessionWorkspace() ?? rootPath;
        terminalManager.createTerminal(rootPath, cwd);
    }, [rootPath]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── DOM 容器 ref 回调 ─────────────────────────────────────────────

    const setContainerRef = useCallback(
        (id: string, el: HTMLDivElement | null) => {
            if (el) {
                attachedIds.current.add(id);
                terminalManager.attachToContainer(id, el);
            }
        },
        [],
    );

    // ── 清理已移除的终端实例 ──────────────────────────────────────────

    useEffect(() => {
        const currentIds = new Set(instances.map((i) => i.id));
        for (const id of attachedIds.current) {
            if (!currentIds.has(id)) {
                attachedIds.current.delete(id);
            }
        }
    }, [instances]);

    // ── Refit / Focus ─────────────────────────────────────────────────

    useEffect(() => {
        if (activeTerminalId) {
            terminalManager.refitTerminal(activeTerminalId);
        }
    }, [activeTerminalId]);

    useEffect(() => {
        const handler = () => terminalManager.refitActiveTerminal();
        window.addEventListener("ftre:focus-terminal", handler);
        return () => window.removeEventListener("ftre:focus-terminal", handler);
    }, []);

    // ── 外部事件：在文件树中 "Open in Terminal" ─────────────────────

    useEffect(() => {
        const handler = async (e: Event) => {
            const { dirPath } = (e as CustomEvent).detail;
            if (!dirPath) return;
            const layout = useLayout.getState();
            if (!layout.terminalDropdownOpen) layout.toggleTerminalDropdown();
            const workspace = useWorkspace.getState().rootPath;
            if (workspace) {
                await terminalManager.createTerminal(workspace, dirPath);
            }
        };
        window.addEventListener("ftre:open-terminal-at", handler);
        return () => window.removeEventListener("ftre:open-terminal-at", handler);
    }, []);

    // ── 搜索快捷键 Ctrl+Shift+F ─────────────────────────────────────

    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'F') {
                // 只在终端面板或其子元素聚焦时响应
                const panel = document.querySelector('[data-terminal-panel]');
                if (!panel?.contains(document.activeElement)) return;
                e.preventDefault();
                setShowSearch((prev) => !prev);
            }
        };
        window.addEventListener("keydown", handler);
        return () => window.removeEventListener("keydown", handler);
    }, []);

    return (
        <div className="flex flex-col h-full">
            <TerminalTabBar
                instances={instances}
                activeTerminalId={activeTerminalId}
                onToggleSearch={() => setShowSearch((prev) => !prev)}
            />

            {/* 终端内容区 */}
            <div className="flex-1 relative overflow-hidden bg-base rounded-b-xl" data-terminal-panel>
                {/* 搜索栏（浮在右上角） */}
                {showSearch && (
                    <TerminalSearchBar
                        activeTerminalId={activeTerminalId}
                        onClose={() => setShowSearch(false)}
                    />
                )}

                {/* 终端面板 */}
                {instances.map((inst) => (
                    <TerminalPane
                        key={inst.id}
                        instance={inst}
                        isActive={inst.id === activeTerminalId}
                        containerRef={setContainerRef}
                    />
                ))}
            </div>
        </div>
    );
}
