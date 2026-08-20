/**
 * 运行详情右栏的响应式切换阈值。
 *
 * 右栏自身至少需要 368px；同时为消息列表保留约 720px 的可读宽度及左侧导航空间。
 * 进入、恢复阈值刻意留出 80px 滞回区，ResizeObserver 连续报告临界尺寸时不会反复切换。
 */
export const RUN_CONTEXT_FLOAT_THRESHOLD = 1_184;
export const RUN_CONTEXT_RAIL_THRESHOLD = 1_264;

export type RunContextLayoutMode = "rail" | "floating";

export function initialRunContextLayoutMode(containerWidth: number): RunContextLayoutMode {
  return containerWidth >= RUN_CONTEXT_RAIL_THRESHOLD ? "rail" : "floating";
}

export function nextRunContextLayoutMode(
  containerWidth: number,
  currentMode: RunContextLayoutMode,
): RunContextLayoutMode {
  if (!Number.isFinite(containerWidth) || containerWidth <= 0) return currentMode;
  if (currentMode === "rail") {
    return containerWidth < RUN_CONTEXT_FLOAT_THRESHOLD ? "floating" : "rail";
  }
  return containerWidth >= RUN_CONTEXT_RAIL_THRESHOLD ? "rail" : "floating";
}
