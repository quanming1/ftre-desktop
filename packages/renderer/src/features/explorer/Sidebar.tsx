import { useLayout } from "@/stores/layout";
import { useWorkspace } from "@/stores/workspace";
import { ExplorerView } from "./ExplorerView";
import { GitPanel } from "@/features/git/GitPanel";
import { ExtensionsPanel } from "@/features/extensions/ExtensionsPanel";

export function Sidebar() {
  const activeSidebarView = useLayout((s) => s.activeSidebarView);
  const rootPath = useWorkspace((s) => s.rootPath);

  if (!activeSidebarView) return null;

  return (
    <div className="h-full bg-[#f6f7f9] flex flex-col overflow-hidden border-r border-border">
      {activeSidebarView === "explorer" && <ExplorerView key={rootPath} />}
      {activeSidebarView === "git" && <GitPanel key={rootPath} />}
      {activeSidebarView === "extensions" && <ExtensionsPanel />}
    </div>
  );
}
