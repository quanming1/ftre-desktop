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
    `"pnpm --filter @ftre/renderer dev"`,
    `"wait-on ${url} && electron packages/electron/dist/main.js"`,
].join(" ");

const child = spawn(command, {
    stdio: "inherit",
    shell: true,
    env: { ...process.env, FTRE_FRONTEND_PORT: String(port) },
});

child.on("exit", (code) => process.exit(code ?? 0));
