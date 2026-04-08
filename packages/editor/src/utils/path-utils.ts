/**
 * 路径工具函数
 */

/**
 * 将路径规范化用于比较（统一斜杠方向、去掉尾部斜杠、Windows盘符小写）。
 * 确保 E:\path 和 e:\path 被视为相同路径。
 */
function normalizePathForCompare(p: string): string {
  let normalized = p.replace(/\\/g, "/").replace(/\/+$/, "");
  // Windows 盘符小写化
  if (/^[A-Za-z]:\//.test(normalized)) {
    normalized = normalized[0].toLowerCase() + normalized.slice(1);
  }
  return normalized;
}

/**
 * 给工作区路径生成稳定的短 hash，用于 localStorage key 区分不同工作区。
 * 同一路径（不论斜杠方向、尾部斜杠、盘符大小写）永远产生相同结果。
 */
export function workspaceHash(rootPath: string): string {
  const normalized = normalizePathForCompare(rootPath);
  let h = 0;
  for (let i = 0; i < normalized.length; i++) {
    h = ((h << 5) - h + normalized.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36);
}
