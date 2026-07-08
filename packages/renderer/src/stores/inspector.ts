/**
 * Inspector Store — 管理右侧扩展面板的内容状态。
 *
 * 面板的显示/隐藏由 layout store 的 panelVisible.inspector 控制。
 * 本 store 只跟踪"展示什么内容"。
 *
 * 面板支持多 tab：
 *   - file:  文件预览（传入绝对路径，面板自行读取）
 *   - diff:  diff 预览（传入修改前后的完整内容 + 增删统计）
 */
import { create } from "zustand";

export type InspectorTabType = "file" | "diff";

export interface InspectorTab {
  id: string;
  type: InspectorTabType;
  title: string;
  /** 去重 key：tool call ID（per-tool 复用，不是 per-file） */
  toolCallId: string;
  /** file 模式：文件绝对路径 */
  filePath: string | null;
  /** file 模式：内容快照（来自 read 工具的 metadata），不提供时从磁盘读取 */
  content: string | null;
  /** diff 模式：修改前完整内容 */
  before: string | null;
  /** diff 模式：修改后完整内容 */
  after: string | null;
  /** diff 模式：新增行数 */
  additions: number;
  /** diff 模式：删除行数 */
  deletions: number;
  /** file 模式：跳转到的起始行（read 工具的 start_line） */
  revealLine?: number;
  /** file 模式：跳转到的结束行（read 工具的 end_line） */
  revealEndLine?: number;
  /** 每次复用 tab 时递增，驱动 FilePreviewContent 重新定位 */
  revealNonce: number;
}

export interface InspectorState {
  /** 当前所有 tab */
  tabs: InspectorTab[];
  /** 当前激活的 tab id */
  activeTabId: string | null;

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

  openFilePreview: (toolCallId, path, title, revealLine, revealEndLine, content) => {
    const existing = get().tabs.find(
      (t) => t.toolCallId === toolCallId,
    );
    if (existing) {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id
            ? { ...t, revealLine, revealEndLine, content: content ?? t.content, revealNonce: t.revealNonce + 1 }
            : t,
        ),
      });
      return;
    }
    const tab: InspectorTab = {
      id: nextId(),
      type: "file",
      title: title ?? basename(path),
      toolCallId,
      filePath: path,
      content: content ?? null,
      before: null,
      after: null,
      additions: 0,
      deletions: 0,
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
    if (existing) {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id
            ? { ...t, before, after, additions, deletions, revealNonce: t.revealNonce + 1 }
            : t,
        ),
      });
      return;
    }
    const tab: InspectorTab = {
      id: nextId(),
      type: "diff",
      title: title ?? basename(filePath),
      toolCallId,
      filePath,
      content: null,
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
}));
