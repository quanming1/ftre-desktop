/**
 * DiffRenderer — diff 预览渲染器
 *
 * 使用 MonacoDiffViewer inline 模式展示修改前后的内容差异。
 */
import { useMemo, useState } from "react";
import { GitCompareArrows, WrapText, FileText, Columns2, Rows2 } from "lucide-react";
import { MonacoDiffViewer } from "@ftre/editor";
import { useInspector } from "@/stores/inspector";
import type { TabRendererProps } from "../tabRegistry";
import type { DiffTab } from "@/stores/inspector";

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

export function DiffRenderer({ tab, wordWrap }: TabRendererProps) {
  const { filePath, before, after, additions, deletions, revealNonce } = tab as DiffTab;
  const displayPath = filePath.replace(/\\/g, "/");
  const language = useMemo(() => detectLanguage(displayPath), [displayPath]);


  // renderSideBySide 状态：每个 diff tab 独立控制
  const [renderSideBySide, setRenderSideBySide] = useState(false);
  const toggleSideBySide = () => setRenderSideBySide((v) => !v);

  const openFilePreview = useInspector((s) => s.openFilePreview);

  // ⚠️ memoize diff 对象：切 tab 时 InspectorPanel re-render，
  // 如果 diff 对象每次新建，memo(MonacoDiffViewer) 的浅比较失效，
  // 导致内部 hooks 重跑 → @monaco-editor/react 收到新 options 引用 → wordWrap 闪烁
  const diff = useMemo(() => {
    const d = {
      id: tab.id,
      filePath,
      tabPath: filePath,
      originalContent: before,
      newContent: after,
      toolName: "edit" as const,
      isApproximate: false,
    };
    return d;
  }, [tab.id, filePath, before, after]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      <div className="px-3 py-1.5 shrink-0 flex items-center gap-2 bg-surface overflow-hidden shadow-[0_1px_3px_rgba(0,0,0,0.08)] z-[1]">
        <GitCompareArrows size={13} className="text-t-ghost shrink-0" />
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
        {additions > 0 && (
          <span className="text-[11px] font-mono text-green-600 shrink-0">+{additions}</span>
        )}
        {deletions > 0 && (
          <span className="text-[11px] font-mono text-red-500 shrink-0">-{deletions}</span>
        )}
        <div className="ml-auto flex items-center gap-1 shrink-0">
          {/* 换行切换 */}
          <button
            onClick={() => useInspector.getState().toggleWordWrap()}
            title={wordWrap ? "关闭自动换行" : "开启自动换行"}
            className={`p-1.5 rounded transition-colors ${wordWrap ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            {wordWrap ? <WrapText size={16} /> : <WrapText size={16} className="opacity-40" />}
          </button>
          {/* 拆分/统一视图切换 */}
          <button
            onClick={toggleSideBySide}
            title={renderSideBySide ? "切换为统一视图" : "切换为拆分视图"}
            className={`p-1.5 rounded transition-colors ${renderSideBySide ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            {renderSideBySide ? <Columns2 size={16} /> : <Rows2 size={16} />}
          </button>
          {/* 打开原始文件 */}
          <button
            onClick={() => {
              const absPath = filePath.replace(/\\/g, "/");
              openFilePreview(`original-${absPath}`, filePath, undefined, undefined, undefined, undefined);
            }}
            title="打开原始文件"
            className="p-1.5 rounded transition-colors text-t-faint hover:text-t-primary hover:bg-hover"
          >
            <FileText size={14} />
          </button>
        </div>
      </div>
      <div className="flex-1 min-h-0 relative bg-surface">
        {before !== null && after !== null && (
          <MonacoDiffViewer
            diff={diff}
            language={language}
            renderSideBySide={renderSideBySide}
            wordWrap={wordWrap}
            theme="ftre-light"
            revealNonce={revealNonce}
          />
        )}
      </div>
    </div>
  );
}
