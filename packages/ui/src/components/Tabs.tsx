import * as TabsPrimitive from "@radix-ui/react-tabs";
import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../utils/cn";

export const Tabs = TabsPrimitive.Root;

export const TabsList = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.List>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.List
    ref={ref}
    className={cn(
      "inline-flex items-center gap-1 p-1 rounded-md",
      "bg-[var(--ftre-surface,#1a1b1d)]",
      className,
    )}
    {...props}
  />
));
TabsList.displayName = "TabsList";

export const TabsTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Trigger
    ref={ref}
    className={cn(
      "inline-flex items-center justify-center gap-2 px-3 py-1.5 text-[13px] rounded transition-colors",
      "text-[var(--ftre-text-muted,#aab0b8)]",
      "hover:text-[var(--ftre-text-secondary,#cccccc)]",
      "data-[state=active]:bg-[var(--ftre-elevated,#2d2d2d)] data-[state=active]:text-[var(--ftre-text-primary,#e8e8e8)]",
      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ftre-accent,#00ff88)] focus-visible:ring-offset-1",
      "disabled:pointer-events-none disabled:opacity-50",
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = "TabsTrigger";

export const TabsContent = forwardRef<
  HTMLDivElement,
  ComponentPropsWithoutRef<typeof TabsPrimitive.Content>
>(({ className, ...props }, ref) => (
  <TabsPrimitive.Content
    ref={ref}
    className={cn(
      "mt-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ftre-accent,#00ff88)]",
      className,
    )}
    {...props}
  />
));
TabsContent.displayName = "TabsContent";
