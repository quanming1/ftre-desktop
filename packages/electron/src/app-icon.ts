import { app, Menu, Tray } from "electron";
import * as fs from "node:fs";
import * as path from "node:path";
import { getMainWindow } from "./app-state";

type IconTarget = "window" | "tray" | "dock";

let tray: Tray | null = null;

function iconCandidates(target: IconTarget): string[] {
  if (target === "window" && process.platform === "win32") {
    return ["ftre.ico", "ftre-logo.png"];
  }
  if (target === "dock" && process.platform === "darwin") {
    return ["ftre.icns", "ftre-logo.png"];
  }
  return ["ftre-logo.png", "ftre.icns", "ftre.ico"];
}

export function resolveAppIconPath(target: IconTarget): string | null {
  const assetsDir = path.join(__dirname, "..", "assets");
  for (const name of iconCandidates(target)) {
    const candidate = path.join(assetsDir, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export function applyDockIcon(): void {
  if (process.platform !== "darwin" || !app.dock) return;
  const iconPath = resolveAppIconPath("dock");
  if (iconPath) app.dock.setIcon(iconPath);
}

export function createTray(): Tray | null {
  if (tray) return tray;
  const iconPath = resolveAppIconPath("tray");
  if (!iconPath) return null;

  tray = new Tray(iconPath);
  tray.setToolTip("ftre");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: "显示窗口",
        click: () => {
          const window = getMainWindow();
          if (!window) return;
          window.show();
          window.focus();
        },
      },
      { type: "separator" },
      { role: "quit", label: "退出 ftre" },
    ]),
  );
  tray.on("click", () => {
    const window = getMainWindow();
    if (!window) return;
    if (window.isVisible()) window.hide();
    else {
      window.show();
      window.focus();
    }
  });
  return tray;
}

export function disposeTray(): void {
  tray?.destroy();
  tray = null;
}
