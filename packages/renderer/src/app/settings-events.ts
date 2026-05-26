/**
 * 打开全局设置面板的事件名。
 * detail.section 可选: "general" | "models" | "gateway" | "agents"
 *
 * 任意组件触发：
 *   window.dispatchEvent(
 *     new CustomEvent(OPEN_SETTINGS_EVENT, { detail: { section: "models" } }),
 *   );
 *
 * 单独抽出来是为了让消费方（SessionPanel / ModelSelector 等）不必把 SettingsDialog
 * 这一坨重模块（含主题 store / 各个设置页）拉进自己的 import 图。
 */
export const OPEN_SETTINGS_EVENT = "ftre:open-settings";

export type SettingsSection = "general" | "models" | "gateway" | "agents";
