/**
 * DiffRenderer — diff 预览渲染器
 *
 * 使用 MonacoDiffViewer inline 模式展示修改前后的内容差异。
 */
import { useEffect, useMemo, useRef } from "react";
import { GitCompareArrows } from "lucide-react";
import { MonacoDiffViewer, type MonacoDiffViewerHandle } from "@ftre/editor";
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

export function DiffRenderer({ tab, active, wordWrap }: TabRendererProps) {
  const { filePath, before, after, additions, deletions, revealNonce } = tab as DiffTab;
  const displayPath = filePath.replace(/\\/g, "/");
  const diffRef = useRef<MonacoDiffViewerHandle>(null);
  const language = useMemo(() => detectLanguage(displayPath), [displayPath]);

  // tab 变为活跃时触发 layout + 重新定位到第一个 diff + 确保 minimap
  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        window.dispatchEvent(new CustomEvent("ftre:editor-layout", { detail: {} }));
        diffRef.current?.revealFirstDiff();
        diffRef.current?.ensureMinimap();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [active]);

  return (
    <div className="flex flex-col h-full min-h-0 bg-surface">
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-baseline gap-2 bg-surface overflow-hidden">
        <GitCompareArrows size={13} className="text-t-ghost shrink-0 self-center" />
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
        {additions > 0 && (
          <span className="text-[11px] font-mono text-green-600 shrink-0">+{additions}</span>
        )}
        {deletions > 0 && (
          <span className="text-[11px] font-mono text-red-500 shrink-0">-{deletions}</span>
        )}
      </div>
      <div className="flex-1 min-h-0 relative bg-surface">
        {before !== null && after !== null && (
          <MonacoDiffViewer
            ref={diffRef}
            diff={{
              id: tab.id,
              filePath,
              tabPath: filePath,
              originalContent: before,
              newContent: after,
              toolName: "edit",
              isApproximate: false,
            }}
            language={language}
            renderSideBySide={false}
            wordWrap={wordWrap}
            theme="ftre-light"
            revealNonce={revealNonce}
          />
        )}
      </div>
    </div>
  );
}
