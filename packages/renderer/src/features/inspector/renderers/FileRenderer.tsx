/**
 * FileRenderer — 文件预览渲染器
 *
 * 优先使用 content 快照（来自 read 工具 metadata），
 * 无快照时从磁盘读取。filePreviewCache 缓存已加载文件，切回时秒切。
 * 轮询校验 mtime，文件被外部修改时自动清除缓存并重载。
 * 文件加载完成后，如果有 revealLine 则自动跳转并选中。
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, WrapText } from "lucide-react";
import { CodeEditorWidget, type CodeEditorFile } from "@ftre/editor";
import { useInspector } from "@/stores/inspector";
import { filePreviewCache } from "../filePreviewCache";
import type { TabRendererProps } from "../tabRegistry";
import type { FileTab } from "@/stores/inspector";

function detectLanguage(filePath: string): string {
  const ext = filePath.match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
    py: "python", json: "json", md: "markdown", go: "go", rs: "rust",
    java: "java", c: "c", cpp: "cpp", sh: "shell", yml: "yaml", yaml: "yaml",
    html: "html", css: "css", xml: "xml", sql: "sql", toml: "ini",
  };
  return map[ext] ?? "plaintext";
}

export function FileRenderer({ tab, wordWrap }: TabRendererProps) {
  const { filePath, content, revealLine, revealEndLine, revealNonce } = tab as FileTab;

  // 有 content 快照时直接使用，不走磁盘读取和缓存
  const snapshotFile = useMemo<CodeEditorFile | null>(() => {
    if (content == null) return null;
    const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
    return {
      path: filePath,
      name,
      language: detectLanguage(filePath),
      content,
      loaded: true,
    };
  }, [content, filePath]);

  // mtime 失效后，放弃 snapshot 从磁盘重载（解决 read 快照过期问题）
  const [snapshotInvalidated, setSnapshotInvalidated] = useState(false);
  const effectiveSnapshot = snapshotInvalidated ? null : snapshotFile;

  // 非 snapshot 场景下，invalidation 后 effectiveSnapshot 不变（null→null），
  // load effect 不会重跑。用 reloadNonce 强制重跑。
  const [reloadNonce, setReloadNonce] = useState(0);

  const [file, setFile] = useState<CodeEditorFile | null>(() => {
    if (effectiveSnapshot) return effectiveSnapshot;
    const cached = filePreviewCache.get(filePath);
    if (cached) {
      const name = filePath.replace(/\\/g, "/").split("/").pop() ?? filePath;
      return { path: filePath, name, language: cached.language, content: cached.content, loaded: true };
    }
    return null;
  });
  const [loading, setLoading] = useState(
    effectiveSnapshot == null && !filePreviewCache.has(filePath),
  );
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async (path: string) => {
    // 先查缓存，但校验 mtime 防止脏读
    const cached = filePreviewCache.get(path);
    if (cached) {
      try {
        const stat = await window.desktop.fs.stat(path);
        if (stat.mtime !== null && stat.mtime === cached.mtime) {
          // mtime 一致，使用缓存
          const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
          setFile({ path, name, language: cached.language, content: cached.content, loaded: true });
          setLoading(false);
          setError(null);
          return;
        }
        // mtime 不一致，清除缓存继续从磁盘读取
        filePreviewCache.delete(path);
      } catch {
        filePreviewCache.delete(path);
      }
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.desktop.fs.readFile(path);
      if (result.error) {
        setError(result.error);
      } else {
        const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
        const lang = result.language || detectLanguage(path);
        // 读取 mtime 存入缓存
        const stat = await window.desktop.fs.stat(path);
        filePreviewCache.set(path, {
          content: result.content ?? "",
          language: lang,
          mtime: stat.mtime ?? 0,
        });
        setFile({ path, name, language: lang, content: result.content ?? "", loaded: true });
      }
    } catch (e) {
      setError(`无法读取文件: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载文件：effectiveSnapshot 优先，否则从磁盘读
  useEffect(() => {
    if (effectiveSnapshot) {
      setFile(effectiveSnapshot);
      setLoading(false);
      setError(null);
    } else {
      loadFile(filePath);
    }
  }, [filePath, loadFile, effectiveSnapshot, revealNonce, reloadNonce]);

  // snapshot 文件注册到 filePreviewCache，使 mtime 轮询能检测到外部修改
  // 没有 this，snapshot 文件不在缓存中，轮询不会监控它，onInvalidate 永远不触发
  useEffect(() => {
    if (!effectiveSnapshot) return;
    let cancelled = false;
    (async () => {
      try {
        const stat = await window.desktop.fs.stat(filePath);
        if (!cancelled && !filePreviewCache.has(filePath)) {
          filePreviewCache.set(filePath, {
            content: effectiveSnapshot.content,
            language: effectiveSnapshot.language,
            mtime: stat.mtime ?? 0,
          });
        }
      } catch {
        // stat 失败（文件不存在等），无法监控
      }
    })();
    return () => { cancelled = true; };
  }, [effectiveSnapshot, filePath]);

  // 监听缓存失效（mtime 变化），触发重载
  useEffect(() => {
    const unsubscribe = filePreviewCache.onInvalidate((changedPath) => {
      if (changedPath === filePath) {
        // 文件被外部修改（含 edit 工具），放弃 snapshot 并强制从磁盘重载
        setSnapshotInvalidated(true);
        setReloadNonce((n) => n + 1);
      }
    });
    return unsubscribe;
  }, [filePath]);

  // filePath 变化时重置 invalidation 标记
  useEffect(() => {
    setSnapshotInvalidated(false);
  }, [filePath]);

  // 文件加载完成后，如果有 revealLine 则跳转并选中
  useEffect(() => {
    if (!file || !revealLine || revealLine <= 0) return;
    const timer = setTimeout(() => {
      window.dispatchEvent(
        new CustomEvent("ftre:goto-line", {
          detail: {
            filePath,
            line: revealLine,
            col: 1,
            endLine: revealEndLine && revealEndLine > 0 ? revealEndLine : undefined,
          },
        }),
      );
    }, 100);
    return () => clearTimeout(timer);
  }, [file, filePath, revealLine, revealEndLine, revealNonce]);

  const displayPath = filePath.replace(/\\/g, "/");

  return (
    <div className="flex flex-col h-full bg-surface relative">
      {/* 文件信息 */}
      <div className="px-3 py-1.5 shrink-0 flex items-center gap-2 bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] z-[1]">
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* 换行切换 */}
          <button
            onClick={() => useInspector.getState().toggleWordWrap()}
            title={wordWrap ? "关闭自动换行" : "开启自动换行"}
            className={`p-1.5 rounded transition-colors ${wordWrap ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            {wordWrap ? <WrapText size={16} /> : <WrapText size={16} className="opacity-40" />}
          </button>
        </div>
      </div>

      {/* Monaco 编辑器 */}
      <div className="flex-1 overflow-hidden bg-surface">
        {file ? (
          <CodeEditorWidget
            file={file}
            minimapEnabled
            readOnly
            renderLineHighlight="none"
            theme="ftre-light"
            wordWrap={wordWrap}
          />
        ) : (
          <div className="h-full flex items-center justify-center">
            {loading && <Loader2 size={16} className="animate-spin text-t-ghost" />}
          </div>
        )}
      </div>

      {/* 错误遮罩 */}
      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-surface/80 z-10 p-4">
          <p className="text-sm text-red-500">{error}</p>
        </div>
      )}
    </div>
  );
}
