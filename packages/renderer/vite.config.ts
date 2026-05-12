import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      "@ftre/ui/styles.css": path.resolve(__dirname, "../ui/dist/styles.css"),
      "@ftre/ui": path.resolve(__dirname, "../ui/dist/index.js"),
    },
  },
  server: {
    port: 50000,
    hmr: false,
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
});
