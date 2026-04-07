import { cloneElement, isValidElement, type ReactNode, type ReactElement } from "react";
import { cn } from "../utils/cn";

export interface TooltipProps {
  content: ReactNode;
  children: ReactElement;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}

/** Provider 不再需要，保留空壳兼容现有代码 */
export const TooltipProvider = ({ children }: { children: ReactNode }) => (
  <>{children}</>
);

/** 纯 CSS Tooltip，无延迟 */
export function Tooltip({
  content,
  children,
  side = "top",
  className,
}: TooltipProps) {
  const positionClasses = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-1.5",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-1.5",
    left: "right-full top-1/2 -translate-y-1/2 mr-1.5",
    right: "left-full top-1/2 -translate-y-1/2 ml-1.5",
  };

  const arrowClasses = {
    top: "top-full left-1/2 -translate-x-1/2 border-t-[var(--ftre-elevated,#2d2d2d)] border-x-transparent border-b-transparent",
    bottom: "bottom-full left-1/2 -translate-x-1/2 border-b-[var(--ftre-elevated,#2d2d2d)] border-x-transparent border-t-transparent",
    left: "left-full top-1/2 -translate-y-1/2 border-l-[var(--ftre-elevated,#2d2d2d)] border-y-transparent border-r-transparent",
    right: "right-full top-1/2 -translate-y-1/2 border-r-[var(--ftre-elevated,#2d2d2d)] border-y-transparent border-l-transparent",
  };

  const tooltipEl = (
    <span
      className={cn(
        "hidden group-hover/tooltip:block absolute z-[9999] px-2.5 py-1.5 text-[12px] rounded shadow-lg whitespace-nowrap pointer-events-none",
        "bg-[var(--ftre-elevated,#2d2d2d)] text-[var(--ftre-text-primary,#e8e8e8)] border border-[var(--ftre-border,#3c3c3c)]",
        positionClasses[side],
        className,
      )}
    >
      {content}
      <span className={cn("absolute border-4", arrowClasses[side])} />
    </span>
  );

  if (!isValidElement(children)) {
    return <>{children}</>;
  }

  const childProps = children.props as Record<string, unknown>;
  const existingClassName = (childProps.className as string) || "";

  return cloneElement(children, {
    className: cn(existingClassName, "relative group/tooltip"),
    children: (
      <>
        {childProps.children}
        {tooltipEl}
      </>
    ),
  } as Partial<unknown>);
}
