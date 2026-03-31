import { useState, useRef, useEffect, useCallback } from "react";
import { Search, Clock, Star, X } from "lucide-react";
import { useWorkspace } from "@/stores/workspace";
import { useEditor } from "@/stores/editor";
import { getFileIcon } from "@/lib/file-icons";

interface FileItem {
  name: string;
  path: string;
  ext: string;
}

export function FilePalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allFiles, setAllFiles] = useState<FileItem[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootPath = useWorkspace((s) => s.rootPath);
  const { openFile } = useEditor();

  // Recursively collect files
  const collectFiles = useCallback(async (dir: string): Promise<FileItem[]> => {
    const result = await window.desktop.fs.readDir(dir);
    if (result.error || !result.entries) return [];
    const items: FileItem[] = [];
    for (const entry of result.entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules" || entry.name === "__pycache__") continue;
      if (entry.isDir) {
        const sub = await collectFiles(entry.path);
        items.push(...sub);
      } else {
        items.push({ name: entry.name, path: entry.path, ext: entry.ext || "" });
      }
    }
    return items;
  }, []);

  useEffect(() => {
    if (open && rootPath) {
      setQuery("");
      setSelectedIndex(0);
      collectFiles(rootPath).then(setAllFiles);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open, rootPath, collectFiles]);

  if (!open) return null;

  const filtered = allFiles.filter((f) => f.name.toLowerCase().includes(query.toLowerCase()) || f.path.toLowerCase().includes(query.toLowerCase()));

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    if (e.key === "ArrowDown") setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
    if (e.key === "ArrowUp") setSelectedIndex((i) => Math.max(i - 1, 0));
    if (e.key === "Enter" && filtered[selectedIndex]) {
      handleSelect(filtered[selectedIndex]);
    }
  };

  const handleSelect = async (file: FileItem) => {
    const result = await window.desktop.fs.readFile(file.path);
    if (!result.error) {
      openFile({ path: file.path, name: file.name, language: result.language, content: result.content });
    }
    onClose();
  };

  // Make path relative to rootPath for display
  const relativePath = (p: string) => {
    if (rootPath && p.startsWith(rootPath)) {
      return p.slice(rootPath.length + 1).replace(/\\/g, "/");
    }
    return p;
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm" onClick={onClose} />

      {/* Palette */}
      <div className="fixed top-[15%] left-1/2 -translate-x-1/2 w-full max-w-lg bg-elevated border border-border-subtle rounded-xl shadow-2xl z-50 overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Search size={14} className="text-t-ghost shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="跳转到文件..."
            className="flex-1 bg-transparent text-[13px] text-white placeholder-t-ghost outline-none font-mono"
          />
          <button onClick={onClose} className="text-t-ghost hover:text-t-secondary transition-colors">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto py-1">
          {filtered.slice(0, 50).map((file, idx) => {
            const isSelected = idx === selectedIndex;
            return (
              <button
                key={file.path}
                onClick={() => handleSelect(file)}
                onMouseEnter={() => setSelectedIndex(idx)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  isSelected ? "bg-neon-ghost" : "hover:bg-white/[0.02]"
                }`}
              >
                {(() => {
                  const { icon: FileIcon, color } = getFileIcon(file.name, false);
                  return <FileIcon size={14} className="shrink-0" style={{ color, opacity: isSelected ? 1 : 0.6 }} />;
                })()}
                <div className="flex-1 min-w-0">
                  <div className={`text-[13px] truncate font-mono ${isSelected ? "text-white" : "text-t-secondary"}`}>{file.name}</div>
                  <div className="text-[10px] text-t-ghost truncate font-mono">{relativePath(file.path)}</div>
                </div>
                {isSelected && <span className="text-[9px] text-t-dim font-mono">回车</span>}
              </button>
            );
          })}
          {filtered.length === 0 && <div className="px-4 py-8 text-center text-[12px] text-t-ghost font-mono">未找到文件</div>}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2 border-t border-border flex items-center gap-3 text-[9px] text-t-faint font-mono">
          <span>上/下 导航</span>
          <span>回车 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </>
  );
}
