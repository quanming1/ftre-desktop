import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import { useEditor } from "@/stores/editor";
import { useWorkspace } from "@/stores/workspace";
import { parseBreadcrumbSegments, type BreadcrumbSegment } from "@/lib/breadcrumb-utils";
import { getFileIcon } from "@/lib/file-icons";
import type { FileEntry } from "@/types";

/** Max visible segments before we collapse the middle with "…" */
const MAX_VISIBLE_SEGMENTS = 5;

interface DropdownState {
  segmentIndex: number;
  entries: FileEntry[];
}

export function Breadcrumb({ groupId }: { groupId?: string }) {
  const groups = useEditor((s) => s.groups);
  const activeGroupId = useEditor((s) => s.activeGroupId);
  const resolvedGroupId = groupId ?? activeGroupId;
  const group = groups.find((g) => g.id === resolvedGroupId) ?? groups[0];
  const activeFile = group?.activeFile ?? null;
  const openFile = useEditor((s) => s.openFile);
  const rootPath = useWorkspace((s) => s.rootPath);

  const [dropdown, setDropdown] = useState<DropdownState | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const segmentRefs = useRef<Map<number, HTMLButtonElement>>(new Map());

  // Close dropdown on outside click
  useEffect(() => {
    if (!dropdown) return;
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdown(null);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdown(null);
    };
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [dropdown]);

  const handleSegmentClick = useCallback(async (segment: BreadcrumbSegment, index: number) => {
    // Determine the directory to list: for dirs, list the dir itself; for files, list the parent
    const dirPath = segment.isDir ? segment.path : segment.path.replace(/\/[^/]+$/, "");
    try {
      const result = await window.desktop.fs.readDir(dirPath);
      if (result.error) return;
      // Sort: folders first, then files, alphabetically
      const sorted = [...result.entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
      setDropdown({ segmentIndex: index, entries: sorted });
    } catch {
      // Silently fail — breadcrumb dropdown is non-critical
    }
  }, []);

  const handleEntryClick = useCallback(
    async (entry: FileEntry) => {
      setDropdown(null);
      if (entry.isDir) {
        // For directories, show their contents in the dropdown
        try {
          const result = await window.desktop.fs.readDir(entry.path);
          if (result.error) return;
          const sorted = [...result.entries].sort((a, b) => {
            if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
            return a.name.localeCompare(b.name);
          });
          setDropdown({ segmentIndex: -1, entries: sorted });
        } catch {
          // ignore
        }
      } else {
        // Open the file in the editor
        try {
          const result = await window.desktop.fs.readFile(entry.path);
          if (result.error) return;
          openFile({
            path: entry.path,
            name: entry.name,
            language: result.language,
            content: result.content,
          });
        } catch {
          // ignore
        }
      }
    },
    [openFile],
  );

  if (!activeFile || !rootPath) return null;

  const allSegments = parseBreadcrumbSegments(activeFile, rootPath);
  if (allSegments.length === 0) return null;

  // Collapse middle segments if path is too long
  let visibleSegments: (BreadcrumbSegment | "ellipsis")[];
  if (allSegments.length > MAX_VISIBLE_SEGMENTS) {
    const first = allSegments[0];
    const lastThree = allSegments.slice(-3);
    visibleSegments = [first, "ellipsis", ...lastThree];
  } else {
    visibleSegments = allSegments;
  }

  // Compute dropdown position relative to the clicked segment
  const getDropdownStyle = (): React.CSSProperties => {
    if (!dropdown) return {};
    const btn = segmentRefs.current.get(dropdown.segmentIndex);
    if (!btn) return { left: 0, top: "100%" };
    const rect = btn.getBoundingClientRect();
    const parentRect = btn.closest("[data-breadcrumb-bar]")?.getBoundingClientRect();
    return {
      left: parentRect ? rect.left - parentRect.left : 0,
      top: "100%",
    };
  };

  return (
    <div
      data-breadcrumb-bar
      className="relative flex items-center gap-1 px-5 py-2 text-[12px] text-t-ghost font-mono shrink-0 overflow-hidden"
    >
      {visibleSegments.map((item, i) => {
        if (item === "ellipsis") {
          return (
            <span key="ellipsis" className="flex items-center gap-0.5">
              <span className="text-t-faint px-1.5">…</span>
              <ChevronRight size={12} className="text-t-faint/40 shrink-0" />
            </span>
          );
        }

        const segment = item;
        // Map back to the original index for dropdown positioning
        const originalIndex =
          allSegments.length > MAX_VISIBLE_SEGMENTS && i > 1 ? allSegments.length - (visibleSegments.length - i) : i === 0 ? 0 : i;

        const isLast = i === visibleSegments.length - 1;

        return (
          <span key={segment.path} className="flex items-center gap-0.5 min-w-0">
            <button
              ref={(el) => {
                if (el) segmentRefs.current.set(originalIndex, el);
              }}
              onClick={() => handleSegmentClick(segment, originalIndex)}
              className={`truncate px-1.5 py-0.5 rounded-md hover:bg-white/[0.06] hover:text-t-secondary transition-colors duration-150 cursor-pointer ${
                isLast ? "text-t-muted" : "text-t-ghost"
              }`}
            >
              {segment.name}
            </button>
            {!isLast && <ChevronRight size={12} className="text-t-faint/40 shrink-0" />}
          </span>
        );
      })}

      {/* Dropdown */}
      {dropdown && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 min-w-[200px] max-w-[320px] max-h-[300px] overflow-y-auto bg-elevated border border-border-subtle rounded-lg shadow-2xl py-1.5"
          style={getDropdownStyle()}
        >
          {dropdown.entries.length === 0 ? (
            <div className="px-3.5 py-2.5 text-[12px] text-t-faint">空目录</div>
          ) : (
            dropdown.entries.map((entry) => {
              const { icon: Icon, color } = getFileIcon(entry.name, entry.isDir, false);
              const isCurrentFile = entry.path === activeFile;
              return (
                <button
                  key={entry.path}
                  onClick={() => handleEntryClick(entry)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] text-left hover:bg-white/[0.06] transition-colors duration-150 cursor-pointer ${
                    isCurrentFile ? "text-neon" : "text-t-secondary"
                  }`}
                >
                  <Icon size={15} className="shrink-0" style={{ color }} />
                  <span className="truncate">{entry.name}</span>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
