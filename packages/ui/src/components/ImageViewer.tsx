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
 * 图片预览组件 —— 全屏遮罩，居中展示图片。
 *
 * - 点击遮罩 / Esc / 关闭按钮 → 关闭
 * - 滚轮缩放（0.2x ~ 10x）
 * - 缩放后可拖拽平移
 * - Ctrl/Cmd + 点击 → 在默认浏览器打开原图
 * - 底部显示缩放百分比
 */
export function ImageViewer({ src, alt, onClose, className }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [loadState, setLoadState] = useState<"loading" | "loaded" | "error">("loading");
  const dragStart = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  // 切换图片时重置状态
  useEffect(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setLoadState("loading");
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

  // 滚轮缩放
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setScale((prev) => {
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      return Math.max(0.2, Math.min(10, prev * factor));
    });
  }, []);

  // 拖拽平移（仅在放大后）
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // 使用 ref 获取实时 scale/position，避免闭包问题
    setIsDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY, posX: position.x, posY: position.y };
  }, [position.x, position.y]);

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging || scale <= 1) return;
      const dx = e.clientX - dragStart.current.x;
      const dy = e.clientY - dragStart.current.y;
      setPosition({ x: dragStart.current.posX + dx, y: dragStart.current.posY + dy });
    },
    [isDragging, scale],
  );

  const handleMouseUp = useCallback(() => setIsDragging(false), []);

  // 重置
  const reset = useCallback(() => {
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
        "fixed inset-0 z-[9999] bg-black/80 backdrop-blur-sm",
        "animate-in fade-in-0 duration-150",
        className,
      )}
      onClick={(e) => {
        // 点击遮罩关闭（但点击图片/工具栏不关闭）
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* 顶部工具栏 */}
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3 z-10">
        <span className="text-[13px] text-white/60 truncate max-w-[60%] select-none">
          {alt || "图片预览"}
        </span>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setScale((s) => Math.min(10, s * 1.3))}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="放大"
          >
            <ZoomIn size={18} />
          </button>
          <button
            onClick={() => setScale((s) => Math.max(0.2, s / 1.3))}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="缩小"
          >
            <ZoomOut size={18} />
          </button>
          {(scale !== 1 || position.x !== 0 || position.y !== 0) && (
            <button
              onClick={reset}
              className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
              title="重置"
            >
              <RotateCcw size={16} />
            </button>
          )}
          <button
            onClick={openExternal}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="在浏览器打开 (Ctrl+点击图片也可)"
          >
            <ExternalLink size={16} />
          </button>
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="关闭 (Esc)"
          >
            <X size={20} />
          </button>
        </div>
      </div>

      {/* 图片容器 */}
      <div
        className="absolute inset-0 flex items-center justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={scale > 1 ? handleMouseDown : undefined}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: scale > 1 ? (isDragging ? "grabbing" : "grab") : "default" }}
      >
        {/* Loading 状态 */}
        {loadState === "loading" && (
          <div className="absolute inset-0 flex items-center justify-center">
            <Loader2 size={32} className="text-white/40 animate-spin" />
          </div>
        )}

        {/* Error 状态 */}
        {loadState === "error" && (
          <div className="flex flex-col items-center gap-2 text-white/40">
            <ImageOff size={48} />
            <span className="text-[13px]">图片加载失败</span>
          </div>
        )}

        {/* 图片 */}
        <img
          src={src}
          alt={alt || ""}
          draggable={false}
          onClick={handleImageClick}
          onLoad={() => setLoadState("loaded")}
          onError={() => setLoadState("error")}
          className={cn(
            "select-none max-w-[92vw] max-h-[92vh] object-contain",
            loadState !== "loaded" && "invisible",
          )}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? "none" : "transform 0.15s ease-out",
          }}
        />
      </div>

      {/* 底部缩放信息 */}
      {loadState === "loaded" && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-white/10 text-[11px] text-white/50 select-none">
          {Math.round(scale * 100)}%
        </div>
      )}
    </div>
  );

  // Portal 到 body，避免被父级 overflow:hidden 裁剪
  return createPortal(content, document.body);
}
