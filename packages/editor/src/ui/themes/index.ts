export type { FtreThemeDefinition, FtreThemeTokenRule } from "./types";
export { darcula } from "./darcula";
export { ftreNeon } from "./ftre-neon";
export { ftreLight } from "./ftre-light";

import type { FtreThemeDefinition } from "./types";
import { darcula } from "./darcula";
import { ftreNeon } from "./ftre-neon";
import { ftreLight } from "./ftre-light";

const builtinThemes: Record<string, FtreThemeDefinition> = {
  [darcula.id]: darcula,
  [ftreNeon.id]: ftreNeon,
  [ftreLight.id]: ftreLight,
};

let activeThemeId = darcula.id;

export function getTheme(id?: string): FtreThemeDefinition {
  return builtinThemes[id ?? activeThemeId] ?? darcula;
}

export function getActiveThemeId(): string {
  return activeThemeId;
}

export function setActiveThemeId(id: string): void {
  if (builtinThemes[id]) {
    activeThemeId = id;
  }
}

export function registerTheme(theme: FtreThemeDefinition): void {
  builtinThemes[theme.id] = theme;
}

export function getAvailableThemes(): { id: string; label: string }[] {
  return Object.values(builtinThemes).map((t) => ({
    id: t.id,
    label: t.label,
  }));
}

export function getThemeIdForMode(resolved: 'light' | 'dark'): string {
  return resolved === 'light' ? 'ftre-light' : 'ftre-dark';
}
