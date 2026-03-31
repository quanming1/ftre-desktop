/**
 * 终端搜索栏
 *
 * 浮在终端内容区右上角，支持向上/向下搜索
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { X, ChevronUp, ChevronDown, Search } from "lucide-react";
import { terminalManager } from "@/services/terminal";

interface TerminalSearchBarProps {
    activeTerminalId: string | null;
    onClose: () => void;
}

export function TerminalSearchBar({ activeTerminalId, onClose }: TerminalSearchBarProps) {
    const [query, setQuery] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);

    // 打开时自动聚焦
    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleSearch = useCallback(
        (direction: "next" | "prev") => {
            if (!activeTerminalId || !query) return;
            if (direction === "next") {
                terminalManager.searchInTerminal(activeTerminalId, query);
            } else {
                terminalManager.searchPrevious(activeTerminalId, query);
            }
        },
        [activeTerminalId, query],
    );

    const handleClose = useCallback(() => {
        if (activeTerminalId) terminalManager.clearSearch(activeTerminalId);
        setQuery("");
        onClose();
    }, [activeTerminalId, onClose]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            if (e.key === "Enter") {
                e.preventDefault();
                handleSearch(e.shiftKey ? "prev" : "next");
            } else if (e.key === "Escape") {
                e.preventDefault();
                handleClose();
            }
        },
        [handleSearch, handleClose],
    );

    // 输入变化时实时搜索
    useEffect(() => {
        if (activeTerminalId && query) {
            terminalManager.searchInTerminal(activeTerminalId, query);
        } else if (activeTerminalId) {
            terminalManager.clearSearch(activeTerminalId);
        }
        return () => {
            if (activeTerminalId) {
                terminalManager.clearSearch(activeTerminalId);
            }
        };
    }, [query, activeTerminalId]);

    return (
        <div className="absolute top-4 right-4 z-10 flex items-center w-64 h-9 bg-elevated/80 backdrop-blur-md border border-white/[0.1] rounded-lg px-3 shadow-xl">
            <Search size={14} className="text-t-ghost shrink-0 mr-2" />
            <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="搜索..."
                className="bg-transparent text-t-primary text-[12px] outline-none flex-1 placeholder:text-t-ghost/60"
            />
            <div className="flex items-center gap-1 ml-2 text-t-ghost">
                <button
                    onClick={() => handleSearch("prev")}
                    title="上一个 (Shift+Enter)"
                    className="hover:text-t-muted transition-colors"
                >
                    <ChevronUp size={16} />
                </button>
                <button
                    onClick={() => handleSearch("next")}
                    title="下一个 (Enter)"
                    className="hover:text-t-muted transition-colors"
                >
                    <ChevronDown size={16} />
                </button>
                <button
                    onClick={handleClose}
                    title="关闭 (Esc)"
                    className="hover:text-t-muted transition-colors ml-1"
                >
                    <X size={14} />
                </button>
            </div>
        </div>
    );
}
