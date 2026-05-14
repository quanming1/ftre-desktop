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
    server: {
      port: 50000,
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
