// 从 ~/.ftre/config.json 解析端口的共享工具。
//
// 前端 dev 端口、wait-on 探测、renderer vite 配置都从这里取，确保以配置文件为准。
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(process.env.USERPROFILE || homedir(), ".ftre", "config.json");

/** 读取 servers.<name>.port，缺失/损坏时返回 fallback。 */
export function resolveServerPort(name, fallback) {
    try {
        const cfg = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
        const port = cfg?.servers?.[name]?.port;
        if (Number.isInteger(port)) return port;
    } catch {
        // 配置缺失/损坏时静默回退
    }
    return fallback;
}

export const FRONTEND_FALLBACK_PORT = 48651;

/** 前端（desktop renderer）dev 端口。优先环境变量，其次配置文件，最后 fallback。 */
export function resolveFrontendPort() {
    const fromEnv = Number(process.env.FTRE_FRONTEND_PORT);
    if (Number.isInteger(fromEnv) && fromEnv > 0) return fromEnv;
    return resolveServerPort("frontend", FRONTEND_FALLBACK_PORT);
}
