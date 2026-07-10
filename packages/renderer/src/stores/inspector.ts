/**
 * Inspector Store — 管理右侧扩展面板的内容状态。
 *
 * 面板的显示/隐藏由 layout store 的 panelVisible.inspector 控制。
 * 本 store 只跟踪"展示什么内容"。
 *
 * Tab 类型使用 discriminated union，严格区分 file / diff / image。
 */
import { create } from "zustand";

// ─── Tab 类型（discriminated union）──────────────────────────────

export type InspectorTabType = "file" | "diff" | "image";

/** 所有 tab 共享的基础字段 */
interface TabBase {
  id: string;
  type: InspectorTabType;
  /** 去重 key：tool call ID（per-tool 复用，不是 per-file） */
  toolCallId: string;
  title: string;
  /** 每次复用 tab 时递增，驱动渲染器重新定位 */
  revealNonce: number;
}

/** file tab：文件预览 */
export interface FileTab extends TabBase {
  type: "file";
  filePath: string;
  /** 内容快照（来自 read 工具 metadata），不提供时从磁盘读取 */
  content: string | null;
  /** 跳转到的起始行（read 工具的 start_line） */
  revealLine?: number;
  /** 跳转到的结束行（read 工具的 end_line） */
  revealEndLine?: number;
}

/** diff tab：diff 预览 */
export interface DiffTab extends TabBase {
  type: "diff";
  filePath: string;
  /** 修改前完整内容 */
  before: string;
  /** 修改后完整内容 */
  after: string;
  /** 新增行数 */
  additions: number;
  /** 删除行数 */
  deletions: number;
}

/** image tab：图片预览 */
export interface ImageTab extends TabBase {
  type: "image";
  filePath: string;
}

export type InspectorTab = FileTab | DiffTab | ImageTab;

// ─── Store 接口 ─────────────────────────────────────────────────

export interface InspectorState {
  /** 当前所有 tab */
  tabs: InspectorTab[];
  /** 当前激活的 tab id */
  activeTabId: string | null;
  /** 文件树侧边栏是否展开 */
  fileTreeOpen: boolean;

  /** 打开一个文件预览 tab（同 toolCallId 复用），可选跳转到指定行。content 传入时直接使用，不读磁盘 */
  openFilePreview: (toolCallId: string, path: string, title?: string, revealLine?: number, revealEndLine?: number, content?: string) => void;
  /** 打开一个 diff 预览 tab（同 toolCallId 复用） */
  openDiffPreview: (
    toolCallId: string,
    filePath: string,
    before: string,
    after: string,
    additions: number,
    deletions: number,
    title?: string,
  ) => void;
  /** 打开一个图片预览 tab（同 toolCallId 复用） */
  openImagePreview: (toolCallId: string, path: string, title?: string) => void;
  /** 切换激活 tab */
  setActiveTab: (id: string) => void;
  /** 关闭 tab */
  closeTab: (id: string) => void;
  /** 关闭其他 tab */
  closeOtherTabs: (id: string) => void;
  /** 关闭右侧 tab */
  closeTabsToRight: (id: string) => void;
  /** 关闭全部 tab */
  closeAllTabs: () => void;
  /** 拖拽重排 tab */
  reorderTabs: (fromId: string, toIndex: number) => void;
  /** 切换文件树侧边栏 */
  toggleFileTree: () => void;
  /** wordWrap 开关 */
  wordWrap: boolean;
  toggleWordWrap: () => void;
}

let tabSeq = 0;
function nextId(): string {
  tabSeq += 1;
  return `inspector-tab-${tabSeq}`;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

export const useInspector = create<InspectorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  fileTreeOpen: false,
  wordWrap: true,

  openFilePreview: (toolCallId, path, title, revealLine, revealEndLine, content) => {
    const existing = get().tabs.find(
      (t) => t.toolCallId === toolCallId,
    );
    if (existing && existing.type === "file") {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id && t.type === "file"
            ? { ...t, revealLine, revealEndLine, content: content ?? t.content, revealNonce: t.revealNonce + 1 }
            : t,
        ),
      });
      return;
    }
    const tab: FileTab = {
      id: nextId(),
      type: "file",
      title: title ?? basename(path),
      toolCallId,
      filePath: path,
      content: content ?? null,
      revealLine,
      revealEndLine,
      revealNonce: 0,
    };
    set({
      tabs: [...get().tabs, tab],
      activeTabId: tab.id,
    });
  },

  openDiffPreview: (toolCallId, filePath, before, after, additions, deletions, title) => {
    const existing = get().tabs.find(
      (t) => t.toolCallId === toolCallId,
    );
    if (existing && existing.type === "diff") {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id && t.type === "diff"
            ? { ...t, before, after, additions, deletions, revealNonce: t.revealNonce + 1 }
            : t,
        ),
      });
      return;
    }
    const tab: DiffTab = {
      id: nextId(),
      type: "diff",
      title: title ?? basename(filePath),
      toolCallId,
      filePath,
      before,
      after,
      additions,
      deletions,
      revealNonce: 0,
    };
    set({
      tabs: [...get().tabs, tab],
      activeTabId: tab.id,
    });
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  closeTab: (id) => {
    const tabs = get().tabs.filter((t) => t.id !== id);
    const activeTabId = get().activeTabId === id
      ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null)
      : get().activeTabId;
    set({ tabs, activeTabId });
  },

  closeOtherTabs: (id) => {
    const tabs = get().tabs.filter((t) => t.id === id);
    set({ tabs, activeTabId: tabs.length > 0 ? id : null });
  },

  closeTabsToRight: (id) => {
    const idx = get().tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tabs = get().tabs.slice(0, idx + 1);
    const activeTabId = get().tabs.some((t) => t.id === get().activeTabId && tabs.some((tt) => tt.id === t.id))
      ? get().activeTabId
      : id;
    set({ tabs, activeTabId });
  },

  closeAllTabs: () => set({ tabs: [], activeTabId: null }),

  reorderTabs: (fromId, toIndex) => {
    const tabs = get().tabs;
    const from = tabs.findIndex((t) => t.id === fromId);
    const to = Math.max(0, Math.min(toIndex, tabs.length - 1));
    if (from === -1 || from === to) return;
    const next = [...tabs];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    set({ tabs: next });
  },

  toggleFileTree: () => set((s) => ({ fileTreeOpen: !s.fileTreeOpen })),

  toggleWordWrap: () => set((s) => ({ wordWrap: !s.wordWrap })),

  openImagePreview: (toolCallId, path, title) => {
    const existing = get().tabs.find(
      (t) => t.toolCallId === toolCallId,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: ImageTab = {
      id: nextId(),
      type: "image",
      title: title ?? basename(path),
      toolCallId,
      filePath: path,
      revealNonce: 0,
    };
    set({
      tabs: [...get().tabs, tab],
      activeTabId: tab.id,
    });
  },
}));
