import { describe, it, expect, beforeEach } from "vitest";
import { useEditor, _resetGroupCounter, buildDiffId } from "./editor";
import type { OpenFile, DiffEntry } from "./editor";

// ── helpers ──────────────────────────────────────────────────────────

function makeFile(
  path: string,
  name?: string,
): Omit<OpenFile, "modified" | "pinned"> {
  return {
    path,
    name: name ?? path.split("/").pop()!,
    language: "typescript",
    content: `// ${path}`,
  };
}

function resetStore() {
  _resetGroupCounter();
  useEditor.setState({
    groups: [{ id: "default", openFiles: [], activeFile: null }],
    activeGroupId: "default",
    recentFiles: [],
    openFiles: [],
    activeFile: null,
    pendingDiffs: [],
  });
}

// ── tests ────────────────────────────────────────────────────────────

beforeEach(() => {
  resetStore();
});

describe("editor store — backward compatibility", () => {
  it("openFile adds to default group and syncs top-level", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    const s = useEditor.getState();
    expect(s.openFiles).toHaveLength(1);
    expect(s.openFiles[0].path).toBe("/a.ts");
    expect(s.activeFile).toBe("/a.ts");
    expect(s.groups[0].openFiles).toHaveLength(1);
  });

  it("closeFile removes from default group and syncs top-level", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().closeFile("/b.ts");
    const s = useEditor.getState();
    expect(s.openFiles).toHaveLength(1);
    expect(s.activeFile).toBe("/a.ts");
  });

  it("setActive updates active file in group and top-level", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().setActive("/a.ts");
    expect(useEditor.getState().activeFile).toBe("/a.ts");
    expect(useEditor.getState().groups[0].activeFile).toBe("/a.ts");
  });

  it("updateContent marks file modified in group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().updateContent("/a.ts", "new content");
    const file = useEditor.getState().groups[0].openFiles[0];
    expect(file.content).toBe("new content");
    expect(file.modified).toBe(true);
  });

  it("markSaved clears modified flag in group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().updateContent("/a.ts", "changed");
    useEditor.getState().markSaved("/a.ts");
    expect(useEditor.getState().groups[0].openFiles[0].modified).toBe(false);
  });
});

describe("editor store — splitEditor", () => {
  it("creates a new group with the active file", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().splitEditor();

    const s = useEditor.getState();
    expect(s.groups).toHaveLength(2);
    const newGroup = s.groups[1];
    expect(newGroup.openFiles).toHaveLength(1);
    expect(newGroup.openFiles[0].path).toBe("/b.ts");
    expect(newGroup.activeFile).toBe("/b.ts");
    expect(s.activeGroupId).toBe(newGroup.id);
  });

  it("does nothing when no active file", () => {
    useEditor.getState().splitEditor();
    expect(useEditor.getState().groups).toHaveLength(1);
  });

  it("switches top-level openFiles/activeFile to new group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor();

    const s = useEditor.getState();
    // Top-level now reflects the new active group
    expect(s.openFiles).toHaveLength(1);
    expect(s.openFiles[0].path).toBe("/a.ts");
    expect(s.activeFile).toBe("/a.ts");
  });
});

describe("editor store — closeGroup", () => {
  it("removes a group and switches active group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor();
    const groupId = useEditor.getState().groups[1].id;

    useEditor.getState().closeGroup(groupId);
    const s = useEditor.getState();
    expect(s.groups).toHaveLength(1);
    expect(s.activeGroupId).toBe("default");
  });

  it("does not remove the last group", () => {
    useEditor.getState().closeGroup("default");
    expect(useEditor.getState().groups).toHaveLength(1);
  });

  it("keeps activeGroupId if a different group is closed", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor();
    // activeGroupId is now the new group
    const newGroupId = useEditor.getState().activeGroupId;

    useEditor.getState().closeGroup("default");
    expect(useEditor.getState().activeGroupId).toBe(newGroupId);
    expect(useEditor.getState().groups).toHaveLength(1);
  });
});

describe("editor store — moveTabToGroup", () => {
  it("moves a file from one group to another", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().splitEditor(); // splits /b.ts into new group

    const newGroupId = useEditor.getState().groups[1].id;
    // Move /a.ts from default to new group
    useEditor.getState().moveTabToGroup("/a.ts", "default", newGroupId);

    const s = useEditor.getState();
    const defaultGroup = s.groups.find((g) => g.id === "default")!;
    const newGroup = s.groups.find((g) => g.id === newGroupId)!;

    expect(defaultGroup.openFiles.map((f) => f.path)).toEqual(["/b.ts"]);
    expect(newGroup.openFiles.map((f) => f.path)).toContain("/a.ts");
    expect(newGroup.activeFile).toBe("/a.ts");
  });

  it("activates file in target if already present", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor(); // /a.ts in both groups now

    const newGroupId = useEditor.getState().groups[1].id;
    // Open another file in new group
    useEditor.getState().openFile(makeFile("/b.ts"));

    // Move /a.ts from default to new group (already exists there)
    useEditor.getState().moveTabToGroup("/a.ts", "default", newGroupId);

    const newGroup = useEditor
      .getState()
      .groups.find((g) => g.id === newGroupId)!;
    expect(newGroup.activeFile).toBe("/a.ts");
  });

  it("does nothing for non-existent groups", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().moveTabToGroup("/a.ts", "default", "nonexistent");
    expect(useEditor.getState().groups[0].openFiles).toHaveLength(1);
  });
});

describe("editor store — reorderTabs", () => {
  it("moves a tab from one index to another", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));

    useEditor.getState().reorderTabs("default", 0, 2);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/b.ts", "/c.ts", "/a.ts"]);
  });

  it("moves a tab backward", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));

    useEditor.getState().reorderTabs("default", 2, 0);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/c.ts", "/a.ts", "/b.ts"]);
  });

  it("does nothing for out-of-bounds indices", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().reorderTabs("default", -1, 0);
    useEditor.getState().reorderTabs("default", 0, 5);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });

  it("preserves all elements (no duplicates, no loss)", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().openFile(makeFile("/d.ts"));

    useEditor.getState().reorderTabs("default", 1, 3);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toHaveLength(4);
    expect(new Set(paths).size).toBe(4);
    expect(paths).toContain("/a.ts");
    expect(paths).toContain("/b.ts");
    expect(paths).toContain("/c.ts");
    expect(paths).toContain("/d.ts");
  });

  it("does nothing for non-existent group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().reorderTabs("nonexistent", 0, 0);
    expect(useEditor.getState().groups[0].openFiles).toHaveLength(1);
  });
});

describe("editor store — addRecentFile", () => {
  it("adds a file to the front of recentFiles", () => {
    useEditor.getState().addRecentFile("/a.ts");
    useEditor.getState().addRecentFile("/b.ts");
    expect(useEditor.getState().recentFiles).toEqual(["/b.ts", "/a.ts"]);
  });

  it("removes duplicates and moves to front", () => {
    useEditor.getState().addRecentFile("/a.ts");
    useEditor.getState().addRecentFile("/b.ts");
    useEditor.getState().addRecentFile("/a.ts");
    expect(useEditor.getState().recentFiles).toEqual(["/a.ts", "/b.ts"]);
  });

  it("caps at 20 entries", () => {
    for (let i = 0; i < 25; i++) {
      useEditor.getState().addRecentFile(`/file-${i}.ts`);
    }
    expect(useEditor.getState().recentFiles).toHaveLength(20);
    // Most recent should be first
    expect(useEditor.getState().recentFiles[0]).toBe("/file-24.ts");
  });

  it("keeps the list unique", () => {
    useEditor.getState().addRecentFile("/a.ts");
    useEditor.getState().addRecentFile("/a.ts");
    useEditor.getState().addRecentFile("/a.ts");
    expect(useEditor.getState().recentFiles).toEqual(["/a.ts"]);
  });
});

describe("editor store — handleFileRenamed", () => {
  it("updates path and name of a renamed file in the active group", () => {
    useEditor.getState().openFile(makeFile("/src/a.ts"));
    useEditor.getState().handleFileRenamed("/src/a.ts", "/src/b.ts", false);

    const s = useEditor.getState();
    expect(s.groups[0].openFiles).toHaveLength(1);
    expect(s.groups[0].openFiles[0].path).toBe("/src/b.ts");
    expect(s.groups[0].openFiles[0].name).toBe("b.ts");
    expect(s.groups[0].activeFile).toBe("/src/b.ts");
    expect(s.activeFile).toBe("/src/b.ts");
  });

  it("updates files across multiple groups", () => {
    useEditor.getState().openFile(makeFile("/src/a.ts"));
    useEditor.getState().splitEditor(); // /a.ts now in both groups

    useEditor
      .getState()
      .handleFileRenamed("/src/a.ts", "/src/renamed.ts", false);

    const s = useEditor.getState();
    for (const group of s.groups) {
      expect(group.openFiles[0].path).toBe("/src/renamed.ts");
      expect(group.openFiles[0].name).toBe("renamed.ts");
      expect(group.activeFile).toBe("/src/renamed.ts");
    }
  });

  it("updates all files under a renamed directory", () => {
    useEditor.getState().openFile(makeFile("/project/src/a.ts"));
    useEditor.getState().openFile(makeFile("/project/src/b.ts"));
    useEditor.getState().openFile(makeFile("/other/c.ts"));

    useEditor
      .getState()
      .handleFileRenamed("/project/src", "/project/lib", true);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toContain("/project/lib/a.ts");
    expect(paths).toContain("/project/lib/b.ts");
    expect(paths).toContain("/other/c.ts"); // unaffected
  });

  it("does nothing when no open files match the old path", () => {
    useEditor.getState().openFile(makeFile("/src/a.ts"));
    useEditor
      .getState()
      .handleFileRenamed("/src/nonexistent.ts", "/src/b.ts", false);

    expect(useEditor.getState().groups[0].openFiles[0].path).toBe("/src/a.ts");
  });

  it("updates pendingDiffs for renamed files", () => {
    useEditor.getState().openFile(makeFile("/src/a.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/src/a.ts",
      filePath: "/src/a.ts",
      tabPath: "diff:/src/a.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().handleFileRenamed("/src/a.ts", "/src/b.ts", false);

    expect(useEditor.getState().pendingDiffs[0].filePath).toBe("/src/b.ts");
  });

  it("updates activeFile in top-level state when active file is renamed", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().setActive("/a.ts");

    useEditor.getState().handleFileRenamed("/a.ts", "/renamed.ts", false);

    expect(useEditor.getState().activeFile).toBe("/renamed.ts");
  });
});

describe("editor store — handleFileDeleted", () => {
  it("closes the tab for a deleted file", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().handleFileDeleted("/b.ts", false);

    const s = useEditor.getState();
    expect(s.groups[0].openFiles).toHaveLength(1);
    expect(s.groups[0].openFiles[0].path).toBe("/a.ts");
  });

  it("selects a neighboring tab when the active file is deleted", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().setActive("/b.ts");

    useEditor.getState().handleFileDeleted("/b.ts", false);

    const s = useEditor.getState();
    expect(s.activeFile).not.toBe("/b.ts");
    expect(s.activeFile).toBeTruthy();
  });

  it("sets activeFile to null when the last file is deleted", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().handleFileDeleted("/a.ts", false);

    expect(useEditor.getState().activeFile).toBeNull();
    expect(useEditor.getState().groups[0].openFiles).toHaveLength(0);
  });

  it("closes tabs across multiple groups", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor(); // /a.ts in both groups

    useEditor.getState().handleFileDeleted("/a.ts", false);

    for (const group of useEditor.getState().groups) {
      expect(group.openFiles).toHaveLength(0);
      expect(group.activeFile).toBeNull();
    }
  });

  it("closes all files under a deleted directory", () => {
    useEditor.getState().openFile(makeFile("/project/src/a.ts"));
    useEditor.getState().openFile(makeFile("/project/src/b.ts"));
    useEditor.getState().openFile(makeFile("/other/c.ts"));

    useEditor.getState().handleFileDeleted("/project/src", true);

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/other/c.ts"]);
  });

  it("removes pendingDiffs for deleted files", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/a.ts",
      filePath: "/a.ts",
      tabPath: "diff:/a.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().handleFileDeleted("/a.ts", false);

    expect(useEditor.getState().pendingDiffs).toHaveLength(0);
  });

  it("does nothing when no open files match the deleted path", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().handleFileDeleted("/nonexistent.ts", false);

    expect(useEditor.getState().groups[0].openFiles).toHaveLength(1);
  });

  it("syncs top-level openFiles after deletion", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().handleFileDeleted("/a.ts", false);

    expect(useEditor.getState().openFiles).toHaveLength(1);
    expect(useEditor.getState().openFiles[0].path).toBe("/b.ts");
  });
});

describe("editor store — createUntitledFile", () => {
  it("creates an untitled file with Untitled-1 when no untitled files exist", () => {
    useEditor.getState().createUntitledFile();

    const s = useEditor.getState();
    expect(s.groups[0].openFiles).toHaveLength(1);
    expect(s.groups[0].openFiles[0]).toMatchObject({
      path: "untitled:Untitled-1",
      name: "Untitled-1",
      language: "plaintext",
      content: "",
      modified: false,
    });
    expect(s.groups[0].activeFile).toBe("untitled:Untitled-1");
    expect(s.activeFile).toBe("untitled:Untitled-1");
  });

  it("increments the number for each new untitled file", () => {
    useEditor.getState().createUntitledFile();
    useEditor.getState().createUntitledFile();
    useEditor.getState().createUntitledFile();

    const files = useEditor.getState().groups[0].openFiles;
    expect(files).toHaveLength(3);
    expect(files[0].name).toBe("Untitled-1");
    expect(files[1].name).toBe("Untitled-2");
    expect(files[2].name).toBe("Untitled-3");
  });

  it("finds max number across all groups", () => {
    useEditor.getState().createUntitledFile(); // Untitled-1 in default group
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().splitEditor(); // split /a.ts into new group
    useEditor.getState().createUntitledFile(); // should be Untitled-2 in new group

    const s = useEditor.getState();
    const newGroup = s.groups[1];
    const untitledInNewGroup = newGroup.openFiles.find((f) =>
      f.name.startsWith("Untitled-"),
    );
    expect(untitledInNewGroup?.name).toBe("Untitled-2");
  });

  it("sets the new file as active in the active group", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().createUntitledFile();

    const s = useEditor.getState();
    expect(s.activeFile).toBe("untitled:Untitled-1");
    expect(s.groups[0].activeFile).toBe("untitled:Untitled-1");
  });

  it("handles gaps in numbering by using max + 1", () => {
    useEditor.getState().createUntitledFile(); // Untitled-1
    useEditor.getState().createUntitledFile(); // Untitled-2
    useEditor.getState().createUntitledFile(); // Untitled-3
    useEditor.getState().closeFile("untitled:Untitled-2"); // close middle one
    useEditor.getState().createUntitledFile(); // should be Untitled-4 (max was 3)

    const names = useEditor.getState().groups[0].openFiles.map((f) => f.name);
    expect(names).toContain("Untitled-1");
    expect(names).toContain("Untitled-3");
    expect(names).toContain("Untitled-4");
    expect(names).not.toContain("Untitled-2");
  });
});

describe("buildDiffId", () => {
  it("combines toolId and filePath with colon separator", () => {
    expect(buildDiffId("tool-123", "/src/app.ts")).toBe("tool-123:/src/app.ts");
  });

  it("produces different ids for different toolIds", () => {
    const id1 = buildDiffId("tool-1", "/src/app.ts");
    const id2 = buildDiffId("tool-2", "/src/app.ts");
    expect(id1).not.toBe(id2);
  });

  it("produces different ids for different filePaths", () => {
    const id1 = buildDiffId("tool-1", "/src/a.ts");
    const id2 = buildDiffId("tool-1", "/src/b.ts");
    expect(id1).not.toBe(id2);
  });

  it("handles empty strings", () => {
    expect(buildDiffId("", "")).toBe(":");
    expect(buildDiffId("tool", "")).toBe("tool:");
    expect(buildDiffId("", "/path")).toBe(":/path");
  });
});

describe("editor store — addDiff idempotency", () => {
  function makeDiff(overrides: Partial<DiffEntry> = {}): DiffEntry {
    const filePath = overrides.filePath ?? "/src/a.ts";
    return {
      id: "tool-1:/src/a.ts",
      filePath,
      tabPath: `diff:${filePath}`,
      originalContent: "original",
      newContent: "modified",
      toolName: "edit",
      isApproximate: false,
      ...overrides,
    };
  }

  it("adds a new DiffEntry to pendingDiffs", () => {
    useEditor.getState().addDiff(makeDiff());
    expect(useEditor.getState().pendingDiffs).toHaveLength(1);
    expect(useEditor.getState().pendingDiffs[0].id).toBe("tool-1:/src/a.ts");
  });

  it("does not duplicate a DiffEntry with the same id", () => {
    const diff = makeDiff();
    useEditor.getState().addDiff(diff);
    useEditor.getState().addDiff(diff);
    useEditor.getState().addDiff(diff);
    expect(useEditor.getState().pendingDiffs).toHaveLength(1);
  });

  it("replaces diff when same filePath exists even with same id", () => {
    // 同一 filePath 的新 diff 应该覆盖旧的（因为代表对同一文件的最新修改）
    useEditor.getState().addDiff(makeDiff({ newContent: "v1" }));
    useEditor.getState().addDiff(makeDiff({ newContent: "v2" }));
    expect(useEditor.getState().pendingDiffs).toHaveLength(1);
    expect(useEditor.getState().pendingDiffs[0].newContent).toBe("v2");
  });

  it("replaces existing diff for same filePath but different id", () => {
    useEditor.getState().addDiff(makeDiff({ id: "tool-1:/src/a.ts" }));
    useEditor.getState().addDiff(makeDiff({ id: "tool-2:/src/a.ts" }));
    expect(useEditor.getState().pendingDiffs).toHaveLength(1);
    expect(useEditor.getState().pendingDiffs[0].id).toBe("tool-2:/src/a.ts");
  });

  it("allows multiple diffs for different filePaths", () => {
    useEditor
      .getState()
      .addDiff(makeDiff({ id: "tool-1:/src/a.ts", filePath: "/src/a.ts" }));
    useEditor
      .getState()
      .addDiff(makeDiff({ id: "tool-1:/src/b.ts", filePath: "/src/b.ts" }));
    expect(useEditor.getState().pendingDiffs).toHaveLength(2);
  });

  it("preserves isApproximate field", () => {
    useEditor.getState().addDiff(makeDiff({ isApproximate: true }));
    expect(useEditor.getState().pendingDiffs[0].isApproximate).toBe(true);
  });
});

describe("editor store — closeOtherFiles", () => {
  it("closes all files except the specified one", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));

    useEditor.getState().closeOtherFiles("/b.ts");

    const s = useEditor.getState();
    expect(s.groups[0].openFiles).toHaveLength(1);
    expect(s.groups[0].openFiles[0].path).toBe("/b.ts");
    expect(s.groups[0].activeFile).toBe("/b.ts");
  });

  it("sets the kept file as active even if it was not active before", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().setActive("/a.ts");

    useEditor.getState().closeOtherFiles("/b.ts");

    expect(useEditor.getState().activeFile).toBe("/b.ts");
  });

  it("removes pendingDiffs for closed files", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/a.ts",
      filePath: "/a.ts",
      tabPath: "diff:/a.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().closeOtherFiles("/b.ts");

    expect(useEditor.getState().pendingDiffs).toHaveLength(0);
  });

  it("removes pendingDiffs when diff tab is closed by closeOtherFiles", () => {
    // addDiff 会创建 diff tab (diff:/a.ts)，closeOtherFiles('/a.ts') 会关闭 diff tab
    // 因为 diff:/a.ts !== /a.ts，所以 diff tab 会被关闭，pendingDiff 也会被清理
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/a.ts",
      filePath: "/a.ts",
      tabPath: "diff:/a.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().closeOtherFiles("/a.ts");

    // diff tab 被关闭，所以 pendingDiff 也被清理
    expect(useEditor.getState().pendingDiffs).toHaveLength(0);
  });

  it("syncs top-level state", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));

    useEditor.getState().closeOtherFiles("/b.ts");

    expect(useEditor.getState().openFiles).toHaveLength(1);
    expect(useEditor.getState().openFiles[0].path).toBe("/b.ts");
    expect(useEditor.getState().activeFile).toBe("/b.ts");
  });
});

describe("editor store — closeFilesToRight", () => {
  it("closes all files to the right of the specified file", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().openFile(makeFile("/d.ts"));

    useEditor.getState().closeFilesToRight("/b.ts");

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });

  it("does nothing when the file is the last tab", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().closeFilesToRight("/b.ts");

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/a.ts", "/b.ts"]);
  });

  it("switches active file to the anchor when active was to the right", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    // active is /c.ts (last opened)

    useEditor.getState().closeFilesToRight("/a.ts");

    expect(useEditor.getState().activeFile).toBe("/a.ts");
  });

  it("keeps active file if it is to the left of the anchor", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().setActive("/a.ts");

    useEditor.getState().closeFilesToRight("/b.ts");

    expect(useEditor.getState().activeFile).toBe("/a.ts");
  });

  it("does nothing when the file is not found", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().closeFilesToRight("/nonexistent.ts");

    expect(useEditor.getState().groups[0].openFiles).toHaveLength(2);
  });

  it("removes pendingDiffs for closed files", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/c.ts",
      filePath: "/c.ts",
      tabPath: "diff:/c.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().closeFilesToRight("/a.ts");

    expect(useEditor.getState().pendingDiffs).toHaveLength(0);
  });
});

describe("editor store — closeSavedFiles", () => {
  it("closes all unmodified files", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().updateContent("/b.ts", "changed");

    useEditor.getState().closeSavedFiles();

    const paths = useEditor.getState().groups[0].openFiles.map((f) => f.path);
    expect(paths).toEqual(["/b.ts"]);
  });

  it("does nothing when all files are modified", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().updateContent("/a.ts", "changed");
    useEditor.getState().updateContent("/b.ts", "changed");

    useEditor.getState().closeSavedFiles();

    expect(useEditor.getState().groups[0].openFiles).toHaveLength(2);
  });

  it("closes all files when none are modified", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));

    useEditor.getState().closeSavedFiles();

    expect(useEditor.getState().groups[0].openFiles).toHaveLength(0);
    expect(useEditor.getState().activeFile).toBeNull();
  });

  it("switches active to a modified file when active was unmodified", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().openFile(makeFile("/c.ts"));
    useEditor.getState().updateContent("/a.ts", "changed");
    useEditor.getState().setActive("/b.ts");

    useEditor.getState().closeSavedFiles();

    expect(useEditor.getState().activeFile).toBe("/a.ts");
  });

  it("removes pendingDiffs for closed unmodified files", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().addDiff({
      id: "tool1:/a.ts",
      filePath: "/a.ts",
      tabPath: "diff:/a.ts",
      originalContent: "old",
      newContent: "new",
      toolName: "test",
      isApproximate: false,
    });

    useEditor.getState().closeSavedFiles();

    expect(useEditor.getState().pendingDiffs).toHaveLength(0);
  });

  it("syncs top-level state", () => {
    useEditor.getState().openFile(makeFile("/a.ts"));
    useEditor.getState().openFile(makeFile("/b.ts"));
    useEditor.getState().updateContent("/b.ts", "changed");

    useEditor.getState().closeSavedFiles();

    expect(useEditor.getState().openFiles).toHaveLength(1);
    expect(useEditor.getState().openFiles[0].path).toBe("/b.ts");
  });
});
