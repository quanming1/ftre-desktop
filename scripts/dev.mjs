// Desktop 开发启动脚本
//
// 端口以 ~/.ftre/config.json 的 servers.frontend.port 为准（缺省 48651）。
// 解析出端口后通过 FTRE_FRONTEND_PORT 注入子进程：
//   - renderer 的 vite.config.ts 读取该变量决定 server.port
//   - electron 启动前用该端口做 wait-on 探测
import { spawn } from "node:child_process";
import { resolveFrontendPort } from "./resolve-port.mjs";

const port = resolveFrontendPort();
const url = `http://127.0.0.1:${port}`;
console.log(`[desktop] 前端端口 ${port}（来源：~/.ftre/config.json servers.frontend.port）`);

const command = [
    "concurrently",
    `"pnpm --filter @ftre/shared dev"`,
    `"pnpm --filter @ftre/ui dev"`,
    `"pnpm --filter @ftre/editor dev"`,
    `"pnpm --filter @ftre/electron dev"`,
    // Windows 上旧 renderer 进程/杀毒软件可能锁住 node_modules/.vite 的临时
    // 依赖文件；强制重优化会先清理失效快照，避免 Vite 启动后立即退出。
    `"pnpm --filter @ftre/renderer exec vite --force"`,
    // Vite 先就绪不代表 Electron 的 tsc --watch 已经生成 preload.js；如果
    // 此时启动窗口，contextBridge 不会注入 window.desktop，Renderer 会在
    // 文件树等原生能力处崩溃。等待 main + preload 都存在后再启动 Electron。
    `"wait-on ${url} file:packages/electron/dist/main.js file:packages/electron/dist/preload.js && electron packages/electron/dist/main.js"`,
].join(" ");

const child = spawn(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, FTRE_FRONTEND_PORT: String(port) },
});

child.on("exit", (code) => process.exit(code ?? 0));
