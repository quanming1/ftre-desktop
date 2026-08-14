/**
 * MermaidBlock — markdown 内 ```mermaid 代码块的图表渲染
 *
 * - 按需动态 import mermaid（仅出现 mermaid 块时才加载，避免拖累首屏）
 * - securityLevel 保持默认 strict：图表内容按文本处理，不执行其中 html/脚本
 * - 渲染失败时回退显示原始代码，不阻塞页面
 * - 图表右上角放大按钮 → 全屏 overlay：细工具条（源码/渲染切换 + 缩放 + 关闭），图表可缩放
 */
import { memo, useCallback, useEffect, useState } from "react";
import { BookOpen, Code2, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";

let renderCounter = 0;

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.25;

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomed, setZoomed] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++renderCounter}`;
    setSvg("");
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  const openLightbox = useCallback(() => {
    setZoomed(true);
    setZoom(1);
    setShowCode(false);
  }, []);

  const closeLightbox = useCallback(() => setZoomed(false), []);

  const zoomIn = useCallback(() => setZoom((z) => Math.min(MAX_ZOOM, z + ZOOM_STEP)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(MIN_ZOOM, z - ZOOM_STEP)), []);
  const resetZoom = useCallback(() => setZoom(1), []);

  if (error) {
    return (
      <div className="my-2 rounded-md border border-border bg-red-50 p-3 dark:bg-red-950/20">
        <div className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">Mermaid 渲染失败</div>
        <pre className="overflow-auto text-[12px] leading-5 whitespace-pre-wrap text-t-secondary">{code}</pre>
      </div>
    );
  }

  if (loading) {
    return <div className="my-2 py-4 text-center text-xs text-t-ghost">图表渲染中…</div>;
  }

  return (
    <>
      <div className="group relative my-2 overflow-auto rounded-md border border-border bg-white">
        {/* 放大按钮：图表右上角，hover 明显 */}
        <button
          type="button"
          title="放大"
          onClick={openLightbox}
          className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-t-ghost opacity-60 transition-opacity hover:bg-black/5 hover:text-t-primary group-hover:opacity-100 dark:hover:bg-white/10"
        >
          <Maximize2 size={13} />
        </button>
        <div className="flex min-h-8 justify-center p-3" dangerouslySetInnerHTML={{ __html: svg }} />
      </div>

      {/* 全屏放大展示（轻量 overlay：细工具条 + 缩放 + 源码切换） */}
      {zoomed && (
        <div
          className="fixed inset-0 z-[300] flex flex-col bg-black/85"
          onClick={closeLightbox}
        >
          {/* 细工具条 */}
          <div
            className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 bg-black/50 px-3"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="truncate text-[12px] font-mono text-white/70">Mermaid 图表</span>
            <span className="flex-1" />
            {/* 源码 / 渲染切换 */}
            <button
              type="button"
              title={showCode ? "预览渲染结果" : "查看源码"}
              aria-label={showCode ? "预览渲染结果" : "查看源码"}
              onClick={() => setShowCode((v) => !v)}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {showCode ? <BookOpen size={15} /> : <Code2 size={15} />}
            </button>
            {/* 缩放控制 */}
            <button
              type="button"
              title="缩小"
              aria-label="缩小图表"
              onClick={zoomOut}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ZoomOut size={15} />
            </button>
            <span className="w-10 text-center font-mono text-[11px] text-white/50">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              title="放大"
              aria-label="放大图表"
              onClick={zoomIn}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <ZoomIn size={15} />
            </button>
            <button
              type="button"
              title="重置缩放"
              aria-label="重置缩放"
              onClick={resetZoom}
              disabled={zoom === 1}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
            >
              <RotateCcw size={14} />
            </button>
            <span className="mx-1 h-5 w-px bg-white/15" />
            <button
              type="button"
              title="关闭"
              aria-label="关闭"
              onClick={closeLightbox}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X size={16} />
            </button>
          </div>

          {/* 主体：渲染图（可缩放，放大后可滚动）或源码 */}
          <div
            className="min-h-0 flex-1 overflow-auto p-6"
            onClick={(e) => e.stopPropagation()}
          >
            {showCode ? (
              <pre className="mx-auto max-w-[960px] whitespace-pre-wrap break-words rounded-md border border-white/15 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-white/80">
                {code}
              </pre>
            ) : (
              <div
                className="flex min-h-full w-fit min-w-full items-center justify-center"
                style={{ transform: `scale(${zoom})`, transformOrigin: "center center" }}
              >
                <div className="rounded-md bg-white p-3 shadow-xl" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
});
