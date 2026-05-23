/**
 * 统一的路径配置
 *
 * 所有需要读写的配置文件路径都在这里定义，避免硬编码分散在各处
 */

/**
 * 配置文件路径 (模型、provider 等配置)
 *
 * @deprecated 不再通过 IPC 直接读写。请使用 `services/api.ts` 中的
 * `fetchAppConfig()` / `saveAppConfig()`，由后端 `/api/config` 统一管理。
 */
export const AI_BASE_CONFIG_PATH = "~/.ftre/config.json";
