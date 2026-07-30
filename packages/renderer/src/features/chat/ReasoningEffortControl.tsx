import { Zap } from "lucide-react";

const EFFORT_LABELS: Record<string, string> = {
  "": "默认",
  none: "关闭",
  minimal: "极低",
  low: "低",
  medium: "中等",
  high: "高级",
  xhigh: "超高",
  max: "最大",
};

function getEffortLabel(value: string): string {
  return EFFORT_LABELS[value] ?? value;
}

export function ReasoningEffortControl({
  values,
  value,
  onChange,
}: {
  values: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  const effortValues = values.includes("") ? values : ["", ...values];
  const activeIndex = Math.max(0, effortValues.indexOf(value));
  const activeValue = effortValues[activeIndex] ?? "";
  const activeLabel = getEffortLabel(activeValue);
  const progress = effortValues.length > 1 ? (activeIndex / (effortValues.length - 1)) * 100 : 0;

  const selectIndex = (nextIndex: number) => {
    const nextValue = effortValues[nextIndex];
    if (nextValue !== undefined && nextValue !== activeValue) {
      onChange(nextValue);
    }
  };

  return (
    <div className="rounded-[14px] border border-border-subtle bg-surface px-3 py-2.5 shadow-[0_8px_20px_rgba(15,23,42,0.06)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="text-[12px] font-medium text-t-secondary">{activeLabel}</span>
          <span className="text-[12px] text-t-ghost">›</span>
        </div>
        <Zap
          size={15}
          strokeWidth={2.4}
          className="shrink-0 text-warning"
          aria-label="推理强度"
        />
      </div>

      <div className="relative mt-3 h-6">
        <div className="absolute left-0 right-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-panel" />
        <div
          className="absolute left-0 top-1/2 h-5 -translate-y-1/2 rounded-full bg-warning/75 transition-[width] duration-150"
          style={{ width: `${progress}%` }}
        />
        <div className="absolute inset-x-1.5 top-1/2 flex -translate-y-1/2 items-center justify-between">
          {effortValues.map((effort, index) => (
            <span
              key={`${effort}-${index}`}
              className={`h-1 w-1 rounded-full ${index <= activeIndex ? "bg-surface/75" : "bg-t-ghost/55"}`}
            />
          ))}
        </div>
        <input
          type="range"
          min="0"
          max={Math.max(0, effortValues.length - 1)}
          step="1"
          value={activeIndex}
          aria-label={`推理强度：${activeLabel}`}
          aria-valuetext={activeLabel}
          onChange={(event) => selectIndex(Number(event.target.value))}
          className="reasoning-effort-range absolute inset-0 z-10 h-6 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
    </div>
  );
}
