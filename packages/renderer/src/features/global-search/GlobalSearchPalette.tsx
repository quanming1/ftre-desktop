import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X, FileCode, MessageSquare, Terminal, Loader2 } from 'lucide-react';
import { useGlobalSearch } from '@/stores/global-search';
import { CATEGORY_ORDER, type SearchCategory, type SearchResult, type ContentMatch } from './types';
import { getFileIcon } from '@/lib/file-icons';

// ── Category config ─────────────────────────────────────────────────

interface CategoryTab {
    key: 'all' | SearchCategory;
    label: string;
}

const TABS: CategoryTab[] = [
    { key: 'all', label: '全部' },
    { key: 'file', label: '文件' },
    { key: 'content', label: '内容' },
    { key: 'session', label: '会话' },
    { key: 'command', label: '命令' },
];

const CATEGORY_LABELS: Record<SearchCategory, string> = {
    file: '文件',
    content: '内容匹配',
    session: '会话',
    command: '命令',
};

const CATEGORY_ICONS: Record<SearchCategory, typeof FileCode> = {
    file: FileCode,
    content: Search,
    session: MessageSquare,
    command: Terminal,
};


// ── Main Component ──────────────────────────────────────────────────

export function GlobalSearchPalette() {
    const open = useGlobalSearch((s) => s.open);
    const query = useGlobalSearch((s) => s.query);
    const activeCategory = useGlobalSearch((s) => s.activeCategory);
    const selectedIndex = useGlobalSearch((s) => s.selectedIndex);
    const isSearching = useGlobalSearch((s) => s.isSearching);
    const resultsByCategory = useGlobalSearch((s) => s.resultsByCategory);

    const setQuery = useGlobalSearch((s) => s.setQuery);
    const setCategory = useGlobalSearch((s) => s.setCategory);
    const setSelectedIndex = useGlobalSearch((s) => s.setSelectedIndex);
    const confirmSelection = useGlobalSearch((s) => s.confirmSelection);
    const close = useGlobalSearch((s) => s.close);

    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);

    const flatResults = useMemo(() => {
        return useGlobalSearch.getState().getFlatResults();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [resultsByCategory, activeCategory]);

    // Focus input on open
    useEffect(() => {
        if (open) {
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [open]);

    // Scroll selected item into view
    useEffect(() => {
        if (!listRef.current) return;
        const item = listRef.current.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement | null;
        item?.scrollIntoView({ block: 'nearest' });
    }, [selectedIndex]);

    const handleKeyDown = useCallback(
        (e: React.KeyboardEvent) => {
            switch (e.key) {
                case 'Escape':
                    e.stopPropagation();
                    close();
                    break;
                case 'ArrowDown':
                    e.preventDefault();
                    if (flatResults.length > 0) {
                        setSelectedIndex(Math.min(selectedIndex + 1, flatResults.length - 1));
                    }
                    break;
                case 'ArrowUp':
                    e.preventDefault();
                    setSelectedIndex(Math.max(selectedIndex - 1, 0));
                    break;
                case 'Enter':
                    e.preventDefault();
                    confirmSelection();
                    break;
                case 'Tab': {
                    e.preventDefault();
                    const currentIdx = TABS.findIndex((t) => t.key === activeCategory);
                    const nextIdx = (currentIdx + (e.shiftKey ? -1 : 1) + TABS.length) % TABS.length;
                    setCategory(TABS[nextIdx].key);
                    break;
                }
            }
        },
        [selectedIndex, flatResults.length, activeCategory, close, setSelectedIndex, confirmSelection, setCategory],
    );

    if (!open) return null;

    // Build grouped sections for "all" mode
    const groupedSections = activeCategory === 'all'
        ? buildGroupedSections(resultsByCategory)
        : null;

    return (
        <>
            {/* Backdrop */}
            <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={close} />

            {/* Palette */}
            <div
                className="fixed top-[10%] left-1/2 -translate-x-1/2 w-full max-w-2xl bg-elevated border border-border-subtle rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col"
                style={{ maxHeight: '70vh' }}
            >
                {/* Search input */}
                <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
                    <Search size={14} className="text-t-ghost shrink-0" />
                    <input
                        ref={inputRef}
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="搜索文件、命令、会话..."
                        className="flex-1 bg-transparent text-[13px] text-white placeholder-t-ghost outline-none font-mono"
                    />
                    {isSearching && <Loader2 size={14} className="text-t-ghost animate-spin shrink-0" />}
                    <button onClick={close} className="text-t-ghost hover:text-t-secondary transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Category tabs */}
                <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
                    {TABS.map((tab) => (
                        <button
                            key={tab.key}
                            onClick={() => setCategory(tab.key)}
                            className={`px-2.5 py-1 text-[11px] font-mono rounded transition-colors ${
                                activeCategory === tab.key
                                    ? 'bg-accent/20 text-accent'
                                    : 'text-t-dim hover:text-t-muted hover:bg-white/[0.04]'
                            }`}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* Results */}
                <div ref={listRef} className="flex-1 overflow-y-auto py-1">
                    {activeCategory === 'all' && groupedSections ? (
                        <GroupedResults
                            sections={groupedSections}
                            selectedIndex={selectedIndex}
                            onSelect={setSelectedIndex}
                            close={close}
                        />
                    ) : (
                        <FlatResults
                            results={flatResults}
                            selectedIndex={selectedIndex}
                            onSelect={setSelectedIndex}
                            close={close}
                        />
                    )}

                    {query.trim() !== '' && flatResults.length === 0 && !isSearching && (
                        <div className="px-4 py-8 text-center text-[12px] text-t-ghost font-mono">
                            未找到结果
                        </div>
                    )}

                    {query.trim() === '' && (
                        <div className="px-4 py-8 text-center text-[12px] text-t-ghost font-mono">
                            输入关键词开始搜索
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[9px] text-t-faint font-mono">
                    <span>↑↓ 导航</span>
                    <span>回车 确认</span>
                    <span>Tab 切换分类</span>
                    <span>Esc 关闭</span>
                </div>
            </div>
        </>
    );
}

// ── Sub-components ──────────────────────────────────────────────────

interface GroupedSection {
    category: SearchCategory;
    results: SearchResult[];
    startIndex: number;
}

function buildGroupedSections(
    resultsByCategory: Record<SearchCategory, SearchResult[]>,
): GroupedSection[] {
    const sections: GroupedSection[] = [];
    let idx = 0;
    for (const cat of CATEGORY_ORDER) {
        const items = resultsByCategory[cat];
        if (items && items.length > 0) {
            sections.push({ category: cat, results: items, startIndex: idx });
            idx += items.length;
        }
    }
    return sections;
}

function GroupedResults({
    sections,
    selectedIndex,
    onSelect,
    close,
}: {
    sections: GroupedSection[];
    selectedIndex: number;
    onSelect: (i: number) => void;
    close: () => void;
}) {
    return (
        <>
            {sections.map((section) => (
                <div key={section.category}>
                    <div className="px-4 py-1.5 text-[10px] text-t-ghost font-mono uppercase tracking-wide sticky top-0 bg-elevated">
                        {CATEGORY_LABELS[section.category]}
                    </div>
                    {section.results.map((result, i) => {
                        const globalIdx = section.startIndex + i;
                        return (
                            <ResultItem
                                key={result.id}
                                result={result}
                                isSelected={globalIdx === selectedIndex}
                                globalIndex={globalIdx}
                                onSelect={onSelect}
                                close={close}
                            />
                        );
                    })}
                </div>
            ))}
        </>
    );
}

function FlatResults({
    results,
    selectedIndex,
    onSelect,
    close,
}: {
    results: SearchResult[];
    selectedIndex: number;
    onSelect: (i: number) => void;
    close: () => void;
}) {
    return (
        <>
            {results.map((result, idx) => (
                <ResultItem
                    key={result.id}
                    result={result}
                    isSelected={idx === selectedIndex}
                    globalIndex={idx}
                    onSelect={onSelect}
                    close={close}
                />
            ))}
        </>
    );
}

function ResultItem({
    result,
    isSelected,
    globalIndex,
    onSelect,
    close,
}: {
    result: SearchResult;
    isSelected: boolean;
    globalIndex: number;
    onSelect: (i: number) => void;
    close: () => void;
}) {
    // 内容搜索结果使用专用渲染
    if (result.category === 'content' && result.contentMatches && result.contentMatches.length > 0) {
        return (
            <ContentResultItem
                result={result}
                isSelected={isSelected}
                globalIndex={globalIndex}
                onSelect={onSelect}
                close={close}
            />
        );
    }

    const handleClick = () => {
        result.action();
        close();
    };

    const Icon = getCategoryIcon(result);

    return (
        <button
            data-index={globalIndex}
            onClick={handleClick}
            onMouseEnter={() => onSelect(globalIndex)}
            className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                isSelected ? 'bg-neon-ghost' : 'hover:bg-white/[0.02]'
            }`}
        >
            <Icon size={14} className="shrink-0" style={{ opacity: isSelected ? 1 : 0.5 }} />
            <div className="flex-1 min-w-0">
                <div className={`text-[13px] truncate font-mono ${isSelected ? 'text-white' : 'text-t-secondary'}`}>
                    {result.titleHighlight
                        ? renderHighlighted(result.title, result.titleHighlight)
                        : result.title}
                </div>
                {result.subtitle && (
                    <div className="text-[10px] text-t-ghost truncate font-mono">{result.subtitle}</div>
                )}
            </div>
            {isSelected && <span className="text-[9px] text-t-dim font-mono shrink-0">回车</span>}
        </button>
    );
}

/** 内容搜索专用渲染：文件头 + 每行匹配代码高亮 */
function ContentResultItem({
    result,
    isSelected,
    globalIndex,
    onSelect,
    close,
}: {
    result: SearchResult;
    isSelected: boolean;
    globalIndex: number;
    onSelect: (i: number) => void;
    close: () => void;
}) {
    const handleClick = () => {
        result.action();
        close();
    };

    const { icon: FileIcon, color: iconColor } = getFileIcon(result.title, false);
    const matches = result.contentMatches!;

    return (
        <div
            data-index={globalIndex}
            onClick={handleClick}
            onMouseEnter={() => onSelect(globalIndex)}
            className={`w-full px-4 py-2 text-left cursor-pointer transition-colors ${
                isSelected ? 'bg-neon-ghost' : 'hover:bg-white/[0.02]'
            }`}
        >
            {/* 文件头：图标 + 文件名 + 相对路径 + 匹配数 */}
            <div className="flex items-center gap-2 mb-1.5">
                <FileIcon size={14} className="shrink-0" style={{ color: iconColor }} />
                <span className={`text-[13px] font-mono font-medium ${isSelected ? 'text-white' : 'text-t-secondary'}`}>
                    {result.title}
                </span>
                {result.subtitle && (
                    <span className="text-[10px] text-t-ghost font-mono truncate">{result.subtitle}</span>
                )}
                {isSelected && <span className="ml-auto text-[9px] text-t-dim font-mono shrink-0">回车</span>}
            </div>
            {/* 匹配行列表 */}
            <div className="ml-5 border-l border-border pl-2.5 space-y-0.5">
                {matches.map((m) => (
                    <MatchLine key={`${m.lineNumber}:${m.matchStart}`} match={m} />
                ))}
            </div>
        </div>
    );
}

/** 单行匹配：行号 + 代码内容（匹配部分高亮），超长截断 */
function MatchLine({ match }: { match: ContentMatch }) {
    const { lineNumber, lineContent, matchStart, matchEnd } = match;

    // 截取匹配位置附近的上下文（前后各 60 字符），避免超长行撑开布局
    const contextStart = Math.max(0, matchStart - 60);
    const contextEnd = Math.min(lineContent.length, matchEnd + 60);
    const prefix = contextStart > 0 ? '…' : '';
    const suffix = contextEnd < lineContent.length ? '…' : '';

    const visible = lineContent.slice(contextStart, contextEnd);
    const hlStart = matchStart - contextStart;
    const hlEnd = matchEnd - contextStart;

    const before = visible.slice(0, hlStart);
    const matched = visible.slice(hlStart, hlEnd);
    const after = visible.slice(hlEnd);

    return (
        <div className="flex items-baseline gap-2 text-[12px] font-mono leading-[18px] overflow-hidden">
            <span className="text-t-ghost select-none w-[3ch] text-right shrink-0">{lineNumber}</span>
            <span className="text-t-muted truncate">
                {prefix}{before}
                <span className="bg-accent/25 text-accent rounded-sm px-[1px]">{matched}</span>
                {after}{suffix}
            </span>
        </div>
    );
}

// ── Helpers ─────────────────────────────────────────────────────────

function getCategoryIcon(result: SearchResult) {
    if (result.category === 'file') {
        const { icon } = getFileIcon(result.title, false);
        return icon;
    }
    return CATEGORY_ICONS[result.category] || Search;
}

function renderHighlighted(text: string, highlights: [number, number][]) {
    if (!highlights || highlights.length === 0) return text;

    const parts: React.ReactNode[] = [];
    let lastEnd = 0;

    for (const [start, end] of highlights) {
        if (start > lastEnd) {
            parts.push(text.slice(lastEnd, start));
        }
        parts.push(
            <span key={start} className="text-accent font-medium">
                {text.slice(start, end)}
            </span>,
        );
        lastEnd = end;
    }

    if (lastEnd < text.length) {
        parts.push(text.slice(lastEnd));
    }

    return <>{parts}</>;
}
