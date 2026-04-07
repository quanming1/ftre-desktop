import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ReactNode } from "react";
import { cn } from "../utils/cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  sideOffset?: number;
  delayDuration?: number;
  className?: string;
}

export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <TooltipPrimitive.Provider delayDuration={0} skipDelayDuration={0}>
    {children}
  </TooltipPrimitive.Provider>
);

export const Tooltip = forwardRef<HTMLButtonElement, TooltipProps>(
  (
    {
      content,
      children,
      side = "top",
      sideOffset = 6,
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
            className={cn(
              "z-[9999] px-2.5 py-1.5 text-[12px] rounded shadow-lg",
              "bg-[var(--ftre-elevated,#2d2d2d)] text-[var(--ftre-text-primary,#e8e8e8)] border border-[var(--ftre-border,#3c3c3c)]",
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
