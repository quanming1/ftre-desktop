/** 文件树缩进起始值（px） */
export const TREE_INDENT_BASE = 12;

/** 每层缩进增量（px） */
export const TREE_INDENT_STEP = 16;

/** 计算某一层级的 paddingLeft */
export function treeIndent(depth: number): number {
  return TREE_INDENT_BASE + depth * TREE_INDENT_STEP;
}
