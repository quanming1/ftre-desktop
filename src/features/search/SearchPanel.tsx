import { useCallback, useEffect, useRef, useState } from "react";
import { CaseSensitive, WholeWord, Regex, ChevronRight, ChevronDown, Loader2 } from "lucide-react";
import { useSearch, type SearchFileResult, type SearchMatch } from "@/stores/search";
import { useEditor } from "@/stores/editor";

export function SearchPanel() {
  const query = useSearch((s) => s.query);
  const options = useSearch((s) => s.options);
  const results = useSearch((s) => s.results);
  const isSearching = useSearch((s) => s.isSearching);
  const setQuery = useSearch((s) => s.setQuery);
  const setOption = useSearch((s) => s.setOption);
  const executeSearch = useSearch((s) => s.executeSearch);

  const searchInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus search input on mount (when search view becomes active)
  useEffect(() => {
    searchInputRef.current?.focus();
  }, []);

  // Listen for explicit focus request (e.g. from Ctrl+Shift+F shortcut)
  useEffect(() => {
    const handleFocus = () => {
      searchInputRef.current?.focus();
    };
    window.addEventListener("ftre:focus-search-input", handleFocus);
    return () => {
      window.removeEventListener("ftre:focus-search-input", handleFocus);
    };
  }, []);

  const handleQueryChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setQuery(e.target.value);
    },
    [setQuery],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === "Enter") {
        executeSearch();
      }
    },
    [executeSearch],
  );

  const toggleOption = useCallback(
    (key: "caseSensitive" | "wholeWord" | "useRegex") => {
      setOption(key, !options[key]);
    },
    [options, setOption],
  );

  const totalMatches = results.reduce((sum, r) => sum + r.matches.length, 0);

  return (
    <div className="flex flex-col gap-2.5 p-3 h-full" data-testid="search-panel">
      {/* Search input row */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          ref={searchInputRef}
          data-testid="search-input"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-[13px] bg-elevated border border-border rounded-md outline-none focus:border-accent text-t-primary placeholder:text-t-dim transition-colors"
          placeholder="搜索"
          value={query}
          onChange={handleQueryChange}
          onKeyDown={handleKeyDown}
          aria-label="搜索"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <ToggleButton
            testId="toggle-case-sensitive"
            icon={CaseSensitive}
            label="区分大小写"
            active={options.caseSensitive}
            onClick={() => toggleOption("caseSensitive")}
          />
          <ToggleButton
            testId="toggle-whole-word"
            icon={WholeWord}
            label="全字匹配"
            active={options.wholeWord}
            onClick={() => toggleOption("wholeWord")}
          />
          <ToggleButton
            testId="toggle-regex"
            icon={Regex}
            label="使用正则表达式"
            active={options.useRegex}
            onClick={() => toggleOption("useRegex")}
          />
        </div>
      </div>

      {/* Replace input row */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          data-testid="replace-input"
          className="flex-1 min-w-0 px-2.5 py-1.5 text-[13px] bg-elevated border border-border rounded-md outline-none focus:border-accent text-t-primary placeholder:text-t-dim transition-colors"
          placeholder="替换"
          aria-label="替换"
        />
      </div>

      {/* Include / Exclude glob patterns */}
      <div className="flex flex-col gap-1">
        <input
          type="text"
          data-testid="include-pattern"
          className="px-2.5 py-1.5 text-[13px] bg-elevated border border-border rounded-md outline-none focus:border-accent text-t-primary placeholder:text-t-dim transition-colors"
          placeholder="包含的文件（如 *.ts, src/**）"
          value={options.includePattern}
          onChange={(e) => setOption("includePattern", e.target.value)}
          aria-label="包含的文件"
        />
        <input
          type="text"
          data-testid="exclude-pattern"
          className="px-2.5 py-1.5 text-[13px] bg-elevated border border-border rounded-md outline-none focus:border-accent text-t-primary placeholder:text-t-dim transition-colors"
          placeholder="排除的文件（如 node_modules/**）"
          value={options.excludePattern}
          onChange={(e) => setOption("excludePattern", e.target.value)}
          aria-label="排除的文件"
        />
      </div>

      {/* Search results */}
      <div className="flex-1 overflow-y-auto" data-testid="search-results">
        {isSearching && (
          <div className="flex items-center gap-2.5 px-2.5 py-3 text-[13px] text-t-muted" data-testid="search-loading">
            <Loader2 size={15} className="animate-spin" />
            <span>搜索中...</span>
          </div>
        )}

        {!isSearching && results.length > 0 && (
          <>
            <div className="px-2.5 py-1.5 text-[13px] text-t-muted" data-testid="search-summary">
              {totalMatches} 个结果，位于 {results.length} 个文件中
            </div>
            {results.map((fileResult) => (
              <SearchFileGroup key={fileResult.filePath} fileResult={fileResult} query={query} />
            ))}
          </>
        )}

        {!isSearching && query.trim() !== "" && results.length === 0 && (
          <div className="px-2.5 py-3 text-[13px] text-t-muted" data-testid="search-no-results">
            未找到结果。
          </div>
        )}
      </div>
    </div>
  );
}

/** Collapsible file group showing matches for a single file */
function SearchFileGroup({ fileResult, query }: { fileResult: SearchFileResult; query: string }) {
  const [expanded, setExpanded] = useState(true);
  const openFile = useEditor((s) => s.openFile);

  const handleMatchClick = useCallback(
    (match: SearchMatch) => {
      // Open the file in the editor
      openFile({
        path: fileResult.filePath,
        name: fileResult.fileName,
        language: "",
        content: "",
      });
      // Dispatch event to jump to the matching line
      window.dispatchEvent(
        new CustomEvent("ftre:goto-line", {
          detail: {
            filePath: fileResult.filePath,
            lineNumber: match.lineNumber,
          },
        }),
      );
    },
    [fileResult.filePath, fileResult.fileName, openFile],
  );

  return (
    <div data-testid={`search-file-group-${fileResult.filePath}`}>
      <button
        className="flex items-center gap-1.5 w-full px-2.5 py-1.5 text-[13px] text-t-primary hover:bg-elevated rounded-md cursor-pointer transition-colors duration-150"
        onClick={() => setExpanded(!expanded)}
        data-testid={`search-file-header-${fileResult.filePath}`}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={12} className="shrink-0" /> : <ChevronRight size={12} className="shrink-0" />}
        <span className="truncate font-medium">{fileResult.fileName}</span>
        <span className="ml-auto shrink-0 text-t-dim">{fileResult.matches.length}</span>
      </button>

      {expanded && (
        <div>
          {fileResult.matches.map((match, idx) => (
            <SearchMatchItem key={`${match.lineNumber}-${idx}`} match={match} query={query} onClick={() => handleMatchClick(match)} />
          ))}
        </div>
      )}
    </div>
  );
}

/** Single match result line with highlighted match text */
function SearchMatchItem({ match, query, onClick }: { match: SearchMatch; query: string; onClick: () => void }) {
  const { lineNumber, lineContent, matchStart, matchEnd } = match;

  const before = lineContent.slice(0, matchStart);
  const highlighted = lineContent.slice(matchStart, matchEnd);
  const after = lineContent.slice(matchEnd);

  return (
    <button
      className="flex items-start gap-2 w-full px-4 py-1 text-[12px] hover:bg-elevated rounded-md cursor-pointer text-left transition-colors duration-150"
      onClick={onClick}
      data-testid={`search-match-${lineNumber}`}
      aria-label={`Line ${lineNumber}: ${lineContent.trim()}`}
    >
      <span className="shrink-0 text-t-dim w-8 text-right" data-testid="match-line-number">
        {lineNumber}
      </span>
      <span className="truncate text-t-muted" data-testid="match-line-content">
        {before}
        <span className="bg-accent/30 text-accent font-medium" data-testid="match-highlight">
          {highlighted}
        </span>
        {after}
      </span>
    </button>
  );
}

/** Small icon toggle button for search options */
function ToggleButton({
  testId,
  icon: Icon,
  label,
  active,
  onClick,
}: {
  testId: string;
  icon: React.ComponentType<{ size?: number; strokeWidth?: number }>;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      data-testid={testId}
      title={label}
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`p-1.5 rounded-md transition-colors duration-150 ${active ? "bg-accent/20 text-accent" : "text-t-dim hover:text-t-muted hover:bg-elevated"}`}
    >
      <Icon size={14} strokeWidth={1.5} />
    </button>
  );
}
