// Basic components
export { Button, type ButtonProps } from "./Button";
export { Input, type InputProps } from "./Input";
export { Tooltip, TooltipProvider, type TooltipProps } from "./Tooltip";

// Dialog
export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "./Dialog";

// Alert Dialog
export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogPortal,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from "./AlertDialog";

// Context Menu (imperative API - for backward compatibility)
export { ContextMenu, type ContextMenuItem, type ContextMenuProps } from "./ContextMenu";

// Context Menu (Radix declarative API)
export {
  ContextMenu as ContextMenuRadix,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem as ContextMenuItemRadix,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
} from "./ContextMenuRadix";

// Dropdown Menu
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./DropdownMenu";

// Select
export {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./Select";

// Switch & Checkbox
export { Switch, type SwitchProps } from "./Switch";
export { Checkbox, type CheckboxProps } from "./Checkbox";

// Tabs
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./Tabs";

// Custom components (not based on Radix)
export { FloatingWindow, type FloatingWindowProps } from "./FloatingWindow";
export { ResizeHandle, type ResizeHandleProps } from "./ResizeHandle";
export { CommandPalette, type CommandItem, type CommandPaletteProps } from "./CommandPalette";
export {
  NotificationStack,
  type NotificationItem,
  type NotificationAction,
  type NotificationStackProps,
} from "./NotificationStack";

// Legacy exports (deprecated, use AlertDialog instead)
export { ConfirmDialog, type DialogButton, type ConfirmDialogProps } from "./ConfirmDialog";

// Diff summary
export {
  DiffSummaryCard,
  type DiffSummaryCardProps,
  type DiffSummaryMeta,
  type DiffSummaryFile,
} from "./diff-summary";

// Error Boundary
export { ErrorBoundary, type ErrorBoundaryProps } from "./ErrorBoundary";
