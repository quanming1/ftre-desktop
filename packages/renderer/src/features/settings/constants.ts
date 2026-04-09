import type { SelectOption } from "@ftre/ui";

export const AVAILABLE_TOOLS: SelectOption[] = [
  // File Operations
  { value: "read", label: "read", group: "File" },
  { value: "write", label: "write", group: "File" },
  { value: "edit", label: "edit", group: "File" },
  { value: "glob", label: "glob", group: "File" },
  { value: "grep", label: "grep", group: "File" },

  // Execution
  { value: "bash", label: "bash", group: "Execution" },
  { value: "task", label: "task", group: "Execution" },

  // Search & Analysis
  { value: "workspace_search", label: "workspace_search", group: "Search" },

  // Communication
  { value: "send_email", label: "send_email", group: "Communication" },
  { value: "check_email", label: "check_email", group: "Communication" },

  // Memory
  { value: "load_skill", label: "load_skill", group: "Memory" },
  { value: "recall", label: "recall", group: "Memory" },
  { value: "read_message", label: "read_message", group: "Memory" },

  // Thinking
  { value: "think", label: "think", group: "Thinking" },
];
