/**
 * 终端 Tab 栏
 *
 * - 拖拽排序
 * - 退出码状态指示（红色圆点）
 * - 双击重命名
 * - 右键菜单（重命名、清除、关闭）
 * - 新建终端按钮 + Shell 类型选择
 */

import { useCallback, useState, useRef } from "react";
import { Plus, X, Trash2, ChevronDown, Search } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Tooltip, TooltipProvider } from "@ftre/ui";
import { terminalManager } from "@/services/terminal";
import { useTerminal, type TerminalInstance } from "@/stores/terminal";
import { useWorkspace } from "@/stores/workspace";
import { useLayout } from "@/stores/layout";

/** 根据平台动态生成可选的 shell 列表 */
function getShellOptions(): { label: string; shell: string }[] {
    const platform = window.desktop?.platform;
    if (platform === 'win32') {
        return [
            { label: "PowerShell", shell: "powershell.exe" },
            { label: "CMD", shell: "cmd.exe" },
            { label: "Git Bash", shell: "C:\\Program Files\\Git\\bin\\bash.exe" },
            { label: "WSL", shell: "wsl.exe" },
        ];
    }
    if (platform === 'darwin') {
        return [
            { label: "zsh", shell: "/bin/zsh" },
            { label: "bash", shell: "/bin/bash" },
        ];
    }
    return [
        { label: "bash", shell: "/bin/bash" },
        { label: "zsh", shell: "/usr/bin/zsh" },
        { label: "fish", shell: "/usr/bin/fish" },
    ];
}

const SHELL_OPTIONS = getShellOptions();

interface TerminalTabBarProps {
    instances: TerminalInstance[];
    activeTerminalId: string | null;
    onToggleSearch: () => void;
}

export function TerminalTabBar({ instances, activeTerminalId, onToggleSearch }: TerminalTabBarProps) {
    const [renamingId, setRenamingId] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState("");
    const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; id: string } | null>(null);
    const [showShellMenu, setShowShellMenu] = useState<{ x: number; y: number } | null>(null);

    // ── 拖拽排序 ────────────────────────────────────────────────────
    const dragIdRef = useRef<string | null>(null);

    const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
        dragIdRef.current = id;
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", id);
    }, []);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
    }, []);

    const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
        e.preventDefault();
        const fromId = dragIdRef.current;
        if (fromId && fromId !== targetId) {
            terminalManager.reorderTerminals(fromId, targetId);
        }
        dragIdRef.current = null;
    }, []);

    // ── 重命名 ──────────────────────────────────────────────────────

    const handleDoubleClickLabel = useCallback((id: string, currentLabel: string) => {
        setRenamingId(id);
        setRenameValue(currentLabel);
    }, []);

    const commitRename = useCallback(
        (id: string) => {
            const trimmed = renameValue.trim();
            if (trimmed) terminalManager.renameTerminal(id, trimmed);
            setRenamingId(null);
        },
        [renameValue],
    );

    // ── 关闭 ────────────────────────────────────────────────────────

    const handleClose = useCallback((e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        terminalManager.closeTerminal(id);
        if (useTerminal.getState().instances.length === 0) {
            const layout = useLayout.getState();
            if (layout.terminalDropdownOpen) layout.toggleTerminalDropdown();
        }
    }, []);

    // ── 新建终端 ────────────────────────────────────────────────────

    const handleNewTerminal = useCallback(async () => {
        const workspace = useWorkspace.getState().rootPath;
        if (workspace) await terminalManager.createTerminal(workspace);
    }, []);

    const handleNewTerminalWithShell = useCallback(async (shell: string) => {
        const workspace = useWorkspace.getState().rootPath;
        if (workspace) await terminalManager.createTerminal(workspace, undefined, shell);
        setShowShellMenu(null);
    }, []);

    const handleShellMenuClick = useCallback((e: React.MouseEvent) => {
        e.stopPropagation();
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setShowShellMenu({ x: rect.left, y: rect.bottom + 4 });
    }, []);

    // ── 清除 ────────────────────────────────────────────────────────

    const handleClear = useCallback(() => {
        if (activeTerminalId) terminalManager.clearTerminal(activeTerminalId);
    }, [activeTerminalId]);

    // ── Tab 右键菜单 ────────────────────────────────────────────────

    const handleTabContextMenu = useCallback((e: React.MouseEvent, id: string) => {
        e.preventDefault();
        e.stopPropagation();
        setTabContextMenu({ x: e.clientX, y: e.clientY, id });
    }, []);

    const getTabContextMenuItems = useCallback(
        (id: string): ContextMenuItem[] => [
            {
                id: "rename",
                label: "重命名",
                action: () => {
                    const inst = instances.find((i) => i.id === id);
                    if (inst) handleDoubleClickLabel(id, inst.label);
                },
            },
            {
                id: "clear",
                label: "清除",
                icon: Trash2,
                action: () => terminalManager.clearTerminal(id),
            },
            { id: "sep1", label: "", separator: true, action: () => {} },
            {
                id: "close-others",
                label: "关闭其他终端",
                action: () => {
                    for (const inst of instances) {
                        if (inst.id !== id) terminalManager.closeTerminal(inst.id);
                    }
                },
            },
            {
                id: "close",
                label: "关闭",
                icon: X,
                action: () => {
                    terminalManager.closeTerminal(id);
                    if (useTerminal.getState().instances.length === 0) {
                        const layout = useLayout.getState();
                        if (layout.terminalDropdownOpen) layout.toggleTerminalDropdown();
                    }
                },
            },
        ],
        [instances, handleDoubleClickLabel],
    );

    /** 获取 tab 状态圆点的颜色 */
    const getDotColor = (inst: TerminalInstance, isActive: boolean): string => {
        if (inst.exited && inst.exitCode !== 0) return "bg-red-500";
        if (inst.exited) return "bg-t-ghost";
        if (isActive) return "bg-neon";
        return "bg-t-ghost";
    };

    return (
        <>
            <nav className="flex items-center bg-panel h-10 px-1 gap-0.5 border-b border-border-subtle shrink-0 select-none relative z-10">
                {instances.map((inst) => {
                    const isActive = inst.id === activeTerminalId;
                    const isRenaming = inst.id === renamingId;

                    return (
                        <button
                            key={inst.id}
                            draggable
                            onDragStart={(e) => handleDragStart(e, inst.id)}
                            onDragOver={handleDragOver}
                            onDrop={(e) => handleDrop(e, inst.id)}
                            onClick={() => terminalManager.setActiveTerminal(inst.id)}
                            onContextMenu={(e) => handleTabContextMenu(e, inst.id)}
                            className={`flex items-center h-[34px] px-3 gap-2 text-[11px] font-mono transition-colors group cursor-grab active:cursor-grabbing min-w-[100px] ${
                                isActive
                                    ? "bg-base rounded-t-md text-neon border-b-2 border-neon"
                                    : "text-t-ghost hover:bg-hover hover:text-t-muted"
                            }`}
                        >
                            {/* 状态圆点 */}
                            <span
                                className={`w-1.5 h-1.5 rounded-full shrink-0 ${getDotColor(inst, isActive)}`}
                                title={inst.exited ? `退出码: ${inst.exitCode}` : undefined}
                            />

                            {isRenaming ? (
                                <input
                                    autoFocus
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter") commitRename(inst.id);
                                        else if (e.key === "Escape") setRenamingId(null);
                                        e.stopPropagation();
                                    }}
                                    onBlur={() => commitRename(inst.id)}
                                    onClick={(e) => e.stopPropagation()}
                                    className="bg-transparent text-t-primary text-[11px] font-mono px-1 py-0.5 rounded border border-neon/30 outline-none w-20"
                                />
                            ) : (
                                <span
                                    className="font-medium truncate"
                                    onDoubleClick={() => handleDoubleClickLabel(inst.id, inst.label)}
                                >
                                    {inst.label}
                                </span>
                            )}

                            <span
                                role="button"
                                tabIndex={0}
                                aria-label={`关闭 ${inst.label}`}
                                onClick={(e) => handleClose(e, inst.id)}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" || e.key === " ") {
                                        e.preventDefault();
                                        handleClose(e as unknown as React.MouseEvent, inst.id);
                                    }
                                }}
                                className={`ml-auto text-[14px] transition-opacity cursor-pointer ${
                                    isActive ? "opacity-60 hover:opacity-100" : "opacity-0 group-hover:opacity-60"
                                }`}
                            >
                                <X size={14} strokeWidth={1.5} />
                            </span>
                        </button>
                    );
                })}

                {/* 右侧操作按钮组 */}
                <TooltipProvider>
                    <div className="ml-auto flex items-center pr-2 gap-1">
                        <Tooltip content="新建终端" side="bottom">
                            <button
                                onClick={handleNewTerminal}
                                aria-label="新建终端"
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-hover transition-colors text-t-ghost hover:text-t-muted"
                            >
                                <Plus size={16} strokeWidth={1.5} />
                            </button>
                        </Tooltip>
                        <Tooltip content="选择 Shell 类型" side="bottom">
                            <button
                                onClick={handleShellMenuClick}
                                aria-label="选择 Shell 类型"
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-hover transition-colors text-t-ghost hover:text-t-muted"
                            >
                                <ChevronDown size={14} strokeWidth={1.5} />
                            </button>
                        </Tooltip>

                        {/* 分隔线 */}
                        <div className="w-px h-4 bg-border-subtle mx-1" />

                        <Tooltip content="搜索终端 (Ctrl+Shift+F)" side="bottom">
                            <button
                                onClick={onToggleSearch}
                                aria-label="搜索终端"
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-hover transition-colors text-t-ghost hover:text-t-muted"
                            >
                                <Search size={15} strokeWidth={1.5} />
                            </button>
                        </Tooltip>
                        <Tooltip content="清除终端" side="bottom">
                            <button
                                onClick={handleClear}
                                aria-label="清除终端"
                                className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-hover transition-colors text-t-ghost hover:text-t-muted"
                            >
                                <Trash2 size={15} strokeWidth={1.5} />
                            </button>
                        </Tooltip>
                    </div>
                </TooltipProvider>
            </nav>

            {/* Tab 右键菜单 */}
            {tabContextMenu && (
                <ContextMenu
                    items={getTabContextMenuItems(tabContextMenu.id)}
                    position={{ x: tabContextMenu.x, y: tabContextMenu.y }}
                    onClose={() => setTabContextMenu(null)}
                />
            )}

            {/* Shell 选择菜单 */}
            {showShellMenu && (
                <ContextMenu
                    items={SHELL_OPTIONS.map((opt) => ({
                        id: opt.shell,
                        label: opt.label,
                        action: () => handleNewTerminalWithShell(opt.shell),
                    }))}
                    position={showShellMenu}
                    onClose={() => setShowShellMenu(null)}
                />
            )}
        </>
    );
}
