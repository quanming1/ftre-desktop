import { Info, CheckCircle, AlertTriangle, XCircle } from "lucide-react";
import type { NotificationLevel, NotificationStackProps } from "./types";

// ── 级别配置 ───────────────────────────────────────────────────

export const levelConfig: Record<
  NotificationLevel,
  {
    icon: typeof Info;
    borderColor: string;
    iconColor: string;
    label: string;
  }
> = {
  info: {
    icon: Info,
    borderColor: "#58a6ff",
    iconColor: "#58a6ff",
    label: "Info",
  },
  success: {
    icon: CheckCircle,
    borderColor: "#3fb950",
    iconColor: "#3fb950",
    label: "Success",
  },
  warning: {
    icon: AlertTriangle,
    borderColor: "#d29922",
    iconColor: "#d29922",
    label: "Warning",
  },
  error: {
    icon: XCircle,
    borderColor: "#f85149",
    iconColor: "#f85149",
    label: "Error",
  },
};

// ── 位置配置 ───────────────────────────────────────────────────

export const positionClasses: Record<
  NonNullable<NotificationStackProps["position"]>,
  string
> = {
  "bottom-right": "bottom-8 right-6",
  "bottom-left": "bottom-12 left-6",
  "top-right": "top-10 right-6",
  "top-left": "top-10 left-6",
};

// ── 样式常量 ───────────────────────────────────────────────────

export const MAX_VISIBLE = 3;

export const CARD_STYLES = {
  base: "w-[640px] min-h-[80px] flex flex-col gap-3 rounded-lg border p-5 shadow-xl bg-[#1a1b1d] border-[#3c3c3c]",
  message: "text-base text-[#e8e8e8] break-words leading-relaxed",
  closeButton: {
    default: "shrink-0 w-7 h-7 flex items-center justify-center rounded transition-all text-[#888888] hover:text-[#e8e8e8]",
    hovered: "bg-[rgba(255,255,255,0.08)] text-[#e8e8e8]",
  },
  actionButton: "text-sm font-medium px-4 py-2 rounded bg-[#333333] hover:bg-[#3c3c3c] text-[#e8e8e8] transition-colors",
};

export const ANIMATION = {
  entry: { opacity: 0, y: 20, scale: 0.95 },
  exit: { opacity: 0, y: 20, scale: 0.95 },
  spring: { type: "spring" as const, stiffness: 400, damping: 30 },
};
