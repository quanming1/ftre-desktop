import { useChat } from "@/stores/chat";

const MAX_TOKENS = 200_000;
const CIRCUMFERENCE = 2 * Math.PI * 15.5; // ≈ 97.4

export function TokenRing() {
  const contextTokens = useChat((s) => s.contextTokens);

  const pct = Math.min((contextTokens / MAX_TOKENS) * 100, 100);
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  const strokeColor = pct >= 90 ? "stroke-danger" : pct >= 70 ? "stroke-warning" : "stroke-neon";

  return (
    <div className="relative flex items-center gap-1.5 cursor-default group">
      <svg width="20" height="20" viewBox="0 0 36 36" className="shrink-0">
        <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3" className="stroke-border" />
        <circle
          cx="18"
          cy="18"
          r="15.5"
          fill="none"
          strokeWidth="3"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          strokeLinecap="butt"
          transform="rotate(-90 18 18)"
          className={`${strokeColor} transition-all duration-400`}
        />
      </svg>
      <span className="text-[10px] text-t-dim font-mono">{Math.round(pct)}%</span>

      {/* Tooltip */}
      <div className="hidden group-hover:block absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-2.5 py-1.5 bg-elevated border border-border-subtle rounded text-[11px] text-t-secondary font-mono whitespace-nowrap z-50 shadow-lg">
        {contextTokens.toLocaleString()} / {MAX_TOKENS.toLocaleString()} 令牌
        <div className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-elevated" />
      </div>
    </div>
  );
}
