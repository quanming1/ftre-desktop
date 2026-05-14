import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../utils/cn";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          "h-8 w-full rounded px-3 text-[13px] leading-8 transition-colors duration-150 outline-none",
          "bg-[var(--ftre-panel,#333333)] text-[var(--ftre-text-primary,#e8e8e8)] placeholder:text-[var(--ftre-text-ghost,#888e98)]",
          "border focus:ring-1 focus:ring-offset-0",
          error
            ? "border-[var(--ftre-error,#f85149)] focus:ring-[var(--ftre-error,#f85149)]"
            : "border-[var(--ftre-border,#3c3c3c)] focus:border-[var(--ftre-accent,#00ff88)] focus:ring-[var(--ftre-accent,#00ff88)]",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          className,
        )}
        {...props}
      />
    );
  },
);

Input.displayName = "Input";
