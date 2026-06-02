/**
 * TokenRing — 上下文水位指示
 *
 * 视觉：跟 ModelSelector 同款的纯文字按钮（mono 字体 + hover 高亮），
 *      只在水位 ≥ 70% 时着警示色，其他情况保持中性灰，避免抢眼。
 *
 * 数据来源：
 * - tokenUsage：后端 GET /api/sessions/{id}/token_usage 返回明细
 *   - anchor.total_tokens: 最近一次 LLM 实算
 *   - pending_estimated:   锚点之后未计入事件的字符级粗估
 *                          （anchor 为 null 时是对全量事件估算）
 *   - total:               anchor 实算 + pending 估算（无 anchor 时即全量估算）
 * - contextWindow：当前选中模型的 context_window，由 ModelSelector 同步进 chat store
 *
 * 没有 contextWindow 时退化为只显示压缩 token 数。
 * tokenUsage 为 null（首次加载 / fetch 失败）时显示加载占位。
 */
import { useChat } from "@/stores/chat";
import { Tooltip } from "@ftre/ui";

function formatTokens(n: number): string {
  if (n >= 1_000_000) {
    const v = n / 1_000_000;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "M";
  }
  if (n >= 1000) {
    const v = n / 1000;
    return (v >= 10 ? Math.round(v) : Math.round(v * 10) / 10) + "K";
  }
  return String(n);
}

const BUTTON_CLASS =
  "flex items-center text-[13px] h-8 px-3 rounded-full font-mono cursor-default transition-colors duration-150 hover:bg-[#e7e7e8]";

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
        <div className={`${BUTTON_CLASS} text-t-ghost`}>
          <span className="tabular-nums">—</span>
        </div>
      </Tooltip>
    );
  }

  const total = usage.total;
  const realPart = usage.anchor?.total_tokens ?? 0;
  const estPart = usage.pending_estimated;
  const hasAnchor = !!usage.anchor;

  const hasWindow = typeof contextWindow === "number" && contextWindow > 0;
  const pct = hasWindow ? Math.min((total / contextWindow!) * 100, 100) : 0;

  // 主要是为了不喧宾夺主：默认中性灰，超过 70% 才着警示色
  const colorClass =
    pct >= 90
      ? "text-red-500"
      : pct >= 70
        ? "text-amber-500"
        : "text-t-muted hover:text-t-primary";

  // 显示文本：有窗口时百分比，没窗口时压缩 token 数
  const label = hasWindow ? `${Math.round(pct)}%` : formatTokens(total);

  // ─── Tooltip 详情 ───
  const tooltip = (
    <div className="text-[11.5px] leading-[1.6] min-w-[180px]">
      <div className="font-medium mb-1 text-t-primary">上下文用量</div>

      {hasAnchor && (
        <div className="flex items-center justify-between gap-3">
          <span className="text-t-muted">实算 (LLM 上报)</span>
          <span className="font-mono text-t-secondary">
            {realPart.toLocaleString()}
          </span>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <span className="text-t-muted">
          {hasAnchor ? "估算 (未实算部分)" : "估算 (全量)"}
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
              {pct < 0.1 && total > 0 ? "< 0.1" : pct.toFixed(1)}%
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
      <div className={`${BUTTON_CLASS} ${colorClass}`}>
        <span className="tabular-nums">{label}</span>
      </div>
    </Tooltip>
  );
}
