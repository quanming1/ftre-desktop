/**
 * WsLogPanel — Reusable WebSocket message log viewer.
 *
 * Shows raw protocol messages with:
 * - Role-based color coding
 * - Delta message auto-collapsing
 * - Copy all / Download / Clear actions
 * - Click-to-copy individual entries
 * - DOM cap (renders last N entries, exports all)
 */
import { useState, useRef, useCallback, useEffect, memo } from "react";

// ─── Constants ──────────────────────────────────────────────────────

const MAX_VISIBLE = 200;

// ─── Types ──────────────────────────────────────────────────────────

export interface LogEntry {
  time: string;
  direction: "send" | "recv";
  raw: string;
  parsed: any;
  role?: string;
}

// ─── Role Colors ────────────────────────────────────────────────────

const ROLE_COLORS: Record<string, string> = {
  control: "text-gray-400",
  "assistant.delta": "text-blue-400",
  assistant: "text-cyan-400",
  "tool_call.delta": "text-orange-300",
  tool_call: "text-orange-400",
  tool_result: "text-green-400",
  user: "text-purple-400",
  "chat.send": "text-purple-300",
};

// ─── Utilities ──────────────────────────────────────────────────────

function formatLogForExport(entries: LogEntry[]): string {
  return entries
    .map((e) => `${e.time} ${e.direction === "send" ? ">" : "<"} ${e.raw}`)
    .join("\r\n");
}

function downloadAsFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Delta Grouping ─────────────────────────────────────────────────

interface LogGroup {
  type: "single" | "delta-group";
  entries: LogEntry[];
  role: string;
}

function groupLogEntries(entries: LogEntry[]): LogGroup[] {
  const groups: LogGroup[] = [];
  let currentDeltaGroup: LogEntry[] | null = null;
  let currentDeltaRole = "";

  for (const entry of entries) {
    const isDelta = entry.role === "assistant.delta" || entry.role === "tool_call.delta";
    if (isDelta) {
      if (currentDeltaGroup && currentDeltaRole === entry.role) {
        currentDeltaGroup.push(entry);
      } else {
        if (currentDeltaGroup) groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
        currentDeltaGroup = [entry];
        currentDeltaRole = entry.role || "";
      }
    } else {
      if (currentDeltaGroup) {
        groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
        currentDeltaGroup = null;
      }
      groups.push({ type: "single", entries: [entry], role: entry.role || "" });
    }
  }
  if (currentDeltaGroup) groups.push({ type: "delta-group", entries: currentDeltaGroup, role: currentDeltaRole });
  return groups;
}

// ─── Props ──────────────────────────────────────────────────────────

export interface WsLogPanelProps {
  /** Full log entries (all, for export) */
  entries: LogEntry[];
  /** Callback to clear the log */
  onClear?: () => void;
  /** Optional class name */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────

export const WsLogPanel = memo(function WsLogPanel({ entries, onClear, className = "" }: WsLogPanelProps) {
  const [copyFeedback, setCopyFeedback] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const visibleEntries = entries.length > MAX_VISIBLE ? entries.slice(-MAX_VISIBLE) : entries;
  const hiddenCount = entries.length - visibleEntries.length;
  const groups = groupLogEntries(visibleEntries);

  const handleCopyAll = useCallback(async () => {
    await navigator.clipboard.writeText(formatLogForExport(entries));
    setCopyFeedback("Copied!");
    setTimeout(() => setCopyFeedback(""), 2000);
  }, [entries]);

  const handleDownload = useCallback(() => {
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    downloadAsFile(formatLogForExport(entries), `ws-log-${ts}.txt`);
  }, [entries]);

  const handleCopySingle = useCallback(async (entry: LogEntry) => {
    await navigator.clipboard.writeText(entry.raw);
    setCopyFeedback("Copied!");
    setTimeout(() => setCopyFeedback(""), 1500);
  }, []);

  return (
    <div className={`flex flex-col text-white ${className}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-2 py-1 border-b border-white/10">
        <span className="text-[10px] text-t-ghost flex-1">
          {entries.length} messages{hiddenCount > 0 ? ` (showing last ${visibleEntries.length})` : ""}
        </span>
        <button onClick={handleCopyAll} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded">Copy All</button>
        <button onClick={handleDownload} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded">Download</button>
        {onClear && <button onClick={onClear} className="px-2 py-0.5 text-[10px] bg-white/5 hover:bg-white/10 border border-white/10 rounded">Clear</button>}
        {copyFeedback && <span className="text-[10px] text-green-400">{copyFeedback}</span>}
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto p-2 text-[11px] font-mono">
        {hiddenCount > 0 && (
          <div className="text-[10px] text-t-ghost mb-2 text-center">... {hiddenCount} older entries hidden</div>
        )}
        {groups.map((group, gi) => {
          if (group.type === "single") {
            const entry = group.entries[0];
            return (
              <div key={gi} className="leading-tight cursor-pointer hover:bg-white/5 px-1 rounded mb-0.5" onClick={() => handleCopySingle(entry)} title="Click to copy">
                <span className="text-t-ghost">{entry.time}</span>
                <span className={`ml-1 ${ROLE_COLORS[entry.role || ""] || "text-white"}`}>
                  {entry.direction === "send" ? ">" : "<"} {entry.role || "?"}
                </span>
                <span className="ml-1 text-t-ghost">{entry.raw.length > 100 ? entry.raw.slice(0, 100) + "..." : entry.raw}</span>
              </div>
            );
          }
          // Delta group
          const first = group.entries[0];
          const last = group.entries[group.entries.length - 1];
          return (
            <details key={gi} className="mb-0.5">
              <summary className="leading-tight cursor-pointer hover:bg-white/5 px-1 rounded list-none">
                <span className="text-t-ghost">{first.time}</span>
                <span className={`ml-1 ${ROLE_COLORS[group.role] || "text-white"}`}>{"<"} {group.role}</span>
                <span className="ml-1 text-t-ghost">[{group.entries.length} deltas]</span>
              </summary>
              <div className="ml-4 border-l border-white/10 pl-2">
                {group.entries.map((entry, ei) => (
                  <div key={ei} className="text-[10px] text-t-ghost leading-tight cursor-pointer hover:bg-white/5 px-1 rounded" onClick={() => handleCopySingle(entry)}>
                    {entry.parsed?.data?.delta !== undefined ? JSON.stringify(entry.parsed.data.delta) : entry.raw.slice(0, 60)}
                  </div>
                ))}
              </div>
            </details>
          );
        })}
        <div ref={bottomRef} />
      </div>
    </div>
  );
});
