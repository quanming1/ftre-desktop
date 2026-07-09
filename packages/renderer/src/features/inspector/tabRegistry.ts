/**
 * Tab 渲染器注册表
 *
 * 按 tab type 注册对应的渲染器组件、图标和标题格式。
 * InspectorPanel 通过注册表分发渲染，新增 tab 类型只需注册一个 renderer。
 */
import type { ReactNode } from "react";
import type { InspectorTab, InspectorTabType } from "@/stores/inspector";

export interface TabRendererProps {
  tab: InspectorTab;
  active: boolean;
  wordWrap: boolean;
}

export interface TabMeta {
  /** tab 标题栏图标 */
  icon: (tab: InspectorTab) => ReactNode;
  /** tab 标题栏文本（已格式化） */
  title: (tab: InspectorTab) => string;
  /** 内容区渲染器 */
  renderer: (props: TabRendererProps) => ReactNode;
}

const registry = new Map<InspectorTabType, TabMeta>();

export function registerTabMeta(type: InspectorTabType, meta: TabMeta): void {
  registry.set(type, meta);
}

export function getTabMeta(type: InspectorTabType): TabMeta | undefined {
  return registry.get(type);
}
