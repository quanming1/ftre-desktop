/**
 * ImageRenderer — 图片预览渲染器
 *
 * 通过 fs:readImageBase64 IPC 获取 base64 data URL 渲染图片。
 */
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import type { TabRendererProps } from "../tabRegistry";
import type { ImageTab } from "@/stores/inspector";

export function ImageRenderer({ tab }: TabRendererProps) {
  const { filePath } = tab as ImageTab;
  const displayPath = filePath.replace(/\\/g, "/");
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    setSrc(null);
    setError(false);
    window.desktop.fs.readImageBase64(filePath).then((result) => {
      if (result.error || !result.dataUrl) {
        setError(true);
      } else {
        setSrc(result.dataUrl);
      }
    });
  }, [filePath]);

  return (
    <div className="flex flex-col h-full bg-surface">
      <div className="px-3 py-1.5 border-b border-border shrink-0 flex items-baseline gap-2 bg-surface overflow-hidden">
        <span className="text-[12px] font-mono text-t-ghost truncate min-w-0" title={filePath}>
          {displayPath}
        </span>
      </div>
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
