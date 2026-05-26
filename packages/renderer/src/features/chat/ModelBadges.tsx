/**
 * ModelBadges — 模型卡片右侧的能力徽章
 *
 * - 上下文窗口：紧凑文字（128K / 1.5M）
 * - 视觉支持：极小图片图标
 * 没有任一字段时整体不渲染。
 *
 * 抽出来给 ModelSelector / ModelPicker 共用。
 */

import { ImageIcon } from "lucide-react";

/** 把 token 数压缩成紧凑文字：128000 → "128K"，1500000 → "1.5M" */
export function formatContext(n: number): string {
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

export interface ModelBadgesProps {
  contextWindow?: number | null;
  vision?: boolean;
}

export function ModelBadges({ contextWindow, vision }: ModelBadgesProps) {
  const showCtx = typeof contextWindow === "number" && contextWindow > 0;
  if (!showCtx && !vision) return null;
  return (
    <span className="flex items-center gap-1 shrink-0 text-t-ghost">
      {showCtx && (
        <span
          title={`上下文 ${contextWindow!.toLocaleString()} tokens`}
          className="px-1 h-[14px] inline-flex items-center text-[9.5px] font-mono leading-none rounded bg-hover/60 tracking-tight"
        >
          {formatContext(contextWindow!)}
        </span>
      )}
      {vision && (
        <span
          title="支持图片输入"
          className="w-[14px] h-[14px] inline-flex items-center justify-center rounded bg-hover/60"
        >
          <ImageIcon size={9} strokeWidth={2} />
        </span>
      )}
    </span>
  );
}
