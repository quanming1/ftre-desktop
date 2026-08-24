/**
 * ImageRenderer — 图片预览渲染器
 *
 * 通过 fs:readImageBase64 IPC 获取 base64 data URL 渲染图片。
 */
import { useState, useEffect, useCallback } from "react";
import { Loader2 } from "lucide-react";
import type { TabRendererProps } from "../tabRegistry";
import type { ImageTab } from "@/stores/inspector";
import { useInspector } from "@/stores/inspector";
import type { FileEntry } from "@ftre/shared";
import { isBinaryFile, isImageFile } from "@/utils/filePreviewKinds";
import { PreviewHeader } from "./PreviewHeader";

export function ImageRenderer({ tab }: TabRendererProps) {
  const { filePath } = tab as ImageTab;
  const displayPath = filePath.replace(/\\/g, "/");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const openPathEntry = useCallback((entry: FileEntry) => {
    const normalizedPath = entry.path.replace(/\\/g, "/");
    const title = entry.name || normalizedPath.split("/").pop() || normalizedPath;
    if (entry.isDir || isBinaryFile(normalizedPath)) return;
    if (isImageFile(normalizedPath)) {
      useInspector.getState().openImagePreview(`path-picker-image-${normalizedPath}`, normalizedPath, title);
      return;
    }
    useInspector.getState().openFilePreview(`path-picker-file-${normalizedPath}`, normalizedPath, title);
  }, []);

  useEffect(() => {
    setSrc(null);
    setError(false);
    let cancelled = false;
    window.desktop.fs.readImageBase64(filePath)
      .then((result) => {
        if (cancelled) return;
        if (result.error || !result.dataUrl) {
          setError(true);
        } else {
          setSrc(result.dataUrl);
        }
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [filePath]);

  return (
    <div className="flex flex-col h-full bg-surface">
      <PreviewHeader
        fileName={filePath}
        variant="breadcrumb"
        pathPicker={{ onOpenFile: openPathEntry }}
      />
      <div className="flex-1 min-h-0 flex items-center justify-center overflow-auto p-4">
        {error ? (
          <p className="text-sm text-red-500">无法加载图片</p>
        ) : src ? (
          <img
            src={src}
            alt={displayPath}
            className="max-w-full max-h-full object-contain"
          />
        ) : (
          <Loader2 size={20} className="animate-spin text-t-ghost" />
        )}
      </div>
    </div>
  );
}
