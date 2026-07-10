/**
 * useSmoothTabReorder — Chrome 风格的水平 Tab 拖拽排序 hook
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 踩坑记录（不可删除，后续维护必读）
 * ═══════════════════════════════════════════════════════════════════════
 *
 * 【坑 1】framer-motion Reorder + Monaco = InstantiationService disposed
 *   现象：用 framer-motion 的 <Reorder.Group>/<Reorder.Item> 实现 tab 拖拽，
 *         拖拽结束后 store 更新 → InspectorPanel re-render →
 *         内容区 tabs.map() 的 DOM 顺序变化 →
 *         @monaco-editor/react 检测到容器 DOM 位置变化，
 *         内部调用 editor.dispose() + 重新 createEditor，
 *         但旧 InstantiationService 已 disposed，setModel 时崩溃：
 *         "Error: InstantiationService has been disposed"
 *
 *   根因：Monaco 编辑器对 DOM reparenting 极其敏感。React 的 key-based
 *         reconciliation 在列表顺序变化时会移动 DOM 节点（而不是重建），
 *         这会导致 Monaco 的内部状态（View2、InstantiationService）失效。
 *         framer-motion 的 layout 动画会加剧这个问题——它在动画过程中
 *         会频繁修改 DOM 的 transform 和顺序。
 *
 *   尝试过的失败方案：
 *     a) Reorder.Group 用 localTabs 做受控源，拖拽中不更新 store，
 *        onDragEnd 才同步 → 仍然崩溃，因为 onDragEnd 里的 store 更新
 *        触发 InspectorPanel re-render，内容区 DOM reorder
 *     b) 加 ErrorBoundary 包裹每个 tab → 能捕获错误但无法恢复，
 *        Monaco 内部状态已损坏，retry 也只是重新触发同一个崩溃
 *     c) onDragEnd 里用 ref 读最新 localTabs + setTimeout 延迟 store 更新
 *        → 延迟只是把崩溃延后了一帧
 *
 *   最终方案（本 hook 实现）：
 *     放弃 framer-motion Reorder，用原生 Pointer Events 手写拖拽。
 *     关键：拖拽只改变 tab bar 的视觉顺序（CSS transform），
 *     不改变 store 中 tabs 数组顺序直到拖拽结束。
 *     拖拽结束时一次性调用 onReorder(fromId, toIndex) 更新 store。
 *
 * 【坑 2】内容区 DOM 顺序必须与 tab bar 顺序解耦
 *   即使用了原生拖拽，拖拽结束后 store 更新仍然会改变 tabs 数组顺序，
 *   如果内容区直接用 tabs.map() 渲染，DOM 顺序变化仍会导致 Monaco 崩溃。
 *
 *   解决方案：内容区用 contentTabs（按 mount order 排序）渲染，
 *   tab bar 用 tabs（store 顺序）渲染。
 *   两者完全独立——拖拽只影响 tab bar 顺序，内容区 DOM 顺序永不变化。
 *   详见 InspectorPanel 中的 compareTabMountOrder + contentTabs。
 *
 * 【坑 3】onReorder 在 render phase 调用导致 "Cannot update a component
 *         while rendering a different component"
 *   framer-motion 的 onReorder 回调在 React render phase 触发，
 *   如果在其中调用 store 更新，会触发 React 的 "setState during render" 警告。
 *   本 hook 的 finishDrag 是事件回调（不在 render phase），安全。
 *
 * 【坑 4】click vs drag 冲突
 *   pointerdown 后如果用户只是想点击切换 tab，不应该触发拖拽。
 *   解决：4px 拖拽阈值 + suppressClickRef（50ms 延迟清除），
 *   拖拽启动时设 suppressClickRef = true，
 *   pointerup 后 50ms 才清除，确保 click 事件被拦截。
 *
 * 【坑 5】pointermove 性能
 *   高频 pointermove 事件直接 setState 会导致每帧多次 re-render。
 *   解决：requestAnimationFrame 节流，每帧最多一次 setDragState，
 *   且 setNextDragState 做 id/deltaX/targetIndex 三字段比对，相同则跳过。
 *
 * ═══════════════════════════════════════════════════════════════════════
 * 使用方式
 * ═══════════════════════════════════════════════════════════════════════
 *
 *   const drag = useSmoothTabReorder(tabs, onReorder);
 *
 *   <div ref={drag.containerRef}>
 *     {tabs.map((tab, index) => (
 *       <div
 *         key={tab.id}
 *         data-tab-id={tab.id}           // 必须设置，hook 通过它查找 DOM
 *         style={drag.getItemStyle(tab.id, index)}
 *       >
 *         <button
 *           onPointerDown={(e) => drag.handlePointerDown(e, tab.id)}
 *           onPointerMove={drag.handlePointerMove}
 *           onPointerUp={drag.handlePointerUp}
 *           onClick={(e) => {
 *             if (drag.shouldSuppressClick()) { e.preventDefault(); return; }
 *             // ... 正常点击逻辑
 *           }}
 *         >
 *           {tab.title}
 *         </button>
 *       </div>
 *     ))}
 *   </div>
 *
 * 约束：
 *   - 外层 div 必须设 data-tab-id
 *   - 外层 div 必须应用 drag.getItemStyle() 的返回值
 *   - containerRef 必须绑定到包含所有 tab 的容器元素
 */
import {
  useState,
  useEffect,
  useCallback,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

// ─── 类型 ──────────────────────────────────────────────────────────

interface TabDragRect {
  id: string;
  center: number;
  width: number;
}

interface TabDragSession {
  id: string;
  pointerId: number;
  startX: number;
  left: number;
  width: number;
  fromIndex: number;
  rects: TabDragRect[];
  started: boolean;
}

interface TabDragState {
  id: string;
  deltaX: number;
  width: number;
  fromIndex: number;
  targetIndex: number;
}

// ─── 常量 ──────────────────────────────────────────────────────────

/** 拖拽启动阈值（px），小于此距离视为 click 而非 drag */
const TAB_DRAG_START_THRESHOLD = 4;

// ─── Hook ──────────────────────────────────────────────────────────

export function useSmoothTabReorder<T extends { id: string }>(
  items: T[],
  onReorder: (fromId: string, toIndex: number) => void,
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sessionRef = useRef<TabDragSession | null>(null);
  const dragStateRef = useRef<TabDragState | null>(null);
  const frameRef = useRef<number | null>(null);
  const pendingClientXRef = useRef<number | null>(null);
  const suppressClickRef = useRef(false);

  // onReorder 用 ref 存储，避免 finishDrag 的 deps 包含 onReorder
  // 导致每次渲染重建 callback（见坑 3）
  const onReorderRef = useRef(onReorder);
  onReorderRef.current = onReorder;

  // 拖拽视觉状态：驱动 getItemStyle 的 transform
  const [dragState, setDragState] = useState<TabDragState | null>(null);

  /**
   * 设置拖拽状态，带三字段去重（id/deltaX/targetIndex）。
   * rAF 节流后同一帧可能多次调用，去重避免无效 re-render（见坑 5）。
   */
  const setNextDragState = useCallback((next: TabDragState | null) => {
    dragStateRef.current = next;
    setDragState((prev) => {
      if (
        prev?.id === next?.id &&
        prev?.deltaX === next?.deltaX &&
        prev?.targetIndex === next?.targetIndex
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  /**
   * 根据指针 X 坐标计算拖拽状态。
   * 被拖 tab 跟手（translateX = deltaX），其他 tab 根据拖拽中心点
   * 判断是否需要让位（向左或向右平移一个 tab 宽度）。
   */
  const computeDragState = useCallback((clientX: number): TabDragState | null => {
    const session = sessionRef.current;
    if (!session) return null;

    const deltaX = clientX - session.startX;
    // 未超过阈值时不启动拖拽，返回当前状态（见坑 4）
    if (!session.started && Math.abs(deltaX) < TAB_DRAG_START_THRESHOLD) {
      return dragStateRef.current;
    }

    session.started = true;
    suppressClickRef.current = true;

    // 拖拽中心点 = 初始位置 + 偏移
    const draggedCenter = session.left + session.width / 2 + deltaX;
    let targetIndex = 0;
    for (const rect of session.rects) {
      if (rect.id === session.id) continue;
      if (draggedCenter > rect.center) targetIndex += 1;
    }

    const maxIndex = Math.max(0, session.rects.length - 1);
    return {
      id: session.id,
      deltaX,
      width: session.width,
      fromIndex: session.fromIndex,
      targetIndex: Math.min(targetIndex, maxIndex),
    };
  }, []);

  const applyPointerPosition = useCallback(
    (clientX: number) => {
      const next = computeDragState(clientX);
      if (next) setNextDragState(next);
    },
    [computeDragState, setNextDragState],
  );

  /**
   * rAF 节流：同一帧内多次 pointermove 只取最后一次的 clientX（见坑 5）。
   */
  const schedulePointerPosition = useCallback(
    (clientX: number) => {
      pendingClientXRef.current = clientX;
      if (frameRef.current !== null) return;

      frameRef.current = window.requestAnimationFrame(() => {
        frameRef.current = null;
        const pendingClientX = pendingClientXRef.current;
        pendingClientXRef.current = null;
        if (pendingClientX !== null) applyPointerPosition(pendingClientX);
      });
    },
    [applyPointerPosition],
  );

  // unmount 时清理 rAF（见坑 5）
  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }
    },
    [],
  );

  /**
   * pointerdown：记录拖拽会话（不立即启动，等阈值判断）。
   * 快照所有 tab 的位置信息，拖拽过程中不再读取 DOM（性能）。
   */
  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, tabId: string) => {
      // 只响应左键，忽略修饰键（alt+click 等不触发拖拽）
      if (event.button !== 0) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;

      const container = containerRef.current;
      if (!container) return;

      // 快照所有 tab 的位置
      const elements = Array.from(container.querySelectorAll<HTMLElement>("[data-tab-id]"));
      const rects = items
        .map((item) => {
          const element = elements.find((node) => node.dataset.tabId === item.id);
          if (!element) return null;
          const rect = element.getBoundingClientRect();
          return {
            id: item.id,
            center: rect.left + rect.width / 2,
            width: rect.width,
          };
        })
        .filter((rect): rect is TabDragRect => rect !== null);

      const targetElement = elements.find((node) => node.dataset.tabId === tabId);
      const targetRect = targetElement?.getBoundingClientRect();
      const fromIndex = items.findIndex((item) => item.id === tabId);
      if (!targetRect || fromIndex < 0 || rects.length < 2) return;

      sessionRef.current = {
        id: tabId,
        pointerId: event.pointerId,
        startX: event.clientX,
        left: targetRect.left,
        width: targetRect.width,
        fromIndex,
        rects,
        started: false,
      };

      // pointer capture 确保拖拽中不会丢失事件（即使移出元素边界）
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // 元素可能在事件间被移除，忽略
      }
    },
    [items],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      schedulePointerPosition(event.clientX);
      if (session.started) event.preventDefault();
    },
    [schedulePointerPosition],
  );

  /**
   * pointerup：结束拖拽，一次性同步到 store。
   * 这是事件回调（不在 render phase），安全调用 store 更新（见坑 3）。
   */
  const finishDrag = useCallback(
    (event: ReactPointerEvent<HTMLElement>) => {
      const session = sessionRef.current;
      if (!session || session.pointerId !== event.pointerId) return;

      const finalState = computeDragState(event.clientX);
      if (finalState) setNextDragState(finalState);

      // 清理会话
      sessionRef.current = null;
      pendingClientXRef.current = null;
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
        frameRef.current = null;
      }

      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // 忽略 capture 丢失
      }

      if (session.started) {
        event.preventDefault();
        event.stopPropagation();
        // 拖拽结束才同步到 store（见坑 1、坑 2）
        if (finalState && finalState.targetIndex !== finalState.fromIndex) {
          onReorderRef.current(finalState.id, finalState.targetIndex);
        }
        // 50ms 延迟清除，确保 click 事件被拦截（见坑 4）
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 50);
      } else {
        // 未启动拖拽（未超过阈值），立即清除
        suppressClickRef.current = false;
      }

      setNextDragState(null);
    },
    [computeDragState, setNextDragState],
  );

  /**
   * 计算每个 tab 的 transform 样式。
   * 被拖 tab：translateX(deltaX)，无 transition（跟手）
   * 其他 tab：根据 targetIndex 平移一个 tab 宽度，120ms ease（弹性让位）
   */
  const getItemStyle = useCallback(
    (itemId: string, index: number): CSSProperties => {
      const base: CSSProperties = {
        position: "relative",
        touchAction: "none",
        cursor: dragState?.id === itemId ? "grabbing" : "grab",
      };
      if (!dragState) return base;

      if (dragState.id === itemId) {
        return {
          ...base,
          zIndex: 50,
          transform: `translate3d(${dragState.deltaX}px, 0, 0)`,
          transition: "none",
          boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
        };
      }

      // 其他 tab 让位逻辑
      let shift = 0;
      if (dragState.fromIndex < dragState.targetIndex) {
        // 向右拖：from 和 target 之间的 tab 向左平移
        if (index > dragState.fromIndex && index <= dragState.targetIndex) {
          shift = -dragState.width;
        }
      } else if (dragState.fromIndex > dragState.targetIndex) {
        // 向左拖：target 和 from 之间的 tab 向右平移
        if (index >= dragState.targetIndex && index < dragState.fromIndex) {
          shift = dragState.width;
        }
      }

      return {
        ...base,
        transform: shift === 0 ? undefined : `translate3d(${shift}px, 0, 0)`,
        transition: "transform 120ms ease",
      };
    },
    [dragState],
  );

  const shouldSuppressClick = useCallback(() => suppressClickRef.current, []);

  return {
    containerRef,
    getItemStyle,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp: finishDrag,
    shouldSuppressClick,
  };
}

// ─── 内容区排序工具（与拖拽解耦，见坑 2）────────────────────────────

/**
 * 按 tab ID 数字后缀排序，保证内容区 DOM 顺序固定。
 * 拖拽只改变 tab bar 的视觉顺序，内容区按 mount order 永不重排。
 */
export function compareByMountOrder<T extends { id: string }>(a: T, b: T): number {
  const delta = mountOrder(a) - mountOrder(b);
  return delta === 0 ? a.id.localeCompare(b.id) : delta;
}

function mountOrder(tab: { id: string }): number {
  const match = tab.id.match(/(\d+)$/);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}
