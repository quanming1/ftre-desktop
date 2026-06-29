import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { X, ZoomIn, ZoomOut, RotateCcw, ExternalLink, Loader2, ImageOff } from "lucide-react";
import { cn } from "../utils/cn";

export interface ImageViewerProps {
  /** 图片 URL */
  src: string;
  /** 图片名称 / alt */
  alt?: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 自定义类名 */
  className?: string;
}

/**
 * 图片预览组件 —— 全屏高斯模糊遮罩，居中展示图片。
 *
 * - 点击遮罩 / 图片外空白区域 / Esc / 关闭按钮 → 关闭
 * - 滚轮缩放（0.2x ~ 10x）
 * - 缩放后可拖拽平移
 * - Ctrl/Cmd + 点击 → 在默认浏览器打开原图
 * - 底部居中操作栏（放大/缩小/重置/外部链接），右上角圆形关闭按钮
 */
export function ImageViewer({ src, alt, onClose, className }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const imgRef = useRef<HTMLImageElement>(null);
  // 用 ref 实时跟踪 scale / position，避免闭包和重渲染问题
  const scaleRef = useRef(1);
  const posRef = useRef({ x: 0, y: 0 });

  // 切换图片时重置状态
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setLoadState("loading");
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
  }, [src]);

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  // 打开时锁住 body 滚动
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // scale 变化时同步 ref；缩回 ≤1 时重置位置，避免图片偏离中心却无法拖回
  useEffect(() => {
    scaleRef.current = scale;
    if (scale <= 1 && (posRef.current.x !== 0 || posRef.current.y !== 0)) {
      posRef.current = { x: 0, y: 0 };
      setPosition({ x: 0, y: 0 });
    }
  }, [scale]);

  // 滚轮缩放
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
    // 立即移除 transition，避免拖动前几帧有动画延迟造成卡顿
    if (imgRef.current) imgRef.current.style.transition = "none";
    dragStart.current = { x: e.clientX, y: e.clientY, posX: posRef.current.x, posY: posRef.current.y };
  }, []);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || scaleRef.current <= 1) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      const newPos = { x: dragStart.current.posX + dx, y: dragStart.current.posY + dy };
      posRef.current = newPos;
      setPosition(newPos);
    },
    [isDragging],
  );

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    // 恢复 transition
    if (imgRef.current) imgRef.current.style.transition = "";
  }, []);

  // 重置
  const reset = useCallback(() => {
    scaleRef.current = 1;
    posRef.current = { x: 0, y: 0 };
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Ctrl/Cmd + 点击 → 浏览器打开
  const openExternal = useCallback(() => {
    const api = (window as any).desktop;
    if (api?.openExternal) {
      api.openExternal(src);
    } else {
      window.open(src, "_blank");
    }
  }, [src]);

  const handleImageClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        openExternal();
      }
    },
    [openExternal],
  );

  const content = (
    <div
      className={cn(
        "fixed inset-0 z-[9999] bg-black/70 backdrop-blur-md",
        "animate-in fade-in-0 duration-150",
        className,
      )}
      onClick={(e) => {
        // 点击遮罩关闭
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 右上角圆形关闭按钮 */}
      <button
        onClick={onClose}
        className="absolute top-5 right-5 z-20 w-12 h-12 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white/70 hover:text-white transition-all backdrop-blur-md border border-white/10"
        title="关闭 (Esc)"
      >
        <X size={26} />
      </button>

      {/* 图片容器 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={scale > 1 ? handleMouseDown : undefined}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={(e) => {
          // 点击图片之外的空白区域关闭
          if (e.target === e.currentTarget) onClose();
        }}
        style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
      >
        {/* Loading 状态 */}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Loader2 size={32} className="text-white/40 animate-spin" />
          </div>
        )}

        {/* Error 状态 */}
        {loadState === "error" && (
          <div className="flex flex-col items-center gap-2 text-white/40 pointer-events-none">
            <ImageOff size={48} />
            <span className="text-[13px]">图片加载失败</span>
          </div>
        )}

        {/* 图片 */}
        <img
          ref={imgRef}
          src={src}
          alt={alt || ""}
          draggable={false}
          onClick={handleImageClick}
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("error")}
          className={cn(
            "select-none max-w-[92vw] max-h-[80vh] object-contain",
            loadState !== "loaded" && "invisible",
          )}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.15s ease-out",
          }}
        />
      </div>

      {/* 底部居中操作按钮栏 */}
      {loadState === "loaded" && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-10 flex items-center gap-1.5 px-4 py-2.5 rounded-2xl bg-black/40 backdrop-blur-md border border-white/10">
          <button
            onClick={() => {
              const next = Math.min(10, scaleRef.current * 1.3);
              scaleRef.current = next;
              setScale(next);
            }}
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
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="缩小"
          >
            <ZoomOut size={24} />
          </button>
          <div className="w-px h-7 bg-white/15 mx-1" />
          <button
            onClick={reset}
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="重置"
          >
            <RotateCcw size={22} />
          </button>
          <button
            onClick={openExternal}
            className="p-3 rounded-xl text-white/70 hover:text-white hover:bg-white/15 transition-colors"
            title="在浏览器打开 (Ctrl+点击图片也可)"
          >
            <ExternalLink size={22} />
          </button>
        </div>
      )}
    </div>
  );

  // Portal 到 body，避免被父级 overflow:hidden 裁剪
  return createPortal(content, document.body);
}
