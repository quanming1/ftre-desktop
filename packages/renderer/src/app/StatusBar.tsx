import { useState, useCallback, useEffect, useRef } from "react";
import { AlertTriangle, XCircle } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { useDiagnostics } from "@/stores/diagnostics";

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

const LANGUAGE_LABEL_MAP: Record<string, string> = Object.fromEntries(SUPPORTED_LANGUAGES.map((l) => [l.id, l.label]));

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

  const filtered = SUPPORTED_LANGUAGES.filter((lang) => lang.label.toLowerCase().includes(filter.toLowerCase()));

  // Focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Close on click outside
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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
      <ul data-testid="language-list" className="max-h-56 overflow-y-auto" role="listbox">
        {filtered.map((lang) => (
          <li
            key={lang.id}
            role="option"
            aria-selected={lang.id === currentLanguage}
            data-testid={`language-option-${lang.id}`}
            className={`px-3.5 py-1.5 text-[13px] cursor-pointer hover:bg-elevated transition-colors ${
              lang.id === currentLanguage ? "text-accent font-semibold" : "text-t-dim"
            }`}
            onClick={() => onSelect(lang.id)}
          >
            {lang.label}
          </li>
        ))}
        {filtered.length === 0 && (
          <li className="px-3.5 py-1.5 text-[13px] text-t-dim" data-testid="language-no-results">
            未找到匹配的语言
          </li>
        )}
      </ul>
    </div>
  );
}

export function StatusBar() {
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const [languageSelectorOpen, setLanguageSelectorOpen] = useState(false);

  const activeFile = useEditor((s) => s.activeFile);
  const openFiles = useEditor((s) => s.openFiles);
  const rootPath = useWorkspace((s) => s.rootPath);
  const errorCount = useDiagnostics((s) => s.errorCount());
  const warningCount = useDiagnostics((s) => s.warningCount());
  const currentFile = openFiles.find((f) => f.path === activeFile);

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
    return () => window.removeEventListener("ftre:cursor-change", handleCursorChange);
  }, [handleCursorChange]);

  const handleLanguageSelect = useCallback((languageId: string) => {
    setLanguageSelectorOpen(false);
    window.dispatchEvent(new CustomEvent("ftre:change-language", { detail: { language: languageId } }));
  }, []);

  return (
    <div
      className="h-[var(--statusbar-height)] bg-base border-t border-border flex items-center justify-between px-3 text-[12px] font-mono"
      data-testid="status-bar"
    >
      {/* Left side: diagnostics */}
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
      </div>

      {/* Right side: cursor position, indent, encoding, EOL, language */}
      <div className="flex items-center gap-3.5 text-t-dim">
        <span data-testid="cursor-position">{formatCursorPosition(cursorLine, cursorCol)}</span>
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
