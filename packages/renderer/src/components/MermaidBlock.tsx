/**
 * MermaidBlock — markdown 内 ```mermaid 代码块的图表渲染
 *
 * - 按需动态 import mermaid（仅出现 mermaid 块时才加载，避免拖累首屏）
 * - securityLevel 保持默认 strict：图表内容按文本处理，不执行其中 html/脚本
 * - 渲染失败时回退显示原始代码，不阻塞页面
 * - 放大查看沿用图片查看器交互（lightbox）：默认 fit 适应视口、滚轮缩放（光标为中心）、
 *   拖拽平移、双击复位；工具条提供 缩放按钮 / 百分比 / 适应窗口 / 源码切换 / 关闭
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { BookOpen, Code2, Maximize2, X, ZoomIn, ZoomOut } from "lucide-react";

let renderCounter = 0;

const MIN_SCALE = 0.1;
const MAX_SCALE = 8;
const VIEWPORT_PADDING = 48;

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [zoomed, setZoomed] = useState(false);

  // lightbox 查看器状态：scale + 平移（以视口中心为原点）
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [showCode, setShowCode] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // svg 固有尺寸（mermaid 输出的 viewBox / width）
  const intrinsicSize = useRef<{ w: number; h: number } | null>(null);
  const dragState = useRef<{ startX: number; startY: number; ox: number; oy: number } | null>(null);
  // 用户是否手动缩放/拖动过（resize 时未动过才重新 fit）
  const userTouched = useRef(false);

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

  /** 读取挂载后 svg 的固有尺寸（viewBox 优先，其次 width/height 属性） */
  const measureIntrinsic = useCallback(() => {
    const el = contentRef.current?.querySelector("svg");
    if (!el) return null;
    const vb = el.getAttribute("viewBox");
    if (vb) {
      const parts = vb.split(/[\s,]+/).map(Number);
      if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
        return { w: parts[2], h: parts[3] };
      }
    }
    const w = parseFloat(el.getAttribute("width") || "");
    const h = parseFloat(el.getAttribute("height") || "");
    if (w > 0 && h > 0) return { w, h };
    return null;
  }, []);

  /** 适应视口：scale = min(可用宽/固有宽, 可用高/固有高)，小图放大撑满、大图缩小放下 */
  const fitToViewport = useCallback(() => {
    const viewport = viewportRef.current;
    const size = intrinsicSize.current ?? measureIntrinsic();
    if (size) intrinsicSize.current = size;
    if (!viewport || !size) {
      setScale(1);
      setOffset({ x: 0, y: 0 });
      return;
    }
    const vw = viewport.clientWidth - VIEWPORT_PADDING;
    const vh = viewport.clientHeight - VIEWPORT_PADDING;
    if (vw <= 0 || vh <= 0) return;
    const fit = Math.min(vw / size.w, vh / size.h);
    setScale(Math.min(MAX_SCALE, Math.max(MIN_SCALE, fit)));
    setOffset({ x: 0, y: 0 });
  }, [measureIntrinsic]);

  const openLightbox = useCallback(() => {
    intrinsicSize.current = null;
    userTouched.current = false;
    setZoomed(true);
    setShowCode(false);
    // svg 挂载后再 fit（等一帧）
    requestAnimationFrame(() => fitToViewport());
  }, [fitToViewport]);

  const closeLightbox = useCallback(() => setZoomed(false), []);

  const zoomBy = useCallback(
    (factor: number, cx?: number, cy?: number) => {
      setScale((prev) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor));
        if (next === prev) return prev;
        const ratio = next / prev;
        // 光标为中心缩放：保持内容坐标 (p - center - t)/prev 不动
        if (cx !== undefined && cy !== undefined) {
          setOffset((o) => ({
            x: cx - (cx - o.x) * ratio,
            y: cy - (cy - o.y) * ratio,
          }));
        } else {
          setOffset((o) => ({
            x: (o.x) * ratio,
            y: (o.y) * ratio,
          }));
        }
        return next;
      });
      userTouched.current = true;
    },
    [],
  );

  const zoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(0.8), [zoomBy]);

  /** 滚轮缩放：非 passive 监听才能 preventDefault（React onWheel 是 passive） */
  useEffect(() => {
    if (!zoomed || showCode) return;
    const viewport = viewportRef.current;
    if (!viewport) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = viewport.getBoundingClientRect();
      const cx = e.clientX - rect.left - rect.width / 2;
      const cy = e.clientY - rect.top - rect.height / 2;
      zoomBy(e.deltaY < 0 ? 1.15 : 1 / 1.15, cx, cy);
    };
    viewport.addEventListener("wheel", onWheel, { passive: false });
    return () => viewport.removeEventListener("wheel", onWheel);
  }, [zoomed, showCode, zoomBy]);

  /** 窗口尺寸变化：用户没手动动过则重新 fit */
  useEffect(() => {
    if (!zoomed || showCode) return;
    const onResize = () => {
      if (!userTouched.current) fitToViewport();
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [zoomed, showCode, fitToViewport]);

  /** 拖拽平移（放大后拖动查看） */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (showCode) return;
      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        ox: offset.x,
        oy: offset.y,
      };
      (e.target as Element).setPointerCapture?.(e.pointerId);
      userTouched.current = true;
    },
    [offset.x, offset.y, showCode],
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const drag = dragState.current;
    if (!drag) return;
    setOffset({ x: drag.ox + (e.clientX - drag.startX), y: drag.oy + (e.clientY - drag.startY) });
  }, []);

  const onPointerUp = useCallback(() => {
    dragState.current = null;
  }, []);

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

      {/* 全屏查看器（图片查看器交互：fit 适应 / 滚轮缩放 / 拖拽 / 双击复位） */}
      {zoomed && (
        <div className="fixed inset-0 z-[300] flex flex-col bg-black/90">
          {/* 细工具条 */}
          <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/10 bg-black/60 px-3">
            <span className="truncate text-[12px] font-mono text-white/70">Mermaid 图表</span>
            <span className="flex-1" />
            {!showCode && (
              <>
                <button
                  type="button"
                  title="缩小"
                  aria-label="缩小图表"
                  onClick={zoomOut}
                  className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <ZoomOut size={15} />
                </button>
                <span className="w-11 text-center font-mono text-[11px] text-white/60">
                  {Math.round(scale * 100)}%
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
                  title="适应窗口"
                  aria-label="适应窗口"
                  onClick={() => {
                    userTouched.current = false;
                    fitToViewport();
                  }}
                  className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <Maximize2 size={14} />
                </button>
              </>
            )}
            <button
              type="button"
              title={showCode ? "预览渲染结果" : "查看源码"}
              aria-label={showCode ? "预览渲染结果" : "查看源码"}
              onClick={() => setShowCode((v) => !v)}
              className="rounded p-1.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {showCode ? <BookOpen size={15} /> : <Code2 size={15} />}
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

          {/* 主体：源码 或 可缩放图表 */}
          {showCode ? (
            <div className="min-h-0 flex-1 overflow-auto p-6">
              <pre className="mx-auto max-w-[960px] whitespace-pre-wrap break-words rounded-md border border-white/15 bg-black/40 p-4 font-mono text-[13px] leading-relaxed text-white/80">
                {code}
              </pre>
            </div>
          ) : (
            <div
              ref={viewportRef}
              className={`relative min-h-0 flex-1 select-none overflow-hidden ${
                scale > 1 ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in"
              }`}
              onDoubleClick={() => {
                userTouched.current = false;
                fitToViewport();
              }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              <div
                ref={contentRef}
                className="absolute left-1/2 top-1/2"
                style={{
                  transform: `translate(-50%, -50%) translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                }}
              >
                <div className="bg-white shadow-2xl" dangerouslySetInnerHTML={{ __html: svg }} />
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
});
