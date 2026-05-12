import { useState, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, XCircle, MemoryStick, Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useDiagnostics } from "@/stores/diagnostics";
import { useMemoryMonitor, formatBytes } from "@/services/memory-monitor";
import { MemoryMonitorPanel } from "@/features/memory/MemoryMonitorPanel";
import { useWsStatus } from "@/stores/chat";
import { wsClient } from "@/services/websocket-client";

/** Format cursor position as "Ln {line}, Col {col}" */
export function formatCursorPosition(line: number, col: number): string {
  return `行 ${line}, 列 ${col}`;
}

/** All supported languages with their ids and display labels */
export const SUPPORTED_LANGUAGES: { id: string; label: string }[] = [
  { id: "typescript", label: "TypeScript" },
  { id: "javascript", label: "JavaScript" },
  { id: "typescriptreact", label: "TypeScript React" },
  { id: "javascriptreact", label: "JavaScript React" },
  { id: "json", label: "JSON" },
  { id: "html", label: "HTML" },
  { id: "css", label: "CSS" },
  { id: "markdown", label: "Markdown" },
  { id: "python", label: "Python" },
  { id: "plaintext", label: "Plain Text" },
  { id: "yaml", label: "YAML" },
  { id: "xml", label: "XML" },
  { id: "shellscript", label: "Shell Script" },
  { id: "sql", label: "SQL" },
  { id: "go", label: "Go" },
  { id: "rust", label: "Rust" },
  { id: "java", label: "Java" },
  { id: "c", label: "C" },
  { id: "cpp", label: "C++" },
  { id: "csharp", label: "C#" },
];

const LANGUAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  SUPPORTED_LANGUAGES.map((l) => [l.id, l.label]),
);

/** Derive a display-friendly language label from the language id */
export function getLanguageLabel(language: string): string {
  return LANGUAGE_LABEL_MAP[language] ?? language;
}

/** Language selector dropdown shown when clicking the language mode area */
function LanguageSelector({
  currentLanguage,
  onSelect,
  onClose,
}: {
  currentLanguage: string;
  onSelect: (languageId: string) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = SUPPORTED_LANGUAGES.filter((lang) =>
    lang.label.toLowerCase().includes(filter.toLowerCase()),
  );

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  // Close on Escape
  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    }
  }

  return (
    <div
      ref={containerRef}
      data-testid="language-selector"
      className="absolute bottom-full right-0 mb-1 w-60 bg-base border border-border-subtle rounded-lg shadow-2xl z-50 overflow-hidden"
      onKeyDown={handleKeyDown}
    >
      <div className="p-1">
        <input
          ref={inputRef}
          data-testid="language-search"
          type="text"
          className="w-full px-2.5 py-1.5 text-[13px] bg-elevated border border-border rounded-md outline-none focus:border-accent"
          placeholder="搜索语言..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      <ul
        data-testid="language-list"
        className="max-h-56 overflow-y-auto"
        role="listbox"
      >
        {filtered.map((lang) => (
          <li
            key={lang.id}
            role="option"
            aria-selected={lang.id === currentLanguage}
            data-testid={`language-option-${lang.id}`}
            className={`px-3.5 py-1.5 text-[13px] cursor-pointer hover:bg-elevated transition-colors ${
              lang.id === currentLanguage
                ? "text-accent font-semibold"
                : "text-t-dim"
            }`}
            onClick={() => onSelect(lang.id)}
          >
            {lang.label}
          </li>
        ))}
        {filtered.length === 0 && (
          <li
            className="px-3.5 py-1.5 text-[13px] text-t-dim"
            data-testid="language-no-results"
          >
            未找到匹配的语言
          </li>
        )}
      </ul>
    </div>
  );
}

/** Gateway connection status indicator */
function GatewayStatus() {
  const wsStatus = useWsStatus();

  const handleClick = () => {
    if (wsStatus !== 'connected') {
      wsClient.reconnect();
    }
  };

  if (wsStatus === 'connected') {
    return (
      <span className="flex items-center gap-1 text-green-400" title="AI 后端已连接">
        <Wifi size={13} />
        <span>已连接</span>
      </span>
    );
  }

  if (wsStatus === 'reconnecting' || wsStatus === 'connecting') {
    return (
      <span
        className="flex items-center gap-1 text-yellow-400 cursor-pointer hover:text-yellow-300"
        title="正在连接 AI 后端..."
        onClick={handleClick}
      >
        <RefreshCw size={13} className="animate-spin" />
        <span>连接中</span>
      </span>
    );
  }

  // disconnected
  return (
    <span
      className="flex items-center gap-1 text-red-400 cursor-pointer hover:text-red-300"
      title="未连接 AI 后端，点击重连"
      onClick={handleClick}
    >
      <WifiOff size={13} />
      <span>未连接</span>
    </span>
  );
}

export function StatusBar() {
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [languageSelectorOpen, setLanguageSelectorOpen] = useState(false);
  const [memoryPanelOpen, setMemoryPanelOpen] = useState(false);

  const activeFile = useEditor((s) => s.activeFile);
  const openFiles = useEditor((s) => s.openFiles);
  const rootPath = useWorkspace((s) => s.rootPath);
  const errorCount = useDiagnostics((s) => s.errorCount());
  const warningCount = useDiagnostics((s) => s.warningCount());
  const currentFile = openFiles.find((f) => f.path === activeFile);

  // 内存监控：组件挂载时启动采集，卸载时停止
  const memoryStart = useMemoryMonitor((s) => s.start);
  const memoryStop = useMemoryMonitor((s) => s.stop);
  const memoryLatest = useMemoryMonitor((s) => s.latest);

  useEffect(() => {
    memoryStart();
    return () => memoryStop();
  }, [memoryStart, memoryStop]);

  // 格式化当前 JS 堆内存用量（简短显示在 StatusBar 上）
  const heapDisplay = memoryLatest
    ? formatBytes(memoryLatest.jsHeapUsed, 0)
    : "—";

  // Listen for cursor position updates from Monaco editor
  const handleCursorChange = useCallback((e: Event) => {
    const detail = (e as CustomEvent<{ line: number; col: number }>).detail;
    if (detail) {
      setCursorLine(detail.line);
      setCursorCol(detail.col);
    }
  }, []);

  useEffect(() => {
    window.addEventListener("ftre:cursor-change", handleCursorChange);
    return () =>
      window.removeEventListener("ftre:cursor-change", handleCursorChange);
  }, [handleCursorChange]);

  const handleLanguageSelect = useCallback((languageId: string) => {
    setLanguageSelectorOpen(false);
    window.dispatchEvent(
      new CustomEvent("ftre:change-language", {
        detail: { language: languageId },
      }),
    );
  }, []);

  return (
    <div
      className="h-[var(--statusbar-height)] bg-base border-t border-border flex items-center justify-between px-3 text-[12px] font-mono"
      data-testid="status-bar"
    >
      {/* Left side: diagnostics + gateway status */}
      <div className="flex items-center gap-3.5 text-t-dim">
        <span className="flex items-center gap-2.5" data-testid="diagnostics">
          <span className="flex items-center gap-1">
            <XCircle size={14} />
            {errorCount}
          </span>
          <span className="flex items-center gap-1">
            <AlertTriangle size={14} />
            {warningCount}
          </span>
        </span>
        <GatewayStatus />
      </div>

      {/* Right side: memory indicator, cursor position, indent, encoding, EOL, language */}
      <div className="flex items-center gap-3.5 text-t-dim">
        {/* 内存用量指示器 — 点击展开详情面板 */}
        <span className="relative">
          <span
            data-testid="memory-indicator"
            className="cursor-pointer hover:text-t-primary transition-colors"
            onClick={() => setMemoryPanelOpen((prev) => !prev)}
            title="内存监控"
          >
            <MemoryStick
              size={14}
              className="inline-block mr-1 align-text-bottom"
            />
            {heapDisplay}
          </span>
          {memoryPanelOpen && (
            <MemoryMonitorPanel onClose={() => setMemoryPanelOpen(false)} />
          )}
        </span>
        <span data-testid="cursor-position">
          {formatCursorPosition(cursorLine, cursorCol)}
        </span>
        <span data-testid="indent-setting">空格: 2</span>
        <span data-testid="encoding">UTF-8</span>
        <span data-testid="eol">LF</span>
        {currentFile?.language && (
          <span className="relative">
            <span
              data-testid="language-mode"
              className="cursor-pointer hover:text-t-primary"
              onClick={() => setLanguageSelectorOpen((prev) => !prev)}
            >
              {getLanguageLabel(currentFile.language)}
            </span>
            {languageSelectorOpen && (
              <LanguageSelector
                currentLanguage={currentFile.language}
                onSelect={handleLanguageSelect}
                onClose={() => setLanguageSelectorOpen(false)}
              />
            )}
          </span>
        )}
      </div>
    </div>
  );
}
