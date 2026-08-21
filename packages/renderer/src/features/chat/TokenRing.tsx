/**
 * TokenRing — 上下文水位指示
 *
 * 视觉：固定尺寸的小圆环，用环形进度表示上下文占比；
 *      只在水位 ≥ 70% 时着警示色，其他情况保持中性灰，避免抢眼。
 *
 * 数据来源：
 * - tokenUsage：后端 GET /api/sessions/{id}/token_usage 返回明细
 *   - last_call_usage.total_tokens: 最近一次 LLM 实算
 *   - pending_estimated:   锚点之后未计入事件的字符级粗估
 *                          （last_call_usage 为 null 时是对全量消息估算）
 *   - total:               last_call_usage 实算 + pending 估算
 * - contextWindow：当前选中模型的 context_window，由 ModelSelector 同步进 chat store
 *
 * 没有 contextWindow 时退化为未填充圆环，详细 token 数仍在 tooltip 中展示。
 * tokenUsage 为 null（首次加载 / fetch 失败）时显示加载占位。
 */
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { useChat } from "@/stores/chat";
import { Tooltip } from "@ftre/ui";

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

type ContextRingProps = ComponentPropsWithoutRef<"div"> & {
  value: number;
  colorClass: string;
};

const ContextRing = forwardRef<HTMLDivElement, ContextRingProps>(({ value, colorClass, className, ...props }, ref) => {
  const progress = Math.min(100, Math.max(0, value));
  const dashOffset = RING_CIRCUMFERENCE * (1 - progress / 100);

  return (
    <div
      ref={ref}
      {...props}
      className={`relative flex h-4 w-4 shrink-0 translate-y-px items-center justify-center rounded-full text-t-ghost transition-colors duration-150 hover:bg-hover ${className ?? ""}`}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-4 w-4 -rotate-90"
        viewBox="0 0 16 16"
      >
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          className="text-border-subtle"
        />
        <circle
          cx="8"
          cy="8"
          r={RING_RADIUS}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray={RING_CIRCUMFERENCE}
          strokeDashoffset={dashOffset}
          className={`${colorClass} transition-[stroke-dashoffset,stroke] duration-300 ease-out`}
        />
      </svg>
    </div>
  );
});

ContextRing.displayName = "ContextRing";

export function TokenRing() {
  const usage = useChat((s) => s.tokenUsage);
  const contextWindow = useChat((s) => s.contextWindow);

  // ─── 加载占位：tokenUsage 还没拉到 ───
  if (!usage) {
    return (
      <Tooltip
        content={
          <div className="text-[11.5px] text-t-muted">加载上下文用量…</div>
        }
        side="top"
      >
        <ContextRing value={0} colorClass="text-t-ghost" />
      </Tooltip>
    );
  }

  const total = usage.total;
  const realPart = usage.last_call_usage?.total_tokens ?? 0;
  const estPart = usage.pending_estimated;
  const hasLastCallUsage = !!usage.last_call_usage;

  const hasWindow = typeof contextWindow === "number" && contextWindow > 0;
  const rawPct = hasWindow ? (total / contextWindow!) * 100 : 0;

  // 主要是为了不喧宾夺主：默认中性灰，超过 70% 才着警示色
  const colorClass =
    rawPct >= 90
      ? "text-red-500"
      : rawPct >= 70
        ? "text-amber-500"
        : "text-t-dim";

  // ─── Tooltip 详情 ───
  const tooltip = (
    <div className="text-[11.5px] leading-[1.6] min-w-[180px]">
      <div className="font-medium mb-1 text-t-primary">上下文用量</div>

      {hasLastCallUsage && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-t-muted">最后一次调用</span>
          <span className="font-mono text-t-secondary">
            {realPart.toLocaleString()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-t-muted">
          {hasLastCallUsage ? "估算 (未实算部分)" : "估算 (全量)"}
        </span>
        <span className="font-mono text-t-secondary">
          ≈ {estPart.toLocaleString()}
        </span>
      </div>

      <div className="my-1 border-t border-border-subtle" />

      <div className="flex items-center justify-between gap-3">
        <span className="text-t-muted">合计</span>
        <span className="font-mono text-t-primary">
          {total.toLocaleString()}
        </span>
      </div>

      {hasWindow ? (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="text-t-muted">上下文窗口</span>
            <span className="font-mono text-t-secondary">
              {contextWindow!.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center justify-between gap-3 mt-0.5">
            <span className="text-t-muted">占比</span>
            <span className="font-mono font-medium text-t-primary">
              {rawPct < 0.1 && total > 0 ? "< 0.1" : rawPct.toFixed(1)}%
            </span>
          </div>
        </>
      ) : (
        <div className="text-t-ghost mt-1">未配置上下文窗口</div>
      )}
    </div>
  );

  return (
    <Tooltip content={tooltip} side="top">
      <ContextRing value={rawPct} colorClass={colorClass} />
    </Tooltip>
  );
}
