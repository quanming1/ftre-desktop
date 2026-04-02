import { useEffect, useRef, useMemo } from "react";
import {
  useMemoryMonitor,
  formatBytes,
  formatKB,
} from "@/services/memory-monitor";
import { editorManager } from "@ftre/editor/core";

// ══════════════════════════════════════════════════
//  类型定义
// ══════════════════════════════════════════════════

interface MemoryMonitorPanelProps {
  onClose: () => void;
}

// ══════════════════════════════════════════════════
//  常量
// ══════════════════════════════════════════════════

/** 迷你火花线图最多显示的采样数 */
const SPARKLINE_SAMPLES = 60;
/** 每根柱子的宽度（px） */
const SPARKLINE_BAR_WIDTH = 3;
/** 火花线图区域高度（px） */
const SPARKLINE_HEIGHT = 48;

// ══════════════════════════════════════════════════
//  编辑器实时统计（直接调用 editorManager）
// ══════════════════════════════════════════════════

interface EditorStats {
  slotCount: number;
  preloadedModelCount: number;
  viewStateCount: number;
  activeSlotPath: string | null;
}

function getEditorStats(): EditorStats | null {
  try {
    const stats = editorManager.getStats();
    return {
      slotCount: stats.slotCount,
      preloadedModelCount: stats.preloadedModelCount,
      viewStateCount: stats.viewStateCount,
      activeSlotPath: stats.activeSlotPath,
    };
  } catch {
    // editorManager 可能尚未初始化
    return null;
  }
}

// ══════════════════════════════════════════════════
//  组件
// ══════════════════════════════════════════════════

export function MemoryMonitorPanel({ onClose }: MemoryMonitorPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // 从 Zustand store 获取内存监控数据
  const latest = useMemoryMonitor((s) => s.latest);
  const history = useMemoryMonitor((s) => s.history);
  const running = useMemoryMonitor((s) => s.running);
  const collectNow = useMemoryMonitor((s) => s.collectNow);
  const clearHistory = useMemoryMonitor((s) => s.clearHistory);

  // 直接从 editorManager 获取编辑器实时统计
  const editorStats = getEditorStats();

  // ── 点击面板外部关闭 ──
  useEffect(() => {
    function handleMouseDown(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    }
    document.addEventListener("mousedown", handleMouseDown);
    return () => document.removeEventListener("mousedown", handleMouseDown);
  }, [onClose]);

  // ── 按 Escape 关闭 ──
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // ── 火花线图数据：取最后 60 条 jsHeapUsed ──
  const sparklineData = useMemo(() => {
    return history.slice(-SPARKLINE_SAMPLES).map((s) => s.jsHeapUsed);
  }, [history]);

  const sparklineMax = useMemo(() => {
    if (sparklineData.length === 0) return 1;
    const max = Math.max(...sparklineData);
    return max > 0 ? max : 1;
  }, [sparklineData]);

  // ── 堆内存使用百分比 ──
  const heapUsedPct = latest
    ? latest.jsHeapLimit > 0
      ? Math.min(100, (latest.jsHeapUsed / latest.jsHeapLimit) * 100)
      : 0
    : 0;

  return (
    <div
      ref={containerRef}
      className="absolute bottom-full mb-1 right-0 max-h-130 overflow-y-auto bg-base border border-border-subtle rounded-lg shadow-2xl z-50 text-[12px] font-mono"
      style={{ width: 400 }}
    >
      {/* ── 标题栏 ── */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle">
        <span className="text-t-primary font-semibold text-[13px]">
          内存监控
        </span>
        <div className="flex items-center gap-2">
          {running ? (
            <span className="text-neon text-[11px]">● 采集中</span>
          ) : (
            <span className="text-t-dim text-[11px]">○ 已停止</span>
          )}
          <button
            className="text-t-dim hover:text-t-primary transition-colors px-1"
            onClick={onClose}
            aria-label="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="p-3 space-y-3">
        {/* ═══════════════════════════════════════
            Section 1: JS 堆内存
           ═══════════════════════════════════════ */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-t-muted pb-1 mb-2 border-b border-border-subtle">
            JS 堆内存
          </h3>

          {/* 迷你火花线图（纯 CSS div 柱状图） */}
          <div
            className="flex items-end gap-px bg-elevated rounded p-1.5 mb-2 overflow-hidden"
            style={{ height: SPARKLINE_HEIGHT + 12 }}
          >
            {sparklineData.length > 0 ? (
              sparklineData.map((value, i) => {
                const heightPct = (value / sparklineMax) * 100;
                return (
                  <div
                    key={i}
                    className="bg-neon/60 rounded-sm shrink-0"
                    style={{
                      width: SPARKLINE_BAR_WIDTH,
                      height: `${Math.max(1, heightPct)}%`,
                    }}
                  />
                );
              })
            ) : (
              <span className="text-t-dim text-[11px] m-auto">
                暂无采样数据
              </span>
            )}
          </div>

          {/* 已用 / 总量 / 上限 */}
          <div className="grid grid-cols-3 gap-2 mb-2">
            <div>
              <div className="text-t-muted text-[11px]">已用堆内存</div>
              <div className="text-t-primary">
                {latest ? formatBytes(latest.jsHeapUsed) : "—"}
              </div>
            </div>
            <div>
              <div className="text-t-muted text-[11px]">堆内存总量</div>
              <div className="text-t-secondary">
                {latest ? formatBytes(latest.jsHeapTotal) : "—"}
              </div>
            </div>
            <div>
              <div className="text-t-muted text-[11px]">堆内存上限</div>
              <div className="text-t-secondary">
                {latest ? formatBytes(latest.jsHeapLimit) : "—"}
              </div>
            </div>
          </div>

          {/* 使用率百分比条 */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 bg-white/10 rounded-full">
              <div
                className="h-full bg-neon/70 rounded-full transition-all duration-300"
                style={{ width: `${heapUsedPct}%` }}
              />
            </div>
            <span className="text-t-dim text-[11px] w-10 text-right">
              {heapUsedPct.toFixed(1)}%
            </span>
          </div>
        </section>

        {/* ═══════════════════════════════════════
            Section 2: 进程内存
           ═══════════════════════════════════════ */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-t-muted pb-1 mb-2 border-b border-border-subtle">
            进程内存
          </h3>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <div className="text-t-muted text-[11px]">主进程 RSS</div>
              <div className="text-t-primary">
                {latest ? formatBytes(latest.mainRss) : "—"}
              </div>
            </div>
            <div>
              <div className="text-t-muted text-[11px]">总工作集</div>
              <div className="text-t-primary">
                {latest ? formatKB(latest.totalWorkingSet) : "—"}
              </div>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════
            Section 3: 编辑器统计
           ═══════════════════════════════════════ */}
        <section>
          <h3 className="text-[11px] uppercase tracking-wider text-t-muted pb-1 mb-2 border-b border-border-subtle">
            编辑器统计
          </h3>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <div className="flex justify-between">
              <span className="text-t-dim">活跃插槽</span>
              <span className="text-t-primary">
                {editorStats ? `${editorStats.slotCount}/8` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-t-dim">预加载模型</span>
              <span className="text-t-primary">
                {editorStats ? `${editorStats.preloadedModelCount}/15` : "—"}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-t-dim">视图状态缓存</span>
              <span className="text-t-primary">
                {editorStats ? editorStats.viewStateCount : "—"}
              </span>
            </div>
            <div className="col-span-2 mt-0.5">
              <span className="text-t-dim">当前活跃路径: </span>
              <span className="text-t-secondary truncate inline-block max-w-65 align-bottom">
                {editorStats?.activeSlotPath ?? "无"}
              </span>
            </div>
          </div>
        </section>

        {/* ═══════════════════════════════════════
            Section 4: 操作按钮
           ═══════════════════════════════════════ */}
        <section>
          <div className="border-b border-border-subtle mb-2" />
          <div className="flex items-center gap-2">
            <button
              className="flex-1 px-3 py-1.5 text-[12px] text-t-primary bg-elevated hover:bg-panel border border-border-subtle rounded-md transition-colors"
              onClick={() => collectNow()}
            >
              立即采集
            </button>
            <button
              className="flex-1 px-3 py-1.5 text-[12px] text-t-dim bg-elevated hover:bg-panel border border-border-subtle rounded-md transition-colors"
              onClick={() => clearHistory()}
            >
              清除历史
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
