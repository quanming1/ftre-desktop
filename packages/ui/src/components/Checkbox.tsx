import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export interface CheckboxProps
  extends ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root> {
  size?: "sm" | "md";
}

const sizeConfig = {
  sm: { box: "h-3.5 w-3.5 rounded-sm", icon: 10 },
  md: { box: "h-4 w-4 rounded", icon: 12 },
};

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(
  ({ className, size = "md", ...props }, ref) => {
    const config = sizeConfig[size];
    return (
      <CheckboxPrimitive.Root
        ref={ref}
        className={cn(
          "shrink-0 border transition-colors",
          "border-[var(--ftre-border,#3c3c3c)]",
          "data-[state=unchecked]:bg-transparent",
          "data-[state=checked]:bg-[var(--ftre-accent,#00ff88)] data-[state=checked]:border-[var(--ftre-accent,#00ff88)]",
          "data-[state=indeterminate]:bg-[var(--ftre-accent,#00ff88)] data-[state=indeterminate]:border-[var(--ftre-accent,#00ff88)]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ftre-accent,#00ff88)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--ftre-base,#1e1e1e)]",
          "disabled:cursor-not-allowed disabled:opacity-50",
          config.box,
          className,
        )}
        {...props}
      >
        <CheckboxPrimitive.Indicator className="flex items-center justify-center text-[var(--ftre-base,#1e1e1e)]">
          {props.checked === "indeterminate" ? (
            <Minus size={config.icon} strokeWidth={3} />
          ) : (
            <Check size={config.icon} strokeWidth={3} />
          )}
        </CheckboxPrimitive.Indicator>
      </CheckboxPrimitive.Root>
    );
  },
);

Checkbox.displayName = "Checkbox";
