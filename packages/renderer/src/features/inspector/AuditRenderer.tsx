/**
 * AuditRenderer — Inspector 中的工作区变更审阅页。
 *
 * 这里只读取 Git 状态和单文件 Diff，不编辑工作区；Diff 内容在文件展开或复制时
 * 才按需读取，避免打开审阅页就把所有变更文件全部加载进内存。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronRight, Clipboard, ExternalLink, FileDiff, GitCompareArrows, Loader2, RefreshCw } from "lucide-react";
import { CodeDiff } from "@jiang_quan_ming/react-code-diff";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ftre/ui";
import { useInspector, type AuditFileChange, type AuditTab } from "@/stores/inspector";
import { FileIconView } from "@/components/FileIconView";
import type { TabRendererProps } from "./tabRegistry";
import { codeDiffLightConfig } from "./renderers/codeDiffConfig";

type CompareMode = "turn" | "uncommitted" | "unstaged" | "staged" | "untracked";

interface AuditGitFile {
  path: string;
  oldPath?: string;
  absolutePath: string;
  status: string;
  staged: boolean;
  isDir: boolean;
  additions: number;
  deletions: number;
  turnChange?: AuditFileChange;
}

interface AuditDiff {
  original: string;
  modified: string;
  error?: string;
}

const COMPARE_OPTIONS: Array<{ value: CompareMode; label: string }> = [
  { value: "uncommitted", label: "未提交" },
  { value: "unstaged", label: "未暂存" },
  { value: "staged", label: "已暂存" },
  { value: "untracked", label: "未跟踪" },
];

function fileKey(file: AuditGitFile): string {
  return file.absolutePath.replace(/\\/g, "/").toLowerCase();
}

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx",
    py: "python", json: "json", md: "markdown", go: "go", rs: "rust",
    java: "java", c: "c", cpp: "cpp", sh: "bash", yml: "yaml", yaml: "yaml",
    html: "html", css: "css", xml: "xml", sql: "sql", toml: "toml",
  };
  return map[ext] ?? ext ?? "plaintext";
}

function buildCopyText(file: AuditGitFile, diff: AuditDiff): string {
  const before = diff.original
    .split("\n")
    .map((line) => `-${line}`)
    .join("\n");
  const after = diff.modified
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
  return `--- a/${file.path}\n+++ b/${file.path}\n${before}\n${after}`;
}

function mergeFiles(files: AuditGitFile[], mode: CompareMode): AuditGitFile[] {
  const filtered = mode === "staged"
    ? files.filter((file) => file.staged)
    : mode === "unstaged"
      ? files.filter((file) => !file.staged)
      : mode === "untracked"
        ? files.filter((file) => file.status === "untracked")
        : files;

  if (mode !== "uncommitted") {
    return [...filtered].sort((a, b) => a.path.localeCompare(b.path));
  }

  // status --porcelain 会在同一文件同时存在 staged 和 unstaged 修改时返回两条记录。
  // 审阅“未提交”时只展示一个 item，展开时再读取 HEAD 到工作区的完整 Diff。
  const byPath = new Map<string, AuditGitFile>();
  for (const file of filtered) {
    const key = fileKey(file);
    const existing = byPath.get(key);
    if (!existing || (existing.staged && !file.staged)) {
      byPath.set(key, file);
    }
  }
  return [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
}

export function AuditRenderer({ tab, active, wordWrap }: TabRendererProps) {
  if (tab.type !== "audit") return null;
  return <AuditView tab={tab as AuditTab} active={active} wordWrap={wordWrap} />;
}

function AuditView({ tab, active, wordWrap }: { tab: AuditTab; active: boolean; wordWrap: boolean }) {
  const workspacePath = tab.workspacePath;
  const revealNonce = tab.revealNonce;
  // 轮次审阅使用消息/运行快照，不再把当前工作区 Git 状态误当成这一轮的全部修改。
  const hasTurnChanges = tab.scope === "turn" || tab.turnChanges !== undefined;
  const [compareMode, setCompareMode] = useState<CompareMode>(hasTurnChanges ? "turn" : "uncommitted");
  const [files, setFiles] = useState<AuditGitFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<Record<string, AuditDiff>>({});
  const [loadingDiffKeys, setLoadingDiffKeys] = useState<Set<string>>(new Set());
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRef = useRef(active);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (hasTurnChanges) {
      setLoading(false);
      setFiles([]);
      setDiffs({});
      setExpandedKey(null);
      return;
    }
    if (!workspacePath) {
      setLoading(false);
      setFiles([]);
      return;
    }
    let cancelled = false;
    let etag = "";

    const refresh = async (force: boolean) => {
      try {
        const result = await window.desktop.git.poll(workspacePath, etag, force);
        if (cancelled) return;
        etag = result.etag;
        if (!result.changed && etag !== "") return;
        const stats = result.stats ?? {};
        const nextFiles = (result.files ?? [])
          .filter((file) => !file.isDir)
          .map((file) => {
            const stat = stats[file.absolutePath.replace(/\\/g, "/").toLowerCase()];
            return {
              ...file,
              additions: stat?.additions ?? 0,
              deletions: stat?.deletions ?? 0,
            };
          });
        setFiles(nextFiles);
        setError(null);
      } catch (cause) {
        if (!cancelled) {
          setFiles([]);
          setError(cause instanceof Error ? cause.message : "无法读取工作区变更");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    setLoading(true);
    setError(null);
    setFiles([]);
    setDiffs({});
    setExpandedKey(null);
    void refresh(true);
    const timer = window.setInterval(() => {
      if (activeRef.current) void refresh(false);
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [hasTurnChanges, workspacePath, refreshToken, revealNonce]);

  useEffect(() => {
    setCompareMode(hasTurnChanges ? "turn" : "uncommitted");
  }, [hasTurnChanges, revealNonce]);

  useEffect(() => {
    setDiffs({});
    setExpandedKey(null);
  }, [compareMode]);

  useEffect(() => () => {
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
  }, []);

  const turnFiles = useMemo<AuditGitFile[]>(
    () => (tab.turnChanges ?? []).map((change) => ({
      path: change.filePath,
      absolutePath: change.filePath,
      status: change.operation === "write" ? "added" : "modified",
      staged: false,
      isDir: false,
      additions: change.additions,
      deletions: change.deletions,
      turnChange: change,
    })),
    [tab.turnChanges],
  );
  const visibleFiles = useMemo(
    () => compareMode === "turn" ? turnFiles : mergeFiles(files, compareMode),
    [files, compareMode, turnFiles],
  );
  const totalAdditions = visibleFiles.reduce((total, file) => total + file.additions, 0);
  const totalDeletions = visibleFiles.reduce((total, file) => total + file.deletions, 0);

  const readDiff = useCallback(async (file: AuditGitFile): Promise<AuditDiff> => {
    if (compareMode === "turn") {
      return file.turnChange
        ? { original: file.turnChange.before, modified: file.turnChange.after }
        : { original: "", modified: "", error: "缺少本轮修改快照" };
    }
    if (compareMode === "uncommitted") {
      const [head, current] = await Promise.all([
        window.desktop.git.show(workspacePath, file.path),
        window.desktop.fs.readFile(file.absolutePath),
      ]);
      return {
        original: head.content ?? "",
        modified: current.error ? "" : current.content ?? "",
        error: head.error || current.error,
      };
    }

    return window.desktop.git.diffFile(
      workspacePath,
      file.path,
      file.status,
      compareMode === "staged",
      file.oldPath,
    );
  }, [compareMode, workspacePath]);

  const ensureDiff = useCallback(async (file: AuditGitFile): Promise<AuditDiff> => {
    const key = fileKey(file);
    const cached = diffs[key];
    if (cached) return cached;
    setLoadingDiffKeys((current) => new Set(current).add(key));
    try {
      let result: AuditDiff;
      try {
        result = await readDiff(file);
      } catch (cause) {
        result = {
          original: "",
          modified: "",
          error: cause instanceof Error ? cause.message : "无法读取文件 Diff",
        };
      }
      setDiffs((current) => ({ ...current, [key]: result }));
      return result;
    } finally {
      setLoadingDiffKeys((current) => {
        const next = new Set(current);
        next.delete(key);
        return next;
      });
    }
  }, [diffs, readDiff]);

  const toggleExpanded = useCallback(async (file: AuditGitFile) => {
    const key = fileKey(file);
    if (expandedKey === key) {
      setExpandedKey(null);
      return;
    }
    setExpandedKey(key);
    await ensureDiff(file);
  }, [ensureDiff, expandedKey]);

  const copyDiff = useCallback(async (file: AuditGitFile) => {
    const diff = await ensureDiff(file);
    const text = buildCopyText(file, diff);
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
    } else {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      textarea.remove();
    }
    const key = fileKey(file);
    setCopiedKey(key);
    if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedKey(null), 1400);
  }, [ensureDiff]);

  const openSourceFile = useCallback((file: AuditGitFile) => {
    const normalized = file.absolutePath.replace(/\\/g, "/");
    const path = /^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")
      ? normalized
      : `${workspacePath.replace(/\\/g, "/").replace(/\/$/, "")}/${normalized.replace(/^\/+/, "")}`;
    useInspector.getState().openFilePreview(`audit-file-${path}`, path, file.path.split(/[\\/]/).pop() ?? file.path);
  }, [workspacePath]);

  const compareOptions = hasTurnChanges
    ? [{ value: "turn" as const, label: "上一轮" }, ...COMPARE_OPTIONS]
    : COMPARE_OPTIONS;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border-subtle px-3">
        <GitCompareArrows size={14} className="shrink-0 text-t-ghost" />
        <span className="text-[12px] font-medium text-t-secondary">对比</span>
        <Select value={compareMode} onValueChange={(value) => setCompareMode(value as CompareMode)}>
          <SelectTrigger
            aria-label="选择对比范围"
            className="h-7 w-[82px] rounded-md border-0 bg-hover px-2 text-[12px] text-t-primary shadow-none focus:border-transparent focus:ring-0"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent
            position="popper"
            align="start"
            side="bottom"
            sideOffset={4}
            className="min-w-[104px] rounded-md border border-border-subtle bg-surface p-0 shadow-[0_8px_24px_rgba(15,23,42,0.14)] [&_[data-radix-select-viewport]]:h-auto"
          >
            {compareOptions.map((option) => (
              <SelectItem
                key={option.value}
                value={option.value}
                className="rounded-none px-3 py-1.5 text-[12px] text-t-secondary focus:bg-hover focus:text-t-primary data-[highlighted]:bg-hover data-[highlighted]:text-t-primary"
              >
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="min-w-0 flex-1" />
        <span className="font-mono text-[11px]">
          <span className="text-[#21835f]">+{totalAdditions}</span>
          <span className="ml-1 text-[#d05959]">-{totalDeletions}</span>
        </span>
        <button
          type="button"
          aria-label="刷新审计变更"
          title="刷新"
          onClick={() => setRefreshToken((value) => value + 1)}
          className="flex h-7 w-7 items-center justify-center rounded-md text-t-ghost transition-colors hover:bg-hover hover:text-t-primary"
        >
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
        {loading ? (
          <div className="flex h-24 items-center justify-center text-t-ghost"><Loader2 size={16} className="animate-spin" /></div>
        ) : error ? (
          <div className="px-2 py-8 text-center text-[12px] text-red-500">{error}</div>
        ) : visibleFiles.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center gap-2 text-t-ghost">
            <FileDiff size={18} strokeWidth={1.5} />
            <span className="text-[12px]">没有变更</span>
          </div>
        ) : (
          <div className="space-y-1">
            {visibleFiles.map((file) => {
              const key = fileKey(file);
              const isExpanded = expandedKey === key;
              const diff = diffs[key];
              const isLoadingDiff = loadingDiffKeys.has(key);
              const normalizedPath = file.path.replace(/\\/g, "/");
              const fileName = normalizedPath.split("/").pop() ?? normalizedPath;
              const directory = normalizedPath.slice(0, Math.max(0, normalizedPath.length - fileName.length));
              return (
                <div key={key} className="group overflow-hidden rounded-md border border-border-subtle bg-surface">
                  <div className={`flex min-h-10 items-center gap-2.5 px-3 ${isExpanded ? "bg-hover/60" : "hover:bg-hover/50"}`}>
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? "收起" : "展开"} ${file.path} 的 Diff`}
                      onClick={() => void toggleExpanded(file)}
                      onKeyDown={(event) => {
                        if (event.altKey && event.key === "Enter") {
                          event.preventDefault();
                          openSourceFile(file);
                        }
                      }}
                      className="flex min-w-0 flex-1 items-center gap-2 py-2 text-left text-[13px]"
                    >
                      <ChevronRight size={13} className={`shrink-0 text-t-ghost transition-transform ${isExpanded ? "rotate-90" : ""}`} />
                      <FileIconView path={file.path} size={14} />
                      <span className="min-w-0 flex-1 truncate text-[12px] text-t-secondary">
                        <span className="text-[13px] text-t-primary">{fileName}</span>
                        {directory && <span className="ml-1 text-[12px] text-t-faint">{directory}</span>}
                      </span>
                      <span className="shrink-0 font-mono text-[12px]"><span className="text-[#21835f]">+{file.additions}</span><span className="ml-1 text-[#d05959]">-{file.deletions}</span></span>
                    </button>
                    <button
                      type="button"
                      aria-label={`复制 ${file.path} 的 Diff`}
                      title="复制 Diff"
                      onClick={() => void copyDiff(file)}
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-t-ghost opacity-70 transition-colors hover:bg-hover hover:text-t-primary"
                    >
                      {copiedKey === key ? <Check size={13} className="text-[#21835f]" /> : <Clipboard size={13} />}
                    </button>
                    <button
                      type="button"
                      aria-label={`打开 ${file.path} 源文件`}
                      title="打开源文件"
                      onClick={() => openSourceFile(file)}
                      className="flex h-7 shrink-0 items-center justify-center gap-1 rounded-md px-1.5 text-t-ghost opacity-70 transition-colors hover:bg-hover hover:text-t-primary"
                    >
                      <ExternalLink size={13} />
                      <span className="hidden text-[12px] sm:inline">打开文件</span>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="border-t border-border-subtle bg-[#fafafa] p-2">
                      {isLoadingDiff ? (
                        <div className="flex h-20 items-center justify-center text-t-ghost"><Loader2 size={15} className="animate-spin" /></div>
                      ) : diff?.error ? (
                        <div className="px-2 py-4 text-[12px] text-red-500">{diff.error}</div>
                      ) : diff ? (
                        <CodeDiff
                          oldValue={diff.original}
                          newValue={diff.modified}
                          language={detectLanguage(file.path)}
                          fileName={file.path}
                          viewMode="unified"
                          theme="light"
                          config={codeDiffLightConfig}
                          showToolbar={false}
                          wrapLines={wordWrap}
                          highlightInlineChanges
                          style={{ height: "min(520px, calc(100vh - 80px))" }}
                        />
                      ) : null}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
