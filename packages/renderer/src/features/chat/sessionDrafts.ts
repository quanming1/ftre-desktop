/**
 * sessionDrafts — Session 输入框草稿存储
 *
 * 切换 session 时保存/恢复输入框内容；首页（无 session）不保存。
 * 草稿数据格式与 ChatInputEditor.serialize().parts 同形，
 * 可直接传给 ChatInputEditor.setContent() 恢复。
 *
 * 设计为纯数据模块，不依赖 React 或任何 store，可被 UI 组件和 store 共同引用。
 */
const sessionDrafts = new Map<string, Array<{ type: string; text?: string; data?: unknown }>>();

/** 保存指定 session 的输入框草稿 */
export function saveSessionDraft(
  sessionId: string,
  parts: Array<{ type: string; text?: string; data?: unknown }>,
) {
  sessionDrafts.set(sessionId, parts);
}

/** 读取指定 session 的输入框草稿（无草稿返回 undefined） */
export function getSessionDraft(
  sessionId: string,
): Array<{ type: string; text?: string; data?: unknown }> | undefined {
  return sessionDrafts.get(sessionId);
}

/** 删除指定 session 的草稿（session 被删或消息已发送时调用） */
export function deleteSessionDraft(sessionId: string) {
  sessionDrafts.delete(sessionId);
}

/** 检查指定 session 是否有草稿 */
export function hasSessionDraft(sessionId: string): boolean {
  const draft = sessionDrafts.get(sessionId);
  return !!draft && draft.length > 0;
}
