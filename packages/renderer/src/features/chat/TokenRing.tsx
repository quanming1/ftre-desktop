import { useChat } from "@/stores/chat";
import { Tooltip } from "@ftre/ui";

const MAX_TOKENS = 200_000;
const CIRCUMFERENCE = 2 * Math.PI * 15.5; // ≈ 97.4

export function TokenRing() {
  const contextTokens = useChat((s) => (s as any).contextTokens ?? 0);

  const pct = Math.min((contextTokens / MAX_TOKENS) * 100, 100);
  const offset = CIRCUMFERENCE - (pct / 100) * CIRCUMFERENCE;

  const strokeColor = pct >= 90 ? "stroke-danger" : pct >= 70 ? "stroke-warning" : "stroke-white/55";

  return (
    <Tooltip
      content={`${Math.round(pct)}% · ${contextTokens.toLocaleString()} / ${MAX_TOKENS.toLocaleString()} 令牌`}
      side="top"
    >
      <div className="flex items-center cursor-default px-1.5">
        <svg width="20" height="20" viewBox="0 0 36 36" className="shrink-0">
          <circle cx="18" cy="18" r="15.5" fill="none" strokeWidth="3.5" className="stroke-white/20" />
          <circle
            cx="18"
            cy="18"
            r="15.5"
            fill="none"
            strokeWidth="3.5"
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={offset}
            strokeLinecap="butt"
            transform="rotate(-90 18 18)"
            className={`${strokeColor} transition-all duration-400`}
          />
        </svg>
      </div>
    </Tooltip>
  );
}
