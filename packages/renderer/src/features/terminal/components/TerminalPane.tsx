/**
 * 终端面板 — 单个终端实例的 DOM 容器
 *
 * - 拖拽文件到终端 → 自动粘贴路径
 * - 右键菜单（复制、粘贴、全选、清除、重启）
 */

import { useCallback, useState } from "react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { terminalManager } from "@/services/terminal";
import type { TerminalInstance } from "@/stores/terminal";

interface TerminalPaneProps {
    instance: TerminalInstance;
    isActive: boolean;
    containerRef: (id: string, el: HTMLDivElement | null) => void;
}

export function TerminalPane({ instance, isActive, containerRef }: TerminalPaneProps) {
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

    // ── 右键菜单 ────────────────────────────────────────────────────

    const handleContextMenu = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    }, []);

    const getContextMenuItems = useCallback((): ContextMenuItem[] => {
        const term = terminalManager.getXterm(instance.id);
        const hasSelection = term?.hasSelection() ?? false;

        return [
            {
                id: "copy",
                label: "复制",
                shortcut: "Ctrl+C",
                disabled: !hasSelection,
                action: () => {
                    if (term?.hasSelection()) {
                        navigator.clipboard.writeText(term.getSelection());
                        term.clearSelection();
                    }
                },
            },
            {
                id: "paste",
                label: "粘贴",
                shortcut: "Ctrl+V",
                action: () => {
                    navigator.clipboard.readText().then((text) => {
                        if (text && term) term.paste(text);
                    });
                },
            },
            {
                id: "select-all",
                label: "全选",
                shortcut: "Ctrl+A",
                action: () => {
                    term?.selectAll();
                },
            },
            { id: "sep1", label: "", separator: true, action: () => {} },
            {
                id: "clear",
                label: "清除",
                action: () => terminalManager.clearTerminal(instance.id),
            },
            ...(instance.exited
                ? [
                    {
                        id: "restart",
                        label: "重启终端",
                        action: () => terminalManager.restartTerminal(instance.id),
                    },
                ]
                : []),
        ];
    }, [instance.id, instance.exited]);

    // ── 拖拽文件 ────────────────────────────────────────────────────

    const handleDragOver = useCallback((e: React.DragEvent) => {
        if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
        }
    }, []);

    const handleDrop = useCallback(
        (e: React.DragEvent) => {
            e.preventDefault();
            const files = Array.from(e.dataTransfer.files);
            if (files.length === 0) return;

            const term = terminalManager.getXterm(instance.id);
            if (!term || instance.exited) return;

            // 拼接所有文件路径，用空格分隔，含空格的路径加引号
            const paths = files.map((f) => {
                const path = (f as any).path as string | undefined;
                if (!path) return f.name;
                return path.includes(' ') ? `"${path}"` : path;
            });
            term.paste(paths.join(' '));
        },
        [instance.id, instance.exited],
    );

    return (
        <>
            <div
                ref={(el) => containerRef(instance.id, el)}
                className="absolute inset-0 p-4"
                style={{ display: isActive ? "block" : "none" }}
                onContextMenu={handleContextMenu}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            />

            {contextMenu && (
                <ContextMenu
                    items={getContextMenuItems()}
                    position={contextMenu}
                    onClose={() => setContextMenu(null)}
                />
            )}
        </>
    );
}
