/**
 * FileIconView — 基于 @iconify/react + vscode-icons 图标集
 *
 * 使用 VS Code 官方图标风格，按扩展名匹配对应图标。
 */
import { memo } from "react";
import { Icon } from "@iconify/react";

/** 扩展名 → { icon, color } */
const EXT_MAP: Record<string, { icon: string; color: string }> = {
  ts:   { icon: "vscode-icons:file-type-typescript", color: "#3178c6" },
  tsx:  { icon: "vscode-icons:file-type-typescript", color: "#3178c6" },
  js:   { icon: "vscode-icons:file-type-js-official", color: "#f7df1e" },
  jsx:  { icon: "vscode-icons:file-type-js-official", color: "#f7df1e" },
  mjs:  { icon: "vscode-icons:file-type-js-official", color: "#f7df1e" },
  json: { icon: "vscode-icons:file-type-json", color: "#cbcb41" },
  css:  { icon: "vscode-icons:file-type-css", color: "#563d7c" },
  scss: { icon: "vscode-icons:file-type-scss", color: "#cc6699" },
  sass: { icon: "vscode-icons:file-type-sass", color: "#cc6699" },
  html: { icon: "vscode-icons:file-type-html", color: "#e34c26" },
  md:   { icon: "vscode-icons:file-type-markdown", color: "#519aba" },
  markdown: { icon: "vscode-icons:file-type-markdown", color: "#519aba" },
  py:   { icon: "vscode-icons:file-type-python", color: "#3572A5" },
  go:   { icon: "vscode-icons:file-type-go", color: "#00ADD8" },
  rs:   { icon: "vscode-icons:file-type-rust", color: "#dea584" },
  java: { icon: "vscode-icons:file-type-java", color: "#5382a1" },
  c:    { icon: "vscode-icons:file-type-c", color: "#555555" },
  h:    { icon: "vscode-icons:file-type-c", color: "#555555" },
  cpp:  { icon: "vscode-icons:file-type-cpp", color: "#f34b7d" },
  hpp:  { icon: "vscode-icons:file-type-cpp", color: "#f34b7d" },
  cs:   { icon: "vscode-icons:file-type-csharp", color: "#178600" },
  rb:   { icon: "vscode-icons:file-type-ruby", color: "#cc342d" },
  php:  { icon: "vscode-icons:file-type-php", color: "#777bb3" },
  swift:{ icon: "vscode-icons:file-type-swift", color: "#ffac45" },
  kt:   { icon: "vscode-icons:file-type-kotlin", color: "#7f52ff" },
  sh:   { icon: "vscode-icons:file-type-shell", color: "#89e051" },
  bash: { icon: "vscode-icons:file-type-shell", color: "#89e051" },
  zsh:  { icon: "vscode-icons:file-type-shell", color: "#89e051" },
  yml:  { icon: "vscode-icons:file-type-yaml", color: "#cc1018" },
  yaml: { icon: "vscode-icons:file-type-yaml", color: "#cc1018" },
  toml: { icon: "vscode-icons:file-type-toml", color: "#9c4221" },
  ini:  { icon: "vscode-icons:file-type-config", color: "#6d8086" },
  cfg:  { icon: "vscode-icons:file-type-config", color: "#6d8086" },
  conf: { icon: "vscode-icons:file-type-config", color: "#6d8086" },
  xml:  { icon: "vscode-icons:file-type-xml", color: "#e37933" },
  sql:  { icon: "vscode-icons:file-type-sql", color: "#e38c00" },
  svg:  { icon: "vscode-icons:file-type-svg", color: "#ffb13b" },
  png:  { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  jpg:  { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  jpeg: { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  gif:  { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  webp: { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  ico:  { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  bmp:  { icon: "vscode-icons:file-type-image", color: "#a074c4" },
  pdf:  { icon: "vscode-icons:file-type-pdf2", color: "#e53935" },
  zip:  { icon: "vscode-icons:file-type-zip", color: "#8c939d" },
  gz:   { icon: "vscode-icons:file-type-zip", color: "#8c939d" },
  tar:  { icon: "vscode-icons:file-type-zip", color: "#8c939d" },
  lock: { icon: "vscode-icons:file-type-lock", color: "#8c939d" },
  log:  { icon: "vscode-icons:file-type-log", color: "#8c939d" },
  txt:  { icon: "vscode-icons:file-type-text", color: "#8c939d" },
  env:  { icon: "vscode-icons:file-type-config", color: "#ecd53f" },
};

/** 特殊文件名 → { icon, color } */
const SPECIAL_MAP: Record<string, { icon: string; color: string }> = {
  "package.json": { icon: "vscode-icons:file-type-npm", color: "#cb3837" },
  "package-lock.json": { icon: "vscode-icons:file-type-npm", color: "#cb3837" },
  "pnpm-lock.yaml": { icon: "vscode-icons:file-type-pnpm", color: "#cb3837" },
  "tsconfig.json": { icon: "vscode-icons:file-type-typescript", color: "#3178c6" },
  ".gitignore": { icon: "vscode-icons:file-type-git", color: "#f05032" },
  ".gitattributes": { icon: "vscode-icons:file-type-git", color: "#f05032" },
  ".env": { icon: "vscode-icons:file-type-config", color: "#ecd53f" },
  ".dockerignore": { icon: "vscode-icons:file-type-docker", color: "#2496ed" },
  "dockerfile": { icon: "vscode-icons:file-type-docker", color: "#2496ed" },
  "makefile": { icon: "vscode-icons:file-type-makefile", color: "#427819" },
  "license": { icon: "vscode-icons:file-type-license", color: "#8c939d" },
  "readme.md": { icon: "vscode-icons:file-type-markdown", color: "#519aba" },
  ".editorconfig": { icon: "vscode-icons:file-type-config", color: "#6d8086" },
};

function resolveIcon(filePath: string): { icon: string; color: string } {
  const name = filePath.includes("/") || filePath.includes("\\")
    ? filePath.split(/[\\/]/).pop() ?? filePath
    : filePath;
  const lower = name.toLowerCase();

  if (SPECIAL_MAP[lower]) return SPECIAL_MAP[lower];
  if (lower === "dockerfile") return SPECIAL_MAP["dockerfile"];

  const dotIndex = lower.lastIndexOf(".");
  if (dotIndex >= 0) {
    const ext = lower.slice(dotIndex + 1);
    if (EXT_MAP[ext]) return EXT_MAP[ext];
  }

  if (lower === "makefile") return SPECIAL_MAP["makefile"];
  if (lower === "license") return SPECIAL_MAP["license"];

  return { icon: "vscode-icons:default-file", color: "#9da5b4" };
}

export const FileIconView = memo(function FileIconView({
  path,
  size = 16,
}: {
  path: string;
  size?: number;
}) {
  const { icon, color } = resolveIcon(path);
  return (
    <Icon
      icon={icon}
      width={size}
      height={size}
      style={{ color, minWidth: size, minHeight: size }}
      className="shrink-0"
    />
  );
});
