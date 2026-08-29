import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  /** 沿侧轴的对齐：side="right" 时 start 即浮窗顶部与触发元素顶部对齐。 */
  align?: "start" | "center" | "end";
  alignOffset?: number;
  delayDuration?: number;
  className?: string;
}

export const TooltipProvider = TooltipPrimitive.Provider;

export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(
  (
    {
      content,
      children,
      side = "top",
      sideOffset = 6,
      align,
      alignOffset,
      delayDuration = 0,
      className,
    },
    ref,
  ) => {
    return (
      <TooltipPrimitive.Root delayDuration={delayDuration}>
        <TooltipPrimitive.Trigger ref={ref} asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={sideOffset}
            align={align}
            alignOffset={alignOffset}
            className={cn(
              "z-[9999] rounded-lg border border-black/[0.08] bg-white px-2.5 py-1.5 text-[12px] text-[#1f2937] shadow-[0_8px_24px_rgba(15,23,42,0.14)]",
              "animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95",
              "data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
              className,
            )}
          >
            {content}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    );
  },
);

Tooltip.displayName = "Tooltip";
