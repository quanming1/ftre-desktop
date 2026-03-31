/**
 * 文件树过滤规则。
 * readDir 返回结果经过此过滤后再展示。
 *
 * 注意：只隐藏 .git 内部目录（用户永远不需要在文件树中浏览 Git 对象）。
 * node_modules、__pycache__ 等虽然体量大，但用户可能需要查看或调试，
 * 不在文件树层面强制隐藏。搜索层面的过滤由后端 SKIP_DIRS 负责。
 */

/** 文件树中隐藏的目录/文件名（仅 .git） */
const DEFAULT_HIDDEN = new Set(['.git']);

import type { FileEntry } from '@/types';

/** 过滤文件列表，移除默认隐藏项（大小写不敏感） */
export function filterEntries(entries: FileEntry[], showHidden = false): FileEntry[] {
  if (showHidden) return entries;
  return entries.filter((e) => !DEFAULT_HIDDEN.has(e.name.toLowerCase()));
}
