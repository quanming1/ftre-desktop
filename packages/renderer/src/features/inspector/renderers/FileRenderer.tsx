/**
 * FileRenderer — 文件预览渲染器
 *
 * 优先使用 content 快照（来自 read 工具 metadata），
 * 无快照时从磁盘读取。fileCache 缓存已加载文件，切回时秒切。
 * 文件加载完成后，如果有 revealLine 则自动跳转并选中。
 */
import { useState, useEffect, useCallback, useMemo } from "react";
import { Loader2, WrapText } from "lucide-react";
import { CodeEditorWidget, type CodeEditorFile } from "@ftre/editor";
import { useInspector } from "@/stores/inspector";
import type { TabRendererProps } from "../tabRegistry";
import type { FileTab } from "@/stores/inspector";

/** path → CodeEditorFile 内存缓存，切回已加载的 tab 秒切 */
const fileCache = new Map<string, CodeEditorFile>();

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

  const [file, setFile] = useState<CodeEditorFile | null>(
    () => snapshotFile ?? fileCache.get(filePath) ?? null,
  );
  const [loading, setLoading] = useState(
    snapshotFile == null && !fileCache.has(filePath),
  );
  const [error, setError] = useState<string | null>(null);

  const loadFile = useCallback(async (path: string) => {
    const cached = fileCache.get(path);
    if (cached) {
      setFile(cached);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await window.desktop.fs.readFile(path);
      if (result.error) {
        setError(result.error);
      } else {
        const name = path.replace(/\\/g, "/").split("/").pop() ?? path;
        const f: CodeEditorFile = {
          path,
          name,
          language: result.language || "plaintext",
          content: result.content ?? "",
          loaded: true,
        };
        fileCache.set(path, f);
        setFile(f);
      }
    } catch (e) {
      setError(`无法读取文件: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (snapshotFile) {
      setFile(snapshotFile);
      setLoading(false);
      setError(null);
    } else {
      loadFile(filePath);
    }
  }, [filePath, loadFile, snapshotFile]);

  // 文件加载完成后，如果有 revealLine 则跳转并选中；revealNonce 变化时也重新定位
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
