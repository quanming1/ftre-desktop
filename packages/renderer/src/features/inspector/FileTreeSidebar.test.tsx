/**
 * FileTreeSidebar 树结构刷新回归测试。
 *
 * 背景：树结构（目录条目）此前只在展开时读一次，agent 新建/删除文件后
 * 文件树不更新（git 徽标走 1s 轮询、内容走 mtime 失效，唯独结构不刷）。
 * 修复：对 session workspace 注册 fs.watch（IPC 幂等），订阅 onFileChanged，
 * 防抖聚合后按受影响目录增量刷新（根 → rootEntries；子目录 → dirVersions）。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FileTreeSidebar } from "./FileTreeSidebar";

// ── store mock：组件消费 useSession / useChat / useSessionId / useInspector ──
let mockSession: { session_id: string; workspace: string } | null = null;
let fileChangedCallback: ((path: string) => void) | null = null;
let watchedPaths: string[] = [];
let unwatchedPaths: string[] = [];

vi.mock("@/stores/session", () => ({
  useSession: (selector: (s: unknown) => unknown) =>
    selector({
      sessions: mockSession ? [mockSession] : [],
      allSessions: [],
    }),
}));

vi.mock("@/stores/chat", () => ({
  useChat: (selector: (s: unknown) => unknown) =>
    selector({ pendingWorkspace: null }),
  useSessionId: () => (mockSession ? mockSession.session_id : null),
}));

vi.mock("@/stores/inspector", () => ({
  useInspector: (selector: (s: unknown) => unknown) =>
    selector({ activeTabId: null, tabs: [], openFilePreview: vi.fn(), openImagePreview: vi.fn() }),
}));

vi.mock("@/services/api", () => ({
  fetchAppConfig: vi.fn().mockResolvedValue({ default_workspace: "" }),
}));

vi.mock("@/services/visibility-manager", () => ({
  createManagedPoller: () => () => {},
}));

/** 目录内容：path → 条目列表；可变，测试中途改写以模拟文件新建 */
const dirContents = new Map<
  string,
  Array<{ name: string; path: string; isDir: boolean; ext: string | null }>
>();

/** 等待防抖窗口（实现为 150ms，留余量到 300ms）真实定时器 */
const sleepDebounce = () => new Promise((r) => setTimeout(r, 300));

/** 读取 readDir 被调用的次数（可选过滤目录） */
function readCallCount(dir?: string): number {
  const mock = window.desktop.fs.readDir as unknown as { mock: { calls: unknown[][] } };
  return dir ? mock.mock.calls.filter((c) => c[0] === dir).length : mock.mock.calls.length;
}

beforeEach(() => {
  mockSession = { session_id: "s1", workspace: "E:/proj" };
  fileChangedCallback = null;
  watchedPaths = [];
  unwatchedPaths = [];
  dirContents.clear();
  dirContents.set("E:/proj", [
    { name: "src", path: "E:/proj/src", isDir: true, ext: null },
    { name: "a.ts", path: "E:/proj/a.ts", isDir: false, ext: "ts" },
  ]);
  dirContents.set("E:/proj/src", [
    { name: "main.ts", path: "E:/proj/src/main.ts", isDir: false, ext: "ts" },
  ]);

  window.desktop = {
    fs: {
      readDir: vi.fn(async (dir: string) => ({
        entries: dirContents.get(dir) ?? [],
      })),
      watch: vi.fn(async (p: string) => {
        watchedPaths.push(p);
      }),
      unwatch: vi.fn(async (p: string) => {
        unwatchedPaths.push(p);
      }),
      onFileChanged: (cb: (path: string) => void) => {
        fileChangedCallback = cb;
        return () => {
          fileChangedCallback = null;
        };
      },
    },
    git: {
      poll: vi.fn(async () => ({ changed: false, etag: "e" })),
    },
  } as unknown as typeof window.desktop;
});

function fireFileChange(path: string) {
  fileChangedCallback?.(path);
}

describe("FileTreeSidebar 树结构刷新", () => {
  it("挂载时对 session workspace 注册 watcher 且不 unwatch", async () => {
    render(<FileTreeSidebar />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());

    expect(watchedPaths).toContain("E:/proj");
    expect(unwatchedPaths).toEqual([]);
  });

  it("子目录新增文件：事件防抖后重读该目录，新文件出现", async () => {
    render(<FileTreeSidebar />);
    await waitFor(() => expect(screen.getByText("src")).toBeInTheDocument());
    fireEvent.click(screen.getByText("src")); // 展开 src 触发懒加载
    await waitFor(() => expect(screen.getByText("main.ts")).toBeInTheDocument());
    const srcReadsBefore = readCallCount("E:/proj/src");

    // agent 在 src 下新建文件
    dirContents.get("E:/proj/src")!.push({
      name: "new-file.ts", path: "E:/proj/src/new-file.ts", isDir: false, ext: "ts",
    });
    fireFileChange("E:/proj/src/new-file.ts");
    await waitFor(() => expect(screen.getByText("new-file.ts")).toBeInTheDocument(), {
      timeout: 2000, // 防抖 150ms + readDir
    });
    expect(readCallCount("E:/proj/src")).toBeGreaterThan(srcReadsBefore);
  });

  it("根目录新增文件：事件防抖后重读 rootEntries", async () => {
    render(<FileTreeSidebar />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());

    dirContents.get("E:/proj")!.push({
      name: "root-new.ts", path: "E:/proj/root-new.ts", isDir: false, ext: "ts",
    });
    fireFileChange("E:/proj/root-new.ts");
    await waitFor(() => expect(screen.getByText("root-new.ts")).toBeInTheDocument(), {
      timeout: 2000,
    });
  });

  it("工作区外的事件被忽略", async () => {
    render(<FileTreeSidebar />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    const before = readCallCount();

    fireFileChange("D:/other/file.ts");
    fireFileChange("E:/other-proj/file.ts");
    await sleepDebounce();

    // 只有初始化读取，无新增（允许一个 tick 的渲染余量）
    expect(readCallCount()).toBeLessThanOrEqual(before + 1);
  });

  it(".git 内部变更不触发树刷新（git 状态由轮询负责）", async () => {
    render(<FileTreeSidebar />);
    await waitFor(() => expect(screen.getByText("a.ts")).toBeInTheDocument());
    const before = readCallCount();

    fireFileChange("E:/proj/.git/index");
    await sleepDebounce();

    expect(readCallCount()).toBeLessThanOrEqual(before + 1);
  });
});
