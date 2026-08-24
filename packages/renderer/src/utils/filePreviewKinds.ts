export const IMAGE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif", "ico",
]);

export const BINARY_EXTENSIONS = new Set([
  "exe", "dll", "so", "dylib", "bin", "obj", "o", "a", "lib",
  "zip", "gz", "tar", "rar", "7z", "bz2",
  "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx",
  "mp3", "mp4", "avi", "mov", "wav", "flac", "ogg",
  "ttf", "otf", "woff", "woff2", "eot",
  "pyc", "class", "jar", "wasm",
  "sqlite", "db", "mdb",
]);

export function fileExtension(filePath: string): string {
  return filePath.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
}

export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(fileExtension(filePath));
}

export function isBinaryFile(filePath: string): boolean {
  return BINARY_EXTENSIONS.has(fileExtension(filePath));
}
