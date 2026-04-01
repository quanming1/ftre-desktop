/**
 * 路径工具函数
 */

/**
 * 给工作区路径生成稳定的短 hash，用于 localStorage key 区分不同工作区。
 * 同一路径（不论斜杠方向和尾部斜杠）永远产生相同结果。
 */
export function workspaceHash(rootPath: string): string {
  const normalized = rootPath.replace(/\\/g, "/").replace(/\/+$/, "");
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
