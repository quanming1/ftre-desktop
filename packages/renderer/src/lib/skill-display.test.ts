import { describe, expect, it } from "vitest";
import { formatSkillName } from "./skill-display";

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
