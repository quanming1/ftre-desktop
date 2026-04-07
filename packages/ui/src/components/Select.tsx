import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const Select = SelectPrimitive.Root;
export const SelectGroup = SelectPrimitive.Group;
export const SelectValue = SelectPrimitive.Value;

export const SelectTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Trigger>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Trigger
    ref={ref}
    className={cn(
      "flex h-8 w-full items-center justify-between gap-2 rounded px-3 text-[13px] transition-colors",
      "bg-[var(--ftre-panel,#333333)] text-[var(--ftre-text-primary,#e8e8e8)]",
      "border border-[var(--ftre-border,#3c3c3c)]",
      "placeholder:text-[var(--ftre-text-ghost,#888e98)]",
      "focus:outline-none focus:border-[var(--ftre-accent,#00ff88)] focus:ring-1 focus:ring-[var(--ftre-accent,#00ff88)]",
      "disabled:cursor-not-allowed disabled:opacity-50",
      "[&>span]:truncate",
      className,
    )}
    {...props}
  >
    {children}
    <SelectPrimitive.Icon asChild>
      <ChevronDown size={14} className="shrink-0 text-[var(--ftre-text-ghost,#888e98)]" />
    </SelectPrimitive.Icon>
  </SelectPrimitive.Trigger>
));
SelectTrigger.displayName = "SelectTrigger";

export const SelectScrollUpButton = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollUpButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollUpButton
    ref={ref}
    className={cn(
      "flex items-center justify-center h-6 cursor-default",
      "text-[var(--ftre-text-ghost,#888e98)]",
      className,
    )}
    {...props}
  >
    <ChevronUp size={14} />
  </SelectPrimitive.ScrollUpButton>
));
SelectScrollUpButton.displayName = "SelectScrollUpButton";

export const SelectScrollDownButton = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.ScrollDownButton>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.ScrollDownButton
    ref={ref}
    className={cn(
      "flex items-center justify-center h-6 cursor-default",
      "text-[var(--ftre-text-ghost,#888e98)]",
      className,
    )}
    {...props}
  >
    <ChevronDown size={14} />
  </SelectPrimitive.ScrollDownButton>
));
SelectScrollDownButton.displayName = "SelectScrollDownButton";

export const SelectContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Content>
>(({ className, children, position = "popper", ...props }, ref) => (
  <SelectPrimitive.Portal>
    <SelectPrimitive.Content
      ref={ref}
      position={position}
      className={cn(
        "relative z-[9999] max-h-80 min-w-[8rem] overflow-hidden rounded-md border shadow-lg",
        "bg-[var(--ftre-elevated,#2d2d2d)] border-[var(--ftre-border,#3c3c3c)]",
        "data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        "data-[side=top]:slide-in-from-bottom-2 data-[side=bottom]:slide-in-from-top-2",
        "data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2",
        position === "popper" &&
          "data-[side=top]:translate-y-[-4px] data-[side=bottom]:translate-y-[4px]",
        className,
      )}
      {...props}
    >
      <SelectScrollUpButton />
      <SelectPrimitive.Viewport
        className={cn(
          "py-1.5",
          position === "popper" &&
            "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)]",
        )}
      >
        {children}
      </SelectPrimitive.Viewport>
      <SelectScrollDownButton />
    </SelectPrimitive.Content>
  </SelectPrimitive.Portal>
));
SelectContent.displayName = "SelectContent";

export const SelectLabel = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Label>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Label
    ref={ref}
    className={cn(
      "px-3 py-1.5 text-[12px] font-medium text-[var(--ftre-text-muted,#aab0b8)]",
      className,
    )}
    {...props}
  />
));
SelectLabel.displayName = "SelectLabel";

export const SelectItem = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Item>
>(({ className, children, ...props }, ref) => (
  <SelectPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex w-full items-center pl-8 pr-3 py-2 text-[13px] cursor-pointer select-none outline-none transition-colors",
      "text-[var(--ftre-text-secondary,#cccccc)]",
      "focus:bg-[var(--ftre-accent-dim,rgba(0,255,136,0.12))] focus:text-[var(--ftre-text-primary,#e8e8e8)]",
      "data-[disabled]:opacity-50 data-[disabled]:pointer-events-none",
      className,
    )}
    {...props}
  >
    <span className="absolute left-2.5 flex h-4 w-4 items-center justify-center">
      <SelectPrimitive.ItemIndicator>
        <Check size={14} className="text-[var(--ftre-accent,#00ff88)]" />
      </SelectPrimitive.ItemIndicator>
    </span>
    <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
  </SelectPrimitive.Item>
));
SelectItem.displayName = "SelectItem";

export const SelectSeparator = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof SelectPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <SelectPrimitive.Separator
    ref={ref}
    className={cn("my-1 h-px bg-[var(--ftre-border,#3c3c3c)]", className)}
    {...props}
  />
));
SelectSeparator.displayName = "SelectSeparator";
