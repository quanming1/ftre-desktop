import { Sun, Moon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  Tooltip,
  TooltipProvider,
} from "@ftre/ui";
import { useTheme, type ThemeMode } from "@/stores/theme";

const MODE_OPTIONS: { mode: ThemeMode; icon: string; label: string }[] = [
  { mode: "light", icon: "☀️", label: "浅色模式" },
  { mode: "dark", icon: "🌙", label: "深色模式" },
  { mode: "system", icon: "💻", label: "跟随系统" },
];

const MODE_LABELS: Record<ThemeMode, string> = {
  light: "浅色",
  dark: "深色",
  system: "跟随系统",
};

function getTooltipText(mode: ThemeMode, resolvedMode: "light" | "dark"): string {
  if (mode === "system") {
    const resolvedLabel = resolvedMode === "dark" ? "深色" : "浅色";
    return `主题：跟随系统 (当前${resolvedLabel})`;
  }
  return `主题：${MODE_LABELS[mode]}`;
}

export function ThemeSwitcher() {
  const mode = useTheme((s) => s.mode);
  const resolvedMode = useTheme((s) => s.resolvedMode);
  const setMode = useTheme((s) => s.setMode);

  const Icon = resolvedMode === "light" ? Sun : Moon;
  const tooltipText = getTooltipText(mode, resolvedMode);

  return (
    <TooltipProvider>
      <DropdownMenu>
        <Tooltip content={tooltipText} side="right">
          <DropdownMenuTrigger asChild>
            <button
              className="flex flex-col items-center gap-1 w-full px-2 py-1.5 rounded-lg transition-colors text-t-dim hover:text-t-muted"
              aria-label={tooltipText}
            >
              <Icon size={24} strokeWidth={1.5} />
              <span className="text-[11px] leading-tight">主题</span>
            </button>
          </DropdownMenuTrigger>
        </Tooltip>
        <DropdownMenuContent side="right" align="end" sideOffset={8}>
          {MODE_OPTIONS.map(({ mode: optionMode, icon, label }) => (
            <DropdownMenuCheckboxItem
              key={optionMode}
              checked={mode === optionMode}
              onCheckedChange={() => setMode(optionMode)}
            >
              <span className="mr-1.5">{icon}</span>
              {label}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </TooltipProvider>
  );
}
