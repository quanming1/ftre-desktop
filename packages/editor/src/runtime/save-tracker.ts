/**
 * SaveTracker — 追踪最近保存的文件路径
 *
 * 用于区分"自己保存触发的文件变更"和"外部修改触发的文件变更"。
 * 当 watcher 检测到文件变化时，可以通过 `wasRecentlySaved` 判断是否需要刷新内容。
 */

/** 最近保存的文件路径及其时间戳 */
const recentlySaved = new Map<string, number>();

/** 保存记录的过期时间（毫秒） */
const EXPIRY_MS = 2000;

/**
 * 标记文件刚被保存
 * @param filePath 文件路径
 */
export function markSaved(filePath: string): void {
  recentlySaved.set(filePath, Date.now());
}

/**
 * 检查文件是否是最近保存的（由用户自己保存，而非外部修改）
 * 如果是，会自动清除该记录（一次性消费）
 * @param filePath 文件路径
 * @returns 如果文件在过期时间内被保存过，返回 true
 */
export function wasRecentlySaved(filePath: string): boolean {
  const savedAt = recentlySaved.get(filePath);
  if (savedAt === undefined) {
    return false;
  }

  // 清除记录（一次性消费）
  recentlySaved.delete(filePath);

  // 检查是否过期
  return Date.now() - savedAt < EXPIRY_MS;
}

/**
 * 清除所有保存记录（用于测试或重置）
 */
export function clearSaveTracker(): void {
  recentlySaved.clear();
}
