import { defineConfig } from "tsup";
import { copyFileSync } from "fs";
import { resolve } from "path";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "tailwind-preset": "src/tailwind-preset.ts",
  },
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "tailwindcss"],
  treeshake: true,
  sourcemap: true,
  onSuccess: async () => {
    // Copy styles.css to dist
    copyFileSync(
      resolve(__dirname, "src/styles.css"),
      resolve(__dirname, "dist/styles.css"),
    );
    console.log("✓ Copied styles.css to dist");
  },
});
