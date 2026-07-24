/**
 * DiffRenderer — diff 预览渲染器
 *
 * 使用 @jiang_quan_ming/react-code-diff 的 CodeDiff 组件展示修改前后的内容差异。
 * 支持 split / unified 视图切换、自动换行、inline diff 高亮。
 * 使用 renderToolbar 自定义工具栏：变更导航 + 搜索 + 只看变更 + 视图切换。
 */
import { useMemo, useCallback } from "react";
import { GitCompareArrows, WrapText, FileText, Columns2, Rows2, ChevronUp, ChevronDown, Search, Eye } from "lucide-react";
import { CodeDiff } from "@jiang_quan_ming/react-code-diff";
import type { ToolbarRenderProps } from "@jiang_quan_ming/react-code-diff";
import { useInspector } from "@/stores/inspector";
import type { TabRendererProps } from "../tabRegistry";
import type { DiffTab } from "@/stores/inspector";

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

export function DiffRenderer({ tab, wordWrap }: TabRendererProps) {
  const { filePath, before, after, additions, deletions } = tab as DiffTab;
  const displayPath = filePath.replace(/\\/g, "/");
  const language = useMemo(() => detectLanguage(displayPath), [displayPath]);

  const renderSideBySide = useInspector((s) => s.renderSideBySide);
  const toggleSideBySide = useInspector((s) => s.toggleSideBySide);
  const showDiffOnly = useInspector((s) => s.showDiffOnly);
  const toggleDiffOnly = useInspector((s) => s.toggleDiffOnly);
  const toggleWordWrap = useInspector((s) => s.toggleWordWrap);

  const openFilePreview = useInspector((s) => s.openFilePreview);

  const renderToolbar = useCallback((props: ToolbarRenderProps) => {
    return (
      <div className="px-2.5 py-1 shrink-0 flex items-center gap-1.5 bg-surface overflow-hidden rounded-md border border-border" style={{ height: "30px" }}>
        <GitCompareArrows size={12} className="text-t-ghost shrink-0" />
        <span className="text-[11px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath.split("/").pop()}
        </span>
        {additions > 0 && (
          <span className="text-[10px] font-mono text-green-600 shrink-0">+{additions}</span>
        )}
        {deletions > 0 && (
          <span className="text-[10px] font-mono text-red-500 shrink-0">-{deletions}</span>
        )}
        <div className="ml-auto flex items-center gap-0.5 shrink-0">
          {/* 上一个变更 */}
          {props.changeCount > 0 && (
            <>
              <button
                onClick={() => props.onNavigateChange("prev")}
                title="上一个变更"
                className="p-1 rounded transition-colors text-t-faint hover:text-t-primary hover:bg-hover"
              >
                <ChevronUp size={13} />
              </button>
              <span className="text-[10px] text-t-ghost px-0.5">{props.changeCount}</span>
              <button
                onClick={() => props.onNavigateChange("next")}
                title="下一个变更"
                className="p-1 rounded transition-colors text-t-faint hover:text-t-primary hover:bg-hover"
              >
                <ChevronDown size={13} />
              </button>
            </>
          )}
          {/* 搜索 */}
          <button
            onClick={props.onToggleSearch}
            title="搜索"
            className={`p-1 rounded transition-colors ${props.searchOpen ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            <Search size={13} />
          </button>
          {/* 只看变更行 */}
          <button
            onClick={toggleDiffOnly}
            title={showDiffOnly ? "显示全部行" : "只看变更行"}
            className={`p-1 rounded transition-colors ${showDiffOnly ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            <Eye size={13} />
          </button>
          {/* 换行切换 */}
          <button
            onClick={toggleWordWrap}
            title={wordWrap ? "关闭自动换行" : "开启自动换行"}
            className={`p-1 rounded transition-colors ${wordWrap ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            {wordWrap ? <WrapText size={14} /> : <WrapText size={14} className="opacity-40" />}
          </button>
          {/* 拆分/统一视图切换 */}
          <button
            onClick={toggleSideBySide}
            title={renderSideBySide ? "切换为统一视图" : "切换为拆分视图"}
            className={`p-1 rounded transition-colors ${renderSideBySide ? "text-t-primary bg-hover" : "text-t-faint hover:text-t-primary hover:bg-hover"}`}
          >
            {renderSideBySide ? <Columns2 size={14} /> : <Rows2 size={14} />}
          </button>
          {/* 打开原始文件 */}
          <button
            onClick={() => {
              const absPath = filePath.replace(/\\/g, "/");
              openFilePreview(`original-${absPath}`, filePath, undefined, undefined, undefined, undefined);
            }}
            title="打开原始文件"
            className="p-1 rounded transition-colors text-t-faint hover:text-t-primary hover:bg-hover"
          >
            <FileText size={13} />
          </button>
        </div>
      </div>
    );
  }, [filePath, displayPath, additions, deletions, wordWrap, renderSideBySide, showDiffOnly, openFilePreview, toggleSideBySide, toggleDiffOnly, toggleWordWrap]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface p-2 gap-2">
      {before !== null && after !== null && (
        <CodeDiff
          oldValue={before}
          newValue={after}
          language={language}
          fileName={displayPath}
          viewMode={renderSideBySide ? "split" : "unified"}
          theme="light"
          showToolbar={true}
          renderToolbar={renderToolbar}
          showDiffOnly={showDiffOnly}
          wrapLines={wordWrap}
          highlightInlineChanges
          style={{ height: "100%" }}
        />
      )}
    </div>
  );
}
