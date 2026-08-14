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
 *
 * 性能设计：
 * - mermaid.initialize 模块级单次（多块并发挂载不重复初始化、无竞态）
 * - svg 字符串改写（stripSvgSize）结果 useMemo：拖拽/缩放每帧重渲染时不重跑正则
 * - 拖拽/缩放高频路径零 React 渲染：ref 持真值 + syncDom 直改 DOM（rAF 合并），
 *   彻底避免每次 mousemove 让整个 lightbox（含几百 KB svg 容器）reconcile——拖动卡顿主因
 * - 清晰度：viewer 保持内联 SVG 矢量 + 不用常驻 will-change（会锁死合成层光栅化分辨率，
 *   transform 放大变位图拉伸而模糊）——Chrome 在 scale 变化后按新比例重光栅化，矢量保真；
 *   拖拽平移不改变采样密度，仍然走纯合成层路径
 * - 消息内图表容器 content-visibility:auto —— 视口外的 SVG 跳过渲染与布局，
 *   长消息列表滚动只渲染可见图表；放大查看打开时内联副本降为 hidden 进一步省一份
 * - 打开时两帧预热（0.1% 缩放往返）提前完成首帧光栅化，消除首次拖动一卡
 * - 渲染 id 单调递增（renderCounter），并发 render 无 id 冲突
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, Code2, Maximize2, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import { cn } from "@ftre/ui";

let renderCounter = 0;
/** mermaid 全局配置只初始化一次（initialize 幂等但重复调用有开销与竞态） */
let mermaidInitialized = false;

/** 渲染失败提示截断（mermaid 报错信息可能携带全文，超长会撑爆 UI） */
const MAX_ERROR_CHARS = 500;

/** 去掉 mermaid svg 的固有 width/height/style，替换为自定义 css（撑满容器 / 铺满 viewer） */
function stripSvgSize(svgStr: string, css: string): string {
  return svgStr.replace(/<svg\b([^>]*)>/, (_m, attrs: string) => {
    attrs = attrs.replace(/\s+(width|height|style)="[^"]*"/gi, "");
    return `<svg${attrs} style="${css}">`;
  });
}

/**
 * 从 mermaid 输出解析固有尺寸（viewBox 优先，其次 width/height 属性）。
 * svg 剥掉宽高后没有内在尺寸（不像 <img>），flex 容器里会塌缩为 0——
 * viewer 必须显式给出像素尺寸。
 */
function intrinsicSizeOf(svgStr: string): { w: number; h: number } | null {
  const vb = /viewBox="\s*([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)[\s,]+([\d.eE+-]+)/.exec(svgStr);
  if (vb) {
    const w = Number(vb[3]);
    const h = Number(vb[4]);
    if (w > 0 && h > 0) return { w, h };
  }
  const w = Number(/width="([\d.]+)px?"/.exec(svgStr)?.[1] ?? 0);
  const h = Number(/height="([\d.]+)px?"/.exec(svgStr)?.[1] ?? 0);
  return w > 0 && h > 0 ? { w, h } : null;
}

/** viewer 内图表的适配尺寸（等价 img 的 max-w + object-contain）：撑满 92vw × 80vh */
function fitBox(size: { w: number; h: number }) {
  const vw = typeof window !== "undefined" ? window.innerWidth * 0.92 : 920;
  const vh = typeof window !== "undefined" ? window.innerHeight * 0.8 : 640;
  const fit = Math.min(vw / size.w, vh / size.h);
  return { w: size.w * fit, h: size.h * fit };
}

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // 消息内图表的适配尺寸（容器宽 × 高度上限双向 contain，防止竖图撑满宽度后高度爆炸）
  const inlineWrapRef = useRef<HTMLDivElement>(null);
  const [inlineBox, setInlineBox] = useState<{ w: number; h: number } | null>(null);

  // lightbox 结构性状态（低频，React 管理）
  const [zoomed, setZoomed] = useState(false);
  const [showCode, setShowCode] = useState(false);

  // 拖拽/缩放高频状态：ref 持真值 + DOM 直改（不走 React——
  // 每次 mousemove setState 会让整个 lightbox（含几百 KB svg 容器）重渲染，拖动必卡）
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const dragging = useRef(false);
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });
  const boxRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const percentRef = useRef<HTMLSpanElement>(null);
  const rafId = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++renderCounter}`;
    setSvg("");
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInitialized) {
          mermaidInitialized = true;
          mermaid.initialize({
            startOnLoad: false,
            theme: "default",
            fontFamily: "inherit",
          });
        }
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) {
          const msg = e instanceof Error ? e.message : String(e);
          setError(msg.length > MAX_ERROR_CHARS ? `${msg.slice(0, MAX_ERROR_CHARS)}…` : msg);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  // ─── 高频路径：DOM 直改（零 React 渲染）───────────────────────────
  /** 把 ref 真值写到 DOM：transform + 百分比 + cursor。rAF 合并一帧内的多次调用 */
  const syncDom = useCallback(() => {
    if (rafId.current) return;
    rafId.current = requestAnimationFrame(() => {
      rafId.current = 0;
      const { x, y } = posRef.current;
      const s = scaleRef.current;
      if (boxRef.current) {
        boxRef.current.style.transform = `translate(${x}px, ${y}px) scale(${s})`;
      }
      if (percentRef.current) {
        percentRef.current.textContent = `${Math.round(s * 100)}%`;
      }
      if (viewportRef.current) {
        viewportRef.current.style.cursor = s > 1 ? (dragging.current ? "grabbing" : "grab") : "default";
      }
    });
  }, []);

  useEffect(() => () => { if (rafId.current) cancelAnimationFrame(rafId.current); }, []);

  /** 缩放到目标值（含 ≤1 时回中），DOM 直改 */
  const applyScale = useCallback((next: number) => {
    const clamped = Math.max(0.2, Math.min(10, next));
    if (clamped === scaleRef.current) return;
    scaleRef.current = clamped;
    if (clamped <= 1 && (posRef.current.x !== 0 || posRef.current.y !== 0)) {
      posRef.current = { x: 0, y: 0 };
    }
    syncDom();
  }, [syncDom]);

  // 滚轮缩放（0.2x ~ 10x）
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    applyScale(scaleRef.current * (e.deltaY < 0 ? 1.1 : 0.9));
  }, [applyScale]);

  // 拖拽平移（仅在放大后）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (scaleRef.current <= 1) return;
    dragging.current = true;
    dragStart.current = { x: e.clientX, y: e.clientY, posX: posRef.current.x, posY: posRef.current.y };
    if (boxRef.current) boxRef.current.style.transition = "none";
    syncDom();
  }, [syncDom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || scaleRef.current <= 1) return;
    posRef.current = {
      x: dragStart.current.posX + (e.clientX - dragStart.current.x),
      y: dragStart.current.posY + (e.clientY - dragStart.current.y),
    };
    syncDom();
  }, [syncDom]);

  const handleMouseUp = useCallback(() => {
    if (!dragging.current) return;
    dragging.current = false;
    if (boxRef.current) boxRef.current.style.transition = "";
    syncDom();
  }, [syncDom]);

  const openLightbox = useCallback(() => {
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    dragging.current = false;
    setShowCode(false);
    setZoomed(true);
    // 挂载后预热：先同步初值，再两帧内做一次 0.1% 缩放往返，
    // 强制浏览器提前完成合成层光栅化/纹理上传——消除首次拖动的一卡。
    // 归位前校验 scaleRef 仍是自己写的 1.001：期间用户若已缩放则不打扰。
    requestAnimationFrame(() => {
      syncDom();
      if (boxRef.current) boxRef.current.style.transition = "none";
      scaleRef.current = 1.001;
      syncDom();
      requestAnimationFrame(() => {
        if (scaleRef.current === 1.001) {
          scaleRef.current = 1;
          syncDom();
        }
        if (boxRef.current) boxRef.current.style.transition = "";
      });
    });
  }, [syncDom]);

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

  // 重置（回到适配大小）
  const reset = useCallback(() => {
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    syncDom();
  }, [syncDom]);

  // svg 改写结果缓存：拖拽/缩放每帧重渲染时不重跑全文正则（svg 可达几百 KB）。
  // 必须位于所有条件 return 之前（Hooks 规则）。
  const inlineSvg = useMemo(
    () => stripSvgSize(svg, "width:100%;height:100%;display:block;"),
    [svg],
  );
  const viewerSvg = useMemo(
    () => stripSvgSize(svg, "width:100%;height:100%;display:block;"),
    [svg],
  );

  // 图表固有尺寸（viewBox）——inline 与 viewer 适配计算的依据
  const intrinsic = useMemo(
    () => (svg ? intrinsicSizeOf(svg) : null),
    [svg],
  );

  // 消息内适配：容器宽 × 高度上限双向 contain（竖图按高约束，横图按宽约束）。
  // svg 无内在尺寸，必须显式像素——不给宽会塌缩为 0，只给 width:100% 竖图会高度爆炸。
  useLayoutEffect(() => {
    const wrap = inlineWrapRef.current;
    if (!wrap || !intrinsic) return;
    const compute = () => {
      const availW = wrap.clientWidth || 720;
      const availH = Math.max(240, Math.min(window.innerHeight * 0.6, 640));
      const fit = Math.min(availW / intrinsic.w, availH / intrinsic.h);
      setInlineBox({ w: Math.round(intrinsic.w * fit), h: Math.round(intrinsic.h * fit) });
    };
    compute();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(compute);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [intrinsic]);

  // viewer 图表容器显式像素尺寸（svg 无内在尺寸，必须由容器给定）
  const viewerBox = intrinsic;

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
        ref={viewportRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={(e) => {
          if (e.target === e.currentTarget) closeLightbox();
        }}
        style={{ cursor: "default" }}
      >
        {showCode ? (
          <div className="absolute inset-0 overflow-auto p-10" onClick={(e) => e.stopPropagation()}>
            <pre className="mx-auto max-w-[960px] whitespace-pre-wrap break-words rounded-lg border border-white/15 bg-black/50 p-4 font-mono text-[13px] leading-relaxed text-white/80 backdrop-blur-md">
              {code}
            </pre>
          </div>
        ) : (
          <div
            ref={boxRef}
            data-testid="mmd-viewer-box"
            className="select-none overflow-hidden rounded-lg bg-white shadow-2xl"
            style={{
              // 显式像素尺寸：svg 剥掉宽高后无内在尺寸，不给定会塌缩为 0（图表看不见）；
              // transform/cursor 由 syncDom 直改（拖拽缩放零 React 渲染），初值即 100% 居中。
              // 刻意不加 will-change：常驻会固定合成层光栅化分辨率，transform 放大是位图拉伸（糊）；
              // 不加时 Chrome 会在 scale 变化后按新比例重新光栅化 SVG——矢量保真。
              width: viewerBox ? `${fitBox(viewerBox).w}px` : "min(92vw, 900px)",
              height: viewerBox ? `${fitBox(viewerBox).h}px` : "auto",
              transform: "translate(0px, 0px) scale(1)",
              transition: "transform 0.15s ease-out",
            }}
            dangerouslySetInnerHTML={{ __html: viewerSvg }}
          />
        )}
      </div>

      {/* 底部居中操作栏（与 ImageViewer 一致：缩放 / 百分比 / 重置 / 源码） */}
      {!showCode && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
          <button
            onClick={() => applyScale(scaleRef.current * 1.3)}
            aria-label="放大图表"
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="放大"
          >
            <ZoomIn size={24} />
          </button>
          <span
            ref={percentRef}
            className="text-[13px] text-white/50 select-none w-12 text-center tabular-nums"
          >
            100%
          </span>
          <button
            onClick={() => applyScale(scaleRef.current / 1.3)}
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
      <div
        className="group relative my-2 rounded-md border border-border bg-white"
        style={{
          // 视口外跳过渲染与布局（长消息列表滚动只渲染可见图表）；
          // 放大查看打开时内联副本降为 hidden，省一份常驻渲染
          contentVisibility: zoomed ? "hidden" : "auto",
          containIntrinsicSize: inlineBox ? `auto ${inlineBox.h + 24}px` : "auto 260px",
        }}
      >
        <button
          type="button"
          title="放大查看"
          aria-label="放大查看"
          onClick={openLightbox}
          className="absolute right-1.5 top-1.5 z-10 rounded p-1 text-t-ghost opacity-60 transition-opacity hover:bg-black/5 hover:text-t-primary group-hover:opacity-100 dark:hover:bg-white/10"
        >
          <Maximize2 size={13} />
        </button>
        {/* 满宽 wrapper 供测宽；内层 box 按容器宽 × 高度上限双向 contain（竖图不超高） */}
        <div ref={inlineWrapRef} className="flex w-full justify-center overflow-hidden p-3">
          <div
            data-testid="mmd-inline-box"
            className="min-h-8"
            style={
              inlineBox
                ? { width: `${inlineBox.w}px`, height: `${inlineBox.h}px` }
                : { width: "100%", minHeight: 32 }
            }
            dangerouslySetInnerHTML={{ __html: inlineSvg }}
          />
        </div>
      </div>

      {/* Portal 到 body，避免被父级 overflow:hidden 裁剪（与 ImageViewer 一致） */}
      {createPortal(lightbox, document.body)}
    </>
  );
});
