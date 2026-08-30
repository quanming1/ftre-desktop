import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ContentBlock, ToolResult } from "@/stores/chat";

const fetchSkillMock = vi.hoisted(() => vi.fn().mockResolvedValue({
  skill: {
    id: "refactor-cleanup-audit",
    name: "refactor-cleanup-audit",
    uri: "ftre://v1/skill/refactor-cleanup-audit",
    description: "Audit a refactor",
    kind: "dir",
    scope: "global",
    updated_at: 0,
    content: "# Refactor Cleanup Audit",
    media_type: "text/markdown",
    revision: "sha256:test",
    source: { kind: "filesystem", path: "E:/skills/refactor-cleanup-audit/SKILL.md" },
    capabilities: { read: true, browse: true, write: false },
  },
}));

vi.mock("@/services/api", async () => {
  const actual = await vi.importActual<typeof import("@/services/api")>("@/services/api");
  return { ...actual, fetchSkill: fetchSkillMock };
});

import { InlineToolCallCard } from "./InlineToolCallCard";

describe("InlineToolCallCard loadSkill", () => {
  it("renders the real Skill name through the shared Skill UI", async () => {
    const block: Extract<ContentBlock, { type: "toolCall" }> = {
      type: "toolCall",
      id: "load-skill-1",
      name: "loadSkill",
      arguments: { name: "refactor-cleanup-audit" },
    };
    const result: ToolResult = {
      id: block.id,
      name: block.name,
      result: "<skill_content><skill_name>refactor-cleanup-audit</skill_name></skill_content>",
      error: null,
      status: "completed",
    };

    render(<InlineToolCallCard block={block} result={result} />);

    expect(screen.getByText("Load Skill")).toBeInTheDocument();
    const skillButton = screen.getByRole("button", { name: "打开 Skill：Refactor Cleanup Audit" });
    expect(skillButton).toBeInTheDocument();
    expect(screen.queryByText("<Skill>")).not.toBeInTheDocument();

    fireEvent.pointerEnter(skillButton);
    await waitFor(() => expect(fetchSkillMock).toHaveBeenCalledWith(
      "refactor-cleanup-audit",
      "default",
      null,
    ));
  });
});
