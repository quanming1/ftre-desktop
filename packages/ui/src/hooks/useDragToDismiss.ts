import { useCallback, useEffect, useRef, useState } from "react";

export interface UseDragToDismissOptions {
  /** Distance (px) to trigger dismiss. Default: 100 */
  threshold?: number;
  /** Dead zone radius (px) — movements smaller than this are ignored. Default: 3 */
  deadZone?: number;
  /** Distance (px) at which opacity starts fading. Default: 40 */
  fadeStart?: number;
  /** Distance (px) at which opacity reaches 0. Default: 120 */
  fadeEnd?: number;
  /** Scale factor at full drag distance. Default: 0.92 */
  minScale?: number;
  /** Called when the user drags past the threshold. */
  onDismiss: () => void;
  /** CSS selectors to ignore (e.g. "button", "a"). Default: ["button", "a"] */
  ignoreSelectors?: string[];
  /** Enable touch support. Default: true */
  touch?: boolean;
  /** Drag axis: "x" = horizontal only, "y" = vertical only, "both" = any direction. Default: "both" */
  axis?: "x" | "y" | "both";
}

export interface DragToDismissState {
  /** Current offset from origin { x, y } */
  offset: { x: number; y: number };
  /** Total distance from origin */
  distance: number;
  /** Whether a drag is in progress (past dead zone) */
  isDragging: boolean;
  /** Whether the dismiss animation should play */
  isDismissed: boolean;
  /** Computed opacity [0..1] based on distance */
  opacity: number;
  /** Computed scale factor based on distance */
  scale: number;
  /** Last drag velocity { x, y } in px/frame — useful for dismiss direction */
  velocity: { x: number; y: number };
}

/**
 * Hook: drag-to-dismiss gesture for elements like notification cards.
 *
 * Supports mouse and touch. Handles:
 * - Dead zone to distinguish clicks from drags
 * - Fade + scale feedback during drag
 * - Velocity-based dismiss (flick to dismiss even under threshold)
 * - Snap-back on cancel
 * - Cleanup on unmount mid-drag
 * - Ignores drag starting from interactive elements (buttons, links)
 * - Prevents text selection during drag
 */
export function useDragToDismiss({
  threshold = 100,
  deadZone = 3,
  fadeStart = 40,
  fadeEnd = 120,
  minScale = 0.92,
  onDismiss,
  ignoreSelectors = ["button", "a", '[role="button"]'],
  touch = true,
  axis = "both",
}: UseDragToDismissOptions) {
  const [state, setState] = useState<DragToDismissState>({
    offset: { x: 0, y: 0 },
    distance: 0,
    isDragging: false,
    isDismissed: false,
    opacity: 1,
    scale: 1,
    velocity: { x: 0, y: 0 },
  });

  // Refs to avoid stale closures in event handlers
  const originRef = useRef({ x: 0, y: 0 });
  const draggingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const lastTimeRef = useRef(0);
  const velocityRef = useRef({ x: 0, y: 0 });
  const onDismissRef = useRef(onDismiss);
  onDismissRef.current = onDismiss;

  // Prevents re-renders from resetting the dismiss state
  const dismissedRef = useRef(false);

  const computeFeedback = useCallback(
    (dist: number) => {
      const progress = Math.min(dist / threshold, 1);
      const opacity =
        dist < fadeStart ? 1 : Math.max(0, 1 - (dist - fadeStart) / (fadeEnd - fadeStart));
      const scale = 1 - progress * (1 - minScale);
      return { opacity, scale };
    },
    [threshold, fadeStart, fadeEnd, minScale],
  );

  const handleStart = useCallback(
    (clientX: number, clientY: number, target: EventTarget | null) => {
      if (dismissedRef.current) return;

      // Ignore if started from an interactive element
      if (target instanceof HTMLElement && ignoreSelectors.length > 0) {
        for (const sel of ignoreSelectors) {
          if (target.closest(sel)) return;
        }
      }

      originRef.current = { x: clientX, y: clientY };
      lastPosRef.current = { x: clientX, y: clientY };
      lastTimeRef.current = Date.now();
      velocityRef.current = { x: 0, y: 0 };
      draggingRef.current = false;
    },
    [ignoreSelectors],
  );

  const handleMove = useCallback(
    (clientX: number, clientY: number) => {
      if (dismissedRef.current) return;
      if (originRef.current.x === 0 && originRef.current.y === 0) return;

      const rawDx = clientX - originRef.current.x;
      const rawDy = clientY - originRef.current.y;
      
      // Apply axis constraint
      const dx = axis === "y" ? 0 : rawDx;
      const dy = axis === "x" ? 0 : rawDy;
      const dist = axis === "x" ? Math.abs(dx) : axis === "y" ? Math.abs(dy) : Math.sqrt(dx * dx + dy * dy);

      if (!draggingRef.current && dist > deadZone) {
        draggingRef.current = true;
      }

      if (!draggingRef.current) return;

      // Velocity (px/ms)
      const now = Date.now();
      const dt = now - lastTimeRef.current;
      if (dt > 0) {
        velocityRef.current = {
          x: (clientX - lastPosRef.current.x) / dt,
          y: (clientY - lastPosRef.current.y) / dt,
        };
      }
      lastPosRef.current = { x: clientX, y: clientY };
      lastTimeRef.current = now;

      const { opacity, scale } = computeFeedback(dist);

      setState({
        offset: { x: dx, y: dy },
        distance: dist,
        isDragging: true,
        isDismissed: false,
        opacity,
        scale,
        velocity: velocityRef.current,
      });
    },
    [axis, deadZone, computeFeedback],
  );

  const handleEnd = useCallback(() => {
    if (dismissedRef.current) return;
    if (!draggingRef.current) {
      // Never started dragging — reset origin
      originRef.current = { x: 0, y: 0 };
      return;
    }

    const dx = state.offset.x;
    const dy = state.offset.y;
    const dist = axis === "x" ? Math.abs(dx) : axis === "y" ? Math.abs(dy) : Math.sqrt(dx * dx + dy * dy);

    // Velocity-based flick: if flicking fast enough (> 0.5 px/ms ≈ 30px @ 60fps), also dismiss
    const vx = axis === "y" ? 0 : velocityRef.current.x;
    const vy = axis === "x" ? 0 : velocityRef.current.y;
    const speed = axis === "x" ? Math.abs(vx) : axis === "y" ? Math.abs(vy) : Math.sqrt(vx ** 2 + vy ** 2);
    const shouldDismiss = dist > threshold || speed > 0.5;

    if (shouldDismiss) {
      dismissedRef.current = true;
      setState((prev) => ({
        ...prev,
        isDragging: false,
        isDismissed: true,
        velocity: velocityRef.current,
      }));
      onDismissRef.current();
    } else {
      // Snap back
      draggingRef.current = false;
      originRef.current = { x: 0, y: 0 };
      velocityRef.current = { x: 0, y: 0 };
      setState({
        offset: { x: 0, y: 0 },
        distance: 0,
        isDragging: false,
        isDismissed: false,
        opacity: 1,
        scale: 1,
        velocity: { x: 0, y: 0 },
      });
    }
  }, [state.offset, threshold]);

  // ── Mouse events (document-level) ────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      handleStart(e.clientX, e.clientY, e.target);
    },
    [handleStart],
  );

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const onMouseUp = () => handleEnd();

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [handleMove, handleEnd]);

  // ── Touch events ─────────────────────────────────────────────────

  useEffect(() => {
    if (!touch) return;

    const el = document.documentElement;

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      handleStart(t.clientX, t.clientY, e.target);
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return;
      const t = e.touches[0];
      handleMove(t.clientX, t.clientY);

      // Prevent scroll while dragging
      if (draggingRef.current) {
        e.preventDefault();
      }
    };

    const onTouchEnd = () => handleEnd();

    // passive: false to allow preventDefault in touchMove
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchEnd, { passive: true });

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchEnd);
    };
  }, [touch, handleStart, handleMove, handleEnd]);

  // ── Prevent text selection during drag ───────────────────────────

  useEffect(() => {
    if (state.isDragging) {
      const prev = document.body.style.userSelect;
      document.body.style.userSelect = "none";
      return () => {
        document.body.style.userSelect = prev;
      };
    }
  }, [state.isDragging]);

  return {
    /** Spread onto the draggable element as onMouseDown */
    handleMouseDown,
    state,
  };
}
