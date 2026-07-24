import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig(({ mode }) => {
  const isDev = mode === "development";
  const uiRoot = path.resolve(__dirname, "../ui");

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "src"),
        "@ftre/ui/styles.css": path.resolve(
          uiRoot,
          isDev ? "src/styles.css" : "dist/styles.css",
        ),
        "@ftre/ui": path.resolve(
          uiRoot,
          isDev ? "src/index.ts" : "dist/index.js",
        ),
      },
    },
    optimizeDeps: {
      include: [
        "@jiang_quan_ming/react-code-diff",
      ],
    },
    server: {
      // 端口由根 scripts/dev.mjs 解析 ~/.ftre/config.json 的 servers.frontend.port
      // 后通过 FTRE_FRONTEND_PORT 注入；直接跑本包时回退 48651。
      port: Number(process.env.FTRE_FRONTEND_PORT) || 48651,
      host: "127.0.0.1",
    },
    base: "./",
    build: {
      outDir: "dist",
      emptyOutDir: true,
    },
    worker: {
      format: "es",
    },
  };
});
