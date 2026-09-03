import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { parseFtreTokens, parseFtreUri, serializeFtreRef, SkillReferenceCard } from "./ftre-extensions";
import { useInspector } from "@/stores/inspector";

const fetchSkillMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/api", () => ({ fetchSkill: fetchSkillMock }));

describe("ftre inline extensions", () => {
  it("parses and serializes the canonical skill token", () => {
    const src = "ftre://v1/skill/review-code?path=src&note=%E4%B8%AD%E6%96%87";
    const ref = parseFtreUri(src, "ftre:skill");
    expect(ref).toMatchObject({
      version: "v1",
      type: "skill",
      name: "review-code",
      args: { path: "src", note: "中文" },
    });
    expect(serializeFtreRef(ref!)).toBe(
      "![ftre:skill](ftre://v1/skill/review-code?note=%E4%B8%AD%E6%96%87&path=src)",
    );
  });

  it("splits ordinary text and extension tokens without treating unknown text as an image", () => {
    const parts = parseFtreTokens(
      "before ![ftre:skill](ftre://v1/skill/lint) after",
    );
    expect(parts).toHaveLength(3);
    expect(parts[1].ref?.name).toBe("lint");
    expect(parts[0].text).toBe("before ");
    expect(parts[2].text).toBe(" after");
  });

  it("recognizes a bare Skill URI copied from a rendered message", () => {
    const parts = parseFtreTokens("before ftre://v1/skill/review-code?path=src after");
    expect(parts).toHaveLength(3);
    expect(parts[1].ref).toMatchObject({
      type: "skill",
      name: "review-code",
      args: { path: "src" },
    });
  });

  it("renders a link-like skill and opens its SKILL.md in the inspector", async () => {
    useInspector.setState({ tabs: [], activeTabId: null });
    fetchSkillMock.mockResolvedValueOnce({
      skill: {
        id: "review-code",
        name: "review-code",
        description: "Review a change",
        kind: "dir",
        updated_at: 0,
        content: "---\nname: review-code\n---\nCheck the diff.",
      },
    });

    render(
      <SkillReferenceCard
        ref={{ version: "v1", type: "skill", name: "review-code", args: {}, raw: "" }}
        offsetTop
      />,
    );

    const trigger = screen.getByRole("button", { name: "打开 Skill：Review Code" });
    expect(trigger).toHaveClass("font-bold", "leading-[inherit]", "text-emerald-700", "hover:underline");
    expect(trigger.querySelector("svg")).toHaveClass("lucide-box", "top-px");
    expect(trigger.parentElement).toHaveClass("align-baseline", "-top-px");

    fireEvent.click(trigger);

    await waitFor(() => expect(useInspector.getState().activeTabId).not.toBeNull());
    expect(fetchSkillMock).toHaveBeenCalledWith("review-code", "default", null);
    expect(useInspector.getState().tabs[0]).toMatchObject({
      type: "file",
      title: "SKILL.md",
      filePath: "ftre://v1/skill/review-code/SKILL.md",
      content: "---\nname: review-code\n---\nCheck the diff.",
    });
  });

  it("uses the resolved filesystem source so the preview can browse the Skill directory", async () => {
    useInspector.setState({ tabs: [], activeTabId: null });
    fetchSkillMock.mockResolvedValueOnce({
      skill: {
        id: "workspace-skill",
        name: "workspace-skill",
        uri: "ftre://v1/skill/workspace-skill",
        description: "Workspace skill",
        kind: "dir",
        updated_at: 1,
        content: "# Workspace skill",
        media_type: "text/markdown",
        revision: "mtime:1.000000",
        source: { kind: "filesystem", path: "E:/project/.ftre/skills/workspace-skill/SKILL.md" },
        capabilities: { read: true, browse: true, write: false },
      },
    });

    render(
      <SkillReferenceCard
        ref={{ version: "v1", type: "skill", name: "workspace-skill", args: {}, raw: "" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开 Skill：Workspace Skill" }));

    await waitFor(() => expect(useInspector.getState().activeTabId).not.toBeNull());
    expect(useInspector.getState().tabs[0]).toMatchObject({
      type: "file",
      filePath: "E:/project/.ftre/skills/workspace-skill/SKILL.md",
    });
  });

  it("shows Skill origin, command and route in the preview tooltip", async () => {
    useInspector.setState({ tabs: [], activeTabId: null });
    fetchSkillMock.mockClear();
    fetchSkillMock.mockResolvedValueOnce({
      skill: {
        id: "project-review",
        name: "project-review",
        uri: "ftre://v1/skill/project-review",
        description: "Review a change",
        kind: "dir",
        scope: "project",
        route: "ftre://v1/skill/project-review",
        updated_at: 0,
        content: "# Review",
        source: { kind: "filesystem", path: "E:/project/.ftre/skills/review-code/SKILL.md" },
        capabilities: { read: true, browse: true, write: false },
      },
    });

    render(
      <SkillReferenceCard
        ref={{ version: "v1", type: "skill", name: "project-review", args: {}, raw: "" }}
      />,
    );
    const trigger = screen.getByRole("button", { name: "打开 Skill：Project Review" });
    fireEvent.focus(trigger);

    await waitFor(() => expect(fetchSkillMock).toHaveBeenCalled());
    expect((await screen.findAllByText("项目 Skill")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Command").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Route").length).toBeGreaterThan(0);
  });
});
