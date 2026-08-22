/**
 * Inspector Store — 管理右侧扩展面板的内容状态。
 *
 * 面板的显示/隐藏由 layout store 的 panelVisible.inspector 控制。
 * 本 store 只跟踪"展示什么内容"。
 *
 * Tab 类型使用 discriminated union，严格区分 file / diff / image / terminal / audit。
 */
import { create } from "zustand";
import { filePreviewCache } from "@/features/inspector/filePreviewCache";

export const INSPECTOR_SESSION_STATE_TAB_ID = "inspector-session-state";
export const INSPECTOR_TRACE_TAB_ID = "inspector-traces";
/** 固定的 WebSocket 审计日志入口，不参与可关闭文件 Tab 的生命周期。 */
export const INSPECTOR_WS_LOG_TAB_ID = "inspector-ws-logs";
/** 可关闭的终端入口前缀；每个 PTY 实例对应一个独立 Inspector Tab。 */
export const INSPECTOR_TERMINAL_TAB_ID = "inspector-terminal";
/** 审阅 Tab 的 ID 前缀；实际唯一性由工作区和审阅范围共同决定。 */
export const INSPECTOR_AUDIT_TAB_ID = "inspector-audit";

// ─── localStorage 持久化（全局偏好）─────────────────────────────

const PREFS_KEY = "ftre-inspector-prefs";

interface InspectorPrefs {
  wordWrap: boolean;
  renderSideBySide: boolean;
  showDiffOnly: boolean;
}

function loadPrefs(): Partial<InspectorPrefs> {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    if (raw) return JSON.parse(raw) as Partial<InspectorPrefs>;
  } catch {
    // localStorage 不可用或解析失败
  }
  return {};
}

function savePrefs(prefs: InspectorPrefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage 写入失败
  }
}

const initialPrefs = loadPrefs();

// ─── Tab 类型（discriminated union）──────────────────────────────

export type InspectorTabType = "file" | "diff" | "image" | "terminal" | "audit";

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

/** terminal tab：绑定一个独立的 TerminalManager/PTY 实例。 */
export interface TerminalTab extends TabBase {
  type: "terminal";
  terminalId: string;
}

export interface AuditFileChange {
  toolCallId: string;
  filePath: string;
  operation: "edit" | "write";
  additions: number;
  deletions: number;
  before: string;
  after: string;
}

export type AuditScope = "workspace" | "turn";

export interface AuditOpenOptions {
  /** workspace = 工作区当前变更；turn = 某一轮工具修改快照。 */
  scope?: AuditScope;
  /** 轮次的稳定身份；历史消息使用 message.id，运行中使用 session + 当前 user message.id。 */
  turnId?: string;
  /** scope=turn 时携带的本轮文件修改快照。 */
  turnChanges?: AuditFileChange[];
}

/** audit tab：按工作区隔离，工作区审阅和轮次审阅可以并存。 */
export interface AuditTab extends TabBase {
  type: "audit";
  /** 工作区当前变更，或某一轮工具修改所属的工作区。 */
  workspacePath: string;
  /** workspace / turn；旧状态没有该字段时由渲染器兼容判断。 */
  scope: AuditScope;
  /** 用于按工作区 + 轮次复用的稳定 key。 */
  auditKey: string;
  /** scope=turn 时的轮次身份。 */
  turnId?: string;
  /** 从运行详情或消息卡片进入时携带的精确工具变更快照。 */
  turnChanges?: AuditFileChange[];
}

export type InspectorTab = FileTab | DiffTab | ImageTab | TerminalTab | AuditTab;

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
  /** 打开或激活指定 PTY 对应的终端 Tab */
  openTerminalTab: (terminalId: string, title: string) => void;
  /** 打开或激活按工作区/轮次唯一的审阅 Tab */
  openAuditTab: (workspacePath: string, options?: AuditOpenOptions) => void;
  /** 只激活已有的工作区审阅 Tab；不会因为新建会话而凭空创建审阅页。 */
  activateWorkspaceAudit: (workspacePath: string) => boolean;
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
  /** 分栏视图开关（diff） */
  renderSideBySide: boolean;
  toggleSideBySide: () => void;
  /** 只看变更行开关（diff） */
  showDiffOnly: boolean;
  toggleDiffOnly: () => void;
}

let tabSeq = 0;
function nextId(): string {
  tabSeq += 1;
  return `inspector-tab-${tabSeq}`;
}

function basename(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? path;
}

function normalizeWorkspacePath(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (!normalized) return "";
  // 保留 Windows 根目录的末尾斜杠，其他路径去掉末尾斜杠，避免同一工作区产生两个 Tab。
  if (/^[A-Za-z]:\/$/.test(normalized) || normalized === "/") return normalized;
  return normalized.replace(/\/+$/, "");
}

function workspaceKey(path: string): string {
  return normalizeWorkspacePath(path).toLowerCase();
}

function workspaceName(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (!normalized) return "未设置工作区";
  const name = basename(normalized.replace(/\/$/, ""));
  return name || normalized;
}

function auditScopeFor(options?: AuditOpenOptions): AuditScope {
  return options?.scope ?? (options?.turnChanges ? "turn" : "workspace");
}

function auditTurnId(options: AuditOpenOptions | undefined, changes: AuditFileChange[] | undefined): string | undefined {
  if (options?.turnId) return options.turnId;
  if (!changes?.length) return undefined;
  // 兼容没有显式 turnId 的调用方；工具调用 ID 在同一轮内稳定且足以区分轮次。
  return changes.map((change) => change.toolCallId).sort().join(",");
}

function auditIdentity(path: string, scope: AuditScope, turnId?: string): string {
  const base = `${scope}:${workspaceKey(path)}`;
  return scope === "turn" ? `${base}:turn:${turnId ?? "unknown"}` : base;
}

function auditTabId(identity: string): string {
  let hash = 0;
  for (let index = 0; index < identity.length; index++) {
    hash = ((hash << 5) - hash + identity.charCodeAt(index)) | 0;
  }
  return `${INSPECTOR_AUDIT_TAB_ID}-${Math.abs(hash).toString(36)}`;
}

export const useInspector = create<InspectorState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  fileTreeOpen: false,
  wordWrap: initialPrefs.wordWrap ?? true,
  renderSideBySide: initialPrefs.renderSideBySide ?? false,
  showDiffOnly: initialPrefs.showDiffOnly ?? false,

  openFilePreview: (toolCallId, path, title, revealLine, revealEndLine, content) => {
    const existing = get().tabs.find(
      (t) => t.toolCallId === toolCallId,
    );
    if (existing && existing.type === "file") {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((t) =>
          t.id === existing.id && t.type === "file"
            ? { ...t, revealLine, revealEndLine, content: content ?? null, revealNonce: t.revealNonce + 1 }
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

  openTerminalTab: (terminalId, title) => {
    const existing = get().tabs.find(
      (tab) => tab.type === "terminal" && tab.terminalId === terminalId,
    );
    if (existing) {
      set({ activeTabId: existing.id });
      return;
    }
    const tab: TerminalTab = {
      id: `${INSPECTOR_TERMINAL_TAB_ID}-${terminalId}`,
      type: "terminal",
      title,
      toolCallId: `${INSPECTOR_TERMINAL_TAB_ID}-${terminalId}`,
      revealNonce: 0,
      terminalId,
    };
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
  },

  openAuditTab: (workspacePath, options) => {
    const normalizedWorkspace = normalizeWorkspacePath(workspacePath);
    const scope = auditScopeFor(options);
    const turnChanges = options?.turnChanges;
    const turnId = scope === "turn" ? auditTurnId(options, turnChanges) : undefined;
    const identity = auditIdentity(normalizedWorkspace, scope, turnId);
    const existing = get().tabs.find((tab) => tab.type === "audit" && tab.auditKey === identity);
    if (existing && existing.type === "audit") {
      set({
        activeTabId: existing.id,
        tabs: get().tabs.map((tab) => (
          tab.id === existing.id && tab.type === "audit"
            ? {
              ...tab,
              workspacePath: normalizedWorkspace,
              scope,
              auditKey: identity,
              turnId,
              turnChanges,
              title: `${workspaceName(normalizedWorkspace)} · 审阅`,
              revealNonce: tab.revealNonce + 1,
            }
            : tab
        )),
      });
      return;
    }

    const tab: AuditTab = {
      id: auditTabId(identity),
      type: "audit",
      title: `${workspaceName(normalizedWorkspace)} · 审阅`,
      toolCallId: identity,
      workspacePath: normalizedWorkspace,
      scope,
      auditKey: identity,
      turnId,
      turnChanges,
      revealNonce: 0,
    };
    set({ tabs: [...get().tabs, tab], activeTabId: tab.id });
  },

  activateWorkspaceAudit: (workspacePath) => {
    const identity = auditIdentity(normalizeWorkspacePath(workspacePath), "workspace");
    const existing = get().tabs.find((tab) => tab.type === "audit" && tab.auditKey === identity);
    if (!existing) return false;
    set({ activeTabId: existing.id });
    return true;
  },

  closeTab: (id) => {
    const closing = get().tabs.find((t) => t.id === id);
    if (closing?.type === "file") {
      filePreviewCache.delete(closing.filePath);
    }
    const tabs = get().tabs.filter((t) => t.id !== id);
    const activeTabId = get().activeTabId === id
      ? (tabs.length > 0 ? tabs[tabs.length - 1].id : null)
      : get().activeTabId;
    set({ tabs, activeTabId });
  },

  closeOtherTabs: (id) => {
    const removed = get().tabs.filter((t) => t.id !== id);
    removed.forEach((t) => { if (t.type === "file") filePreviewCache.delete(t.filePath); });
    const tabs = get().tabs.filter((t) => t.id === id);
    set({ tabs, activeTabId: tabs.length > 0 ? id : null });
  },

  closeTabsToRight: (id) => {
    const idx = get().tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const removed = get().tabs.slice(idx + 1);
    removed.forEach((t) => { if (t.type === "file") filePreviewCache.delete(t.filePath); });
    const tabs = get().tabs.slice(0, idx + 1);
    const activeTabId = get().tabs.some((t) => t.id === get().activeTabId && tabs.some((tt) => tt.id === t.id))
      ? get().activeTabId
      : id;
    set({ tabs, activeTabId });
  },

  closeAllTabs: () => {
    get().tabs.forEach((t) => { if (t.type === "file") filePreviewCache.delete(t.filePath); });
    set({ tabs: [], activeTabId: null });
  },

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

  toggleWordWrap: () => {
    set((s) => ({ wordWrap: !s.wordWrap }));
    savePrefs({ wordWrap: get().wordWrap, renderSideBySide: get().renderSideBySide, showDiffOnly: get().showDiffOnly });
  },

  toggleSideBySide: () => {
    set((s) => ({ renderSideBySide: !s.renderSideBySide }));
    savePrefs({ wordWrap: get().wordWrap, renderSideBySide: get().renderSideBySide, showDiffOnly: get().showDiffOnly });
  },

  toggleDiffOnly: () => {
    set((s) => ({ showDiffOnly: !s.showDiffOnly }));
    savePrefs({ wordWrap: get().wordWrap, renderSideBySide: get().renderSideBySide, showDiffOnly: get().showDiffOnly });
  },

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
