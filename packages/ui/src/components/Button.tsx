import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "../utils/cn";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
  asChild?: boolean;
}

const variantClasses = {
  primary:
    "bg-[var(--ftre-accent,#00ff88)] text-[var(--ftre-base,#1e1e1e)] hover:bg-[var(--ftre-accent-hover,#00cc6e)] font-medium",
  secondary:
    "bg-[var(--ftre-panel,#333333)] text-[var(--ftre-text-primary,#e8e8e8)] border border-[var(--ftre-border,#3c3c3c)] hover:bg-[var(--ftre-border,#3c3c3c)]",
  ghost:
    "bg-transparent text-[var(--ftre-text-secondary,#cccccc)] hover:bg-[var(--ftre-accent-ghost,rgba(0,255,136,0.06))] hover:text-[var(--ftre-text-primary,#e8e8e8)]",
  danger:
    "bg-[var(--ftre-error,#f85149)] text-[var(--ftre-text-primary,#e8e8e8)] hover:bg-[#e5443b]",
};

const sizeClasses = {
  sm: "h-7 px-3 text-[12px] rounded",
  md: "h-8 px-4 text-[13px] rounded",
  lg: "h-9 px-5 text-[14px] rounded-md",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      className,
      variant = "secondary",
      size = "md",
      asChild = false,
      disabled,
      ...props
    },
    ref,
  ) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        disabled={disabled}
        className={cn(
          "inline-flex items-center justify-center gap-2 shrink-0 transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--ftre-accent,#00ff88)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--ftre-base,#1e1e1e)]",
          "disabled:opacity-50 disabled:cursor-not-allowed disabled:pointer-events-none",
          variantClasses[variant],
          sizeClasses[size],
          className,
        )}
        {...props}
      />
    );
  },
);

Button.displayName = "Button";
