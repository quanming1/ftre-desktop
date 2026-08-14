/**
 * MermaidBlock — markdown 内 ```mermaid 代码块的图表渲染
 *
 * - 按需动态 import mermaid（仅出现 mermaid 块时才加载，避免拖累首屏）
 * - securityLevel 保持默认 strict：图表内容按文本处理，不执行其中 html/脚本
 * - 渲染失败时回退显示原始代码，不阻塞页面
 * - 消息内展示：svg 去掉固有宽高、撑满容器宽度（小图不再显示得特别小）
 * - 放大查看：UI / 交互完全沿用 @ftre/ui ImageViewer（图片预览组件）——
 *   全屏高斯模糊遮罩、右上角圆形关闭、底部居中圆角操作栏（缩放/百分比/重置/源码）、
 *   滚轮缩放（0.2x ~ 10x）、放大后拖拽平移、Esc 关闭、点击空白关闭
 */
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Code2, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@ftre/ui";

let renderCounter = 0;

/** 去掉 mermaid svg 的固有 width/height/style，替换为自定义 css（撑满容器 / 铺满 viewer） */
function stripSvgSize(svgStr: string, css: string): string {
  return svgStr.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    attrs = attrs.replace(/\s+(width|height|style)="[^"]*"/gi, "");
    return `<svg${attrs} style="${css}">`;
  });
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // lightbox 状态（与 ImageViewer 同构）
  const [zoomed, setZoomed] = useState(false);
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [showCode, setShowCode] = useState(false);

  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });

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
    // svg 去 width/height 后由 max-width/max-height 适配显示（等价 img 的 object-contain）
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setShowCode(false);
    setZoomed(true);
  }, []);

  const closeLightbox = useCallback(() => setZoomed(false), []);

  // Esc 关闭
  useEffect(() => {
    if (!zoomed) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeLightbox();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [zoomed, closeLightbox]);

  // 打开时锁住 body 滚动
  useEffect(() => {
    if (!zoomed) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [zoomed]);

  // scale 变化时同步 ref；缩回 ≤1 时重置位置（与 ImageViewer 一致）
  useEffect(() => {
    scaleRef.current = scale;
    if (scale <= 1 && (posRef.current.x !== 0 || posRef.current.y !== 0)) {
      posRef.current = { x: 0, y: 0 };
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  // 滚轮缩放（0.2x ~ 10x）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 0.9;
    const next = Math.max(0.2, Math.min(10, scaleRef.current * factor));
    scaleRef.current = next;
    setScale(next);
  }, []);

  // 拖拽平移（仅在放大后）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: posRef.current.x, posY: posRef.current.y };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || scaleRef.current <= 1) return;
      const newPos = {
        x: dragStart.current.posX + (e.clientX - dragStart.current.x),
        y: dragStart.current.posY + (e.clientY - dragStart.current.y),
      };
      posRef.current = newPos;
      setPosition(newPos);
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // 重置（回到适配大小）
  const reset = useCallback(() => {
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    setScale(1);
    setPosition({ x: 0, y: 0 });
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

  // 消息内展示：撑满容器宽度（小图不再显示得特别小）
  const inlineSvg = stripSvgSize(svg, "width:100%;height:auto;");

  const lightbox = zoomed && (
    <div
      className={cn(
        "fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md",
        "animate-in fade-in-0 duration-150",
      )}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeLightbox();
      }}
    >
      {/* 右上角圆形关闭按钮（与 ImageViewer 一致） */}
      <button
        onClick={closeLightbox}
        aria-label="关闭"
        className="absolute top-5 right-5 z-20 w-12 h-12 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all backdrop-blur-md border border-white/10"
        title="关闭 (Esc)"
      >
        <X size={26} />
      </button>

      {/* 图表容器 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={scale > 1 ? handleMouseDown : undefined}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeLightbox();
        }}
        style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
      >
        {showCode ? (
          <div className="absolute inset-0 overflow-auto p-10" onClick={(e) => e.stopPropagation()}>
            <pre className="mx-auto max-w-[960px] whitespace-pre-wrap break-words rounded-lg border border-white/15 bg-black/50 p-4 font-mono text-[13px] leading-relaxed text-white/80 backdrop-blur-md">
              {code}
            </pre>
          </div>
        ) : (
          <div
            className="select-none rounded-lg bg-white shadow-2xl"
            style={{
              transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
              transition: isDragging ? "none" : "transform 0.15s ease-out",
            }}
            dangerouslySetInnerHTML={{ __html: stripSvgSize(svg, "display:block;max-width:92vw;max-height:80vh;") }}
          />
        )}
      </div>

      {/* 底部居中操作栏（与 ImageViewer 一致：缩放 / 百分比 / 重置 / 源码） */}
      {!showCode && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
          <button
            onClick={() => {
              const next = Math.min(10, scaleRef.current * 1.3);
              scaleRef.current = next;
              setScale(next);
            }}
            aria-label="放大图表"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="放大"
          >
            <ZoomIn size={24} />
          </button>
          <span className="text-[13px] text-white/50 select-none w-12 text-center tabular-nums">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={() => {
              const next = Math.max(0.2, scaleRef.current / 1.3);
              scaleRef.current = next;
              setScale(next);
            }}
            aria-label="缩小图表"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="缩小"
          >
            <ZoomOut size={24} />
          </button>
          <div className="w-px h-7 bg-white/15 mx-1" />
          <button
            onClick={reset}
            aria-label="重置缩放"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="重置"
          >
            <RotateCcw size={22} />
          </button>
          <div className="w-px h-7 bg-white/15 mx-1" />
          <button
            onClick={() => setShowCode(true)}
            aria-label="查看源码"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="查看源码"
          >
            <Code2 size={22} />
          </button>
        </div>
      )}

      {/* 源码视图的返回 / 关闭浮层 */}
      {showCode && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
          <button
            onClick={() => setShowCode(false)}
            aria-label="预览渲染结果"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="预览渲染结果"
          >
            <BookOpen size={22} />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="group relative my-2 overflow-auto rounded-md border border-border bg-white">
        <button
          type="button"
          title="放大查看"
          aria-label="放大查看"
          onClick={openLightbox}
          className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-t-ghost opacity-60 transition-opacity hover:bg-black/5 hover:text-t-primary group-hover:opacity-100 dark:hover:bg-white/10"
        >
          <Maximize2 size={13} />
        </button>
        <div className="flex min-h-8 w-full justify-center p-3" dangerouslySetInnerHTML={{ __html: inlineSvg }} />
      </div>

      {/* Portal 到 body，避免被父级 overflow:hidden 裁剪（与 ImageViewer 一致） */}
      {createPortal(lightbox, document.body)}
    </>
  );
});
