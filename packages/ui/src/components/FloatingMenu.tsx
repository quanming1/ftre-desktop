import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../utils/cn";
import {
  calculateFloatingMenuPosition,
  type FloatingMenuAlign,
  type FloatingMenuPlacement,
  type FloatingMenuPosition,
} from "../utils/floating-menu-position";

export interface FloatingMenuProps
  extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  placement?: FloatingMenuPlacement;
  align?: FloatingMenuAlign;
  gap?: number;
  viewportPadding?: number;
  menuId?: string;
  contentRef?: Ref<HTMLDivElement>;
  portalTarget?: HTMLElement | null;
}

const HIDDEN_OFFSET = -10000;

function setRef<T>(ref: Ref<T> | undefined, value: T | null): void {
  if (typeof ref === "function") {
    ref(value);
    return;
  }
  if (ref) {
    (ref as { current: T | null }).current = value;
  }
}

function getViewport(): {
  top: number;
  left: number;
  width: number;
  height: number;
} {
  const visualViewport = window.visualViewport;
  if (visualViewport) {
    return {
      top: visualViewport.offsetTop,
      left: visualViewport.offsetLeft,
      width: visualViewport.width,
      height: visualViewport.height,
    };
  }
  return {
    top: 0,
    left: 0,
    width: window.innerWidth,
    height: window.innerHeight,
  };
}

function readRect(element: HTMLElement, includeContentSize = false): {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
} {
  const rect = element.getBoundingClientRect();
  const width = rect.width || element.offsetWidth || 1;
  const height = rect.height || element.offsetHeight || 1;
  return {
    top: rect.top,
    right: rect.right,
    bottom: rect.bottom,
    left: rect.left,
    width: includeContentSize ? Math.max(width, element.scrollWidth || 0) : width,
    height: includeContentSize ? Math.max(height, element.scrollHeight || 0) : height,
  };
}

/**
 * Portal 浮层的唯一定位实现。
 *
 * 面板必须先挂载再测量，才能覆盖异步内容、展开列表和不同显示器视口；
 * 组件只负责坐标与视口边界，菜单开关、选择行为和 hover 策略由调用方维护。
 */
export function FloatingMenu({
  open,
  anchorRef,
  children,
  placement = "bottom",
  align = "start",
  gap = 4,
  viewportPadding = 8,
  menuId = "menu",
  contentRef,
  portalTarget,
  className,
  style,
  ...props
}: FloatingMenuProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<FloatingMenuPosition | null>(null);
  const frameRef = useRef<number | null>(null);
  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;
    const panel = panelRef.current;
    if (!anchor || !panel || typeof window === "undefined") return;

    const anchorRect = readRect(anchor);
    // scrollWidth/scrollHeight 保留未裁剪的内容尺寸，展开“更多模型”时可以
    // 在不改变输入框布局的前提下重新选择可用方向，而不是继续沿用旧坐标。
    const panelRect = readRect(panel, true);
    const viewport = getViewport();
    const next = calculateFloatingMenuPosition(
      anchorRect,
      { width: panelRect.width, height: panelRect.height },
      viewport,
      { placement, align, gap, padding: viewportPadding },
    );
    setPosition((current) => (
      current &&
      current.left === next.left &&
      current.top === next.top &&
      current.maxHeight === next.maxHeight &&
      current.placement === next.placement
        ? current
        : next
    ));
  }, [align, anchorRef, gap, placement, viewportPadding]);

  const scheduleUpdate = useCallback(() => {
    if (frameRef.current !== null) return;
    const callback = () => {
      frameRef.current = null;
      updatePosition();
    };
    if (typeof window.requestAnimationFrame === "function") {
      frameRef.current = window.requestAnimationFrame(callback);
    } else {
      frameRef.current = window.setTimeout(callback, 0);
    }
  }, [updatePosition]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return undefined;
    }

    updatePosition();
    scheduleUpdate();

    const anchor = anchorRef.current;
    const panel = panelRef.current;
    const resizeObserver = typeof ResizeObserver === "function"
      ? new ResizeObserver(scheduleUpdate)
      : null;
    resizeObserver?.observe(anchor ?? document.body);
    if (panel) resizeObserver?.observe(panel);

    // 子菜单位于另一个 Portal 内时，父菜单移动不会触发 anchor 的 ResizeObserver；
    // 监听该父面板的属性/子树变化，确保父浮层重排后子浮层同步跟随。
    const mutationTarget = anchor?.parentElement;
    const mutationObserver = typeof MutationObserver === "function" && mutationTarget
      ? new MutationObserver(scheduleUpdate)
      : null;
    mutationObserver?.observe(mutationTarget as Node, {
      attributes: true,
      childList: true,
      subtree: true,
    });

    window.addEventListener("resize", scheduleUpdate);
    window.addEventListener("scroll", scheduleUpdate, true);
    window.visualViewport?.addEventListener("resize", scheduleUpdate);
    window.visualViewport?.addEventListener("scroll", scheduleUpdate);

    return () => {
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      window.removeEventListener("resize", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate, true);
      window.visualViewport?.removeEventListener("resize", scheduleUpdate);
      window.visualViewport?.removeEventListener("scroll", scheduleUpdate);
      if (frameRef.current !== null) {
        if (typeof window.cancelAnimationFrame === "function") {
          window.cancelAnimationFrame(frameRef.current);
        } else {
          window.clearTimeout(frameRef.current);
        }
        frameRef.current = null;
      }
    };
  }, [anchorRef, open, scheduleUpdate, updatePosition]);

  useEffect(() => () => {
    if (frameRef.current !== null) {
      if (typeof window.cancelAnimationFrame === "function") {
        window.cancelAnimationFrame(frameRef.current);
      } else {
        window.clearTimeout(frameRef.current);
      }
      frameRef.current = null;
    }
  }, []);

  if (!open || typeof document === "undefined") return null;

  const target = portalTarget ?? document.body;
  if (!target) return null;

  const panelStyle: CSSProperties = {
    ...style,
    position: "fixed",
    left: position?.left ?? HIDDEN_OFFSET,
    top: position?.top ?? HIDDEN_OFFSET,
    maxHeight: position?.maxHeight ?? "calc(100vh - 16px)",
    maxWidth: `calc(100vw - ${viewportPadding * 2}px)`,
    overflowY: style?.overflowY ?? "auto",
    overflowX: style?.overflowX ?? "hidden",
    visibility: position ? "visible" : "hidden",
    pointerEvents: position ? "auto" : "none",
  };

  return createPortal(
    <div
      {...props}
      ref={(node) => {
        panelRef.current = node;
        setRef(contentRef, node);
      }}
      data-ftre-floating-menu={menuId}
      className={cn("fixed z-[9999] outline-none", className)}
      style={panelStyle}
    >
      {children}
    </div>,
    target,
  );
}
