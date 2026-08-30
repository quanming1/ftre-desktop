const DISPLAY_WORDS: Record<string, string> = {
  api: "API",
  cli: "CLI",
  css: "CSS",
  csv: "CSV",
  git: "Git",
  github: "GitHub",
  html: "HTML",
  http: "HTTP",
  https: "HTTPS",
  id: "ID",
  ipc: "IPC",
  json: "JSON",
  llm: "LLM",
  mcp: "MCP",
  md: "MD",
  openai: "OpenAI",
  readme: "README",
  rpc: "RPC",
  sdk: "SDK",
  sql: "SQL",
  ssh: "SSH",
  ts: "TS",
  ui: "UI",
  uri: "URI",
  url: "URL",
  ux: "UX",
  ws: "WS",
  yaml: "YAML",
};

export type SkillOriginKind = "system" | "project" | "agent" | "unknown";

export interface SkillOriginInput {
  /** Explicit origin from a newer Skill API. */
  origin?: string | null;
  /** Backend scope (newer servers may return project/agent/system directly). */
  scope?: string | null;
  /** Stable semantic route or an optional resolved filesystem route. */
  route?: string | null;
  sourcePath?: string | null;
  workspace?: string | null;
}

export interface SkillOrigin {
  kind: SkillOriginKind;
  label: string;
  /** Short label for compact list rows. */
  shortLabel: string;
}

const ORIGIN_LABELS: Record<SkillOriginKind, SkillOrigin> = {
  system: { kind: "system", label: "系统 Skill", shortLabel: "系统" },
  project: { kind: "project", label: "项目 Skill", shortLabel: "项目" },
  agent: { kind: "agent", label: "Agent 私有 Skill", shortLabel: "Agent 私有" },
  unknown: { kind: "unknown", label: "来源未知", shortLabel: "未知来源" },
};

function normalizePath(value: string | null | undefined): string {
  return (value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/\/$/, "")
    .toLowerCase();
}

function isInside(path: string, root: string): boolean {
  return Boolean(path && root) && (path === root || path.startsWith(`${root}/`));
}

/**
 * Resolve the display-only origin of a Skill.
 *
 * The current backend exposes `global/private`; the resolved filesystem path
 * carries the missing distinction between a workspace and an Agent directory.
 * A semantic URI is never treated as a filesystem path and cannot produce a
 * guessed local route.
 */
export function classifySkillOrigin(input: SkillOriginInput): SkillOrigin {
  const explicitOrigin = (input.origin || "").trim().toLowerCase();
  const scope = (input.scope || "").trim().toLowerCase();
  const route = input.route || input.sourcePath || "";
  const sourcePath = normalizePath(input.sourcePath || route);
  const workspace = normalizePath(input.workspace);
  const workspaceSkills = workspace ? `${workspace}/.ftre/skills` : "";

  if (explicitOrigin === "project" || explicitOrigin === "workspace") {
    return ORIGIN_LABELS.project;
  }
  if (explicitOrigin === "agent" || explicitOrigin === "private") {
    return ORIGIN_LABELS.agent;
  }
  if (explicitOrigin === "system" || explicitOrigin === "global") {
    return ORIGIN_LABELS.system;
  }

  // Path is more precise than the legacy private/global flag.
  if (isInside(sourcePath, workspaceSkills)) return ORIGIN_LABELS.project;
  if (/(?:^|\/)\.ftre\/agents(?:\/|$)/.test(sourcePath)) return ORIGIN_LABELS.agent;
  if (scope === "project" || scope === "workspace" || scope.startsWith("workspace:")) {
    return ORIGIN_LABELS.project;
  }
  if (scope === "agent" || scope === "private" || scope.startsWith("agent:")) {
    return ORIGIN_LABELS.agent;
  }
  if (scope === "system" || scope === "global") return ORIGIN_LABELS.system;
  if (/(?:^|\/)\.ftre\/skills(?:\/|$)/.test(sourcePath)) return ORIGIN_LABELS.system;
  return ORIGIN_LABELS.unknown;
}

export function skillOriginLabel(input: SkillOriginInput): string {
  return classifySkillOrigin(input).label;
}

/** Convert a canonical kebab-case Skill id into a display-only title. */
export function formatSkillName(name: string): string {
  return name
    .trim()
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => {
      const lower = word.toLowerCase();
      return DISPLAY_WORDS[lower] ?? `${lower.charAt(0).toUpperCase()}${lower.slice(1)}`;
    })
    .join(" ");
}
