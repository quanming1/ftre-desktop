import { PanelRight } from "lucide-react";
import { Tooltip } from "@ftre/ui";
import { useLayout } from "@/stores/layout";

interface InspectorVisibilityButtonProps {
  /** Header 入口只在 Inspector 关闭时显示；面板内部入口不传此参数。 */
  onlyWhenHidden?: boolean;
  className?: string;
}

/** Inspector 的唯一显示/隐藏入口，供 Chat Header 与面板内部复用。 */
export function InspectorVisibilityButton({
  onlyWhenHidden = false,
  className = "",
}: InspectorVisibilityButtonProps) {
  const inspectorVisible = useLayout((state) => state.panelVisible.inspector);
  const togglePanelVisible = useLayout((state) => state.togglePanelVisible);

  if (onlyWhenHidden && inspectorVisible) return null;

  const label = inspectorVisible ? "隐藏侧面板" : "显示侧面板";
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={inspectorVisible}
        onClick={() => togglePanelVisible("inspector")}
        className={`relative flex h-8 w-8 items-center justify-center rounded-md transition-colors duration-150 ${
          inspectorVisible
            ? "bg-black/[0.06] text-t-primary"
            : "text-t-muted hover:bg-black/[0.04] hover:text-t-primary"
        } ${className}`}
      >
        <PanelRight size={15} strokeWidth={1.6} />
      </button>
    </Tooltip>
  );
}
