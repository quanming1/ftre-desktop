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
