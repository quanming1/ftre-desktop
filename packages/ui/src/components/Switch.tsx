import * as SwitchPrimitive from "@radix-ui/react-switch";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export interface SwitchProps
  extends ComponentPropsWithoutRef<typeof SwitchPrimitive.Root> {
  size?: "sm" | "md";
}

const sizeConfig = {
  sm: {
    root: "h-4 w-7",
    thumb: "h-3 w-3 data-[state=checked]:translate-x-3",
  },
  md: {
    root: "h-5 w-9",
    thumb: "h-4 w-4 data-[state=checked]:translate-x-4",
  },
};

export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(
  ({ className, size = "md", ...props }, ref) => {
    const config = sizeConfig[size];
    return (
      <SwitchPrimitive.Root
        ref={ref}
        className={cn(
          "inline-flex shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ftre-accent,#00ff88)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--ftre-base,#1a1b1d)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          "data-[state=unchecked]:bg-[var(--ftre-border,#3c3c3c)]",
          "data-[state=checked]:bg-[var(--ftre-accent,#00ff88)]",
          config.root,
          className,
        )}
        {...props}
      >
        <SwitchPrimitive.Thumb
          className={cn(
            "pointer-events-none block rounded-full shadow-sm transition-transform",
            "bg-[var(--ftre-text-primary,#e8e8e8)]",
            "data-[state=unchecked]:translate-x-0.5",
            config.thumb,
          )}
        />
      </SwitchPrimitive.Root>
    );
  },
);

Switch.displayName = "Switch";
