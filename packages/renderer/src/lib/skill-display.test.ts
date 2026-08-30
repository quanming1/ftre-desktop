import { describe, expect, it } from "vitest";
import { classifySkillOrigin, formatSkillName } from "./skill-display";

describe("formatSkillName", () => {
  it("formats kebab-case names without changing the canonical id", () => {
    expect(formatSkillName("refactor-cleanup-audit")).toBe("Refactor Cleanup Audit");
  });

  it("keeps common technical abbreviations readable", () => {
    expect(formatSkillName("mcp-api-review")).toBe("MCP API Review");
  });

  it("handles empty or repeated separators safely", () => {
    expect(formatSkillName("--")).toBe("");
    expect(formatSkillName("  review-code  ")).toBe("Review Code");
  });
});

describe("classifySkillOrigin", () => {
  it("distinguishes a workspace Skill from an Agent private Skill", () => {
    expect(classifySkillOrigin({
      scope: "private",
      sourcePath: "E:/project/.ftre/skills/review-code/SKILL.md",
      workspace: "E:/project",
    })).toMatchObject({ kind: "project", shortLabel: "项目" });
    expect(classifySkillOrigin({
      scope: "private",
      sourcePath: "C:/Users/test/.ftre/agents/coder/skills/review-code/SKILL.md",
      workspace: "E:/project",
    })).toMatchObject({ kind: "agent", shortLabel: "Agent 私有" });
  });

  it("maps legacy global scope to a system Skill", () => {
    expect(classifySkillOrigin({ scope: "global" })).toMatchObject({
      kind: "system",
      label: "系统 Skill",
    });
  });
});
