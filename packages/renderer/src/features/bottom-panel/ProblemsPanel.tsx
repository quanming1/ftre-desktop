import { useEffect, useCallback } from "react";
import { AlertTriangle, XCircle, Info, FileCode2, ChevronRight, ChevronDown } from "lucide-react";
import { useState } from "react";
import { useDiagnostics, type Diagnostic, type DiagnosticSeverity } from "@/stores/diagnostics";
import { useEditor } from "@/stores/editor";
import * as monaco from "monaco-editor";

/** Map Monaco MarkerSeverity to our severity type */
function toSeverity(severity: number): DiagnosticSeverity {
  switch (severity) {
    case monaco.MarkerSeverity.Error:
      return "error";
    case monaco.MarkerSeverity.Warning:
      return "warning";
    case monaco.MarkerSeverity.Info:
      return "info";
    default:
      return "hint";
  }
}

/** Collect all markers from Monaco and push to diagnostics store */
function syncMarkers() {
  const markers = monaco.editor.getModelMarkers({});
  const diagnostics: Diagnostic[] = markers.map((m) => {
    const uri = m.resource.path;
    const fileName = uri.split("/").pop() ?? uri;
    return {
      filePath: uri,
      fileName,
      severity: toSeverity(m.severity),
      message: m.message,
      startLine: m.startLineNumber,
      startCol: m.startColumn,
      endLine: m.endLineNumber,
      endCol: m.endColumn,
      source: m.source ?? undefined,
    };
  });
  useDiagnostics.getState().setAll(diagnostics);
}

const severityIcon: Record<DiagnosticSeverity, React.ReactNode> = {
  error: <XCircle size={14} className="text-red-400 shrink-0" />,
  warning: <AlertTriangle size={14} className="text-yellow-400 shrink-0" />,
  info: <Info size={14} className="text-blue-400 shrink-0" />,
  hint: <Info size={14} className="text-t-ghost shrink-0" />,
};

function DiagnosticItem({ d, onClick }: { d: Diagnostic; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex items-center gap-2 w-full px-6 py-0.5 text-left text-xs hover:bg-surface-hover transition-colors">
      {severityIcon[d.severity]}
      <span className="text-t-muted truncate flex-1">{d.message}</span>
      {d.source && <span className="text-t-ghost shrink-0">[{d.source}]</span>}
      <span className="text-t-ghost shrink-0">
        ({d.startLine}, {d.startCol})
      </span>
    </button>
  );
}

function FileGroup({ filePath, diagnostics }: { filePath: string; diagnostics: Diagnostic[] }) {
  const [expanded, setExpanded] = useState(true);
  const fileName = diagnostics[0]?.fileName ?? filePath.split("/").pop() ?? filePath;
  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  const handleDiagnosticClick = useCallback((d: Diagnostic) => {
    // Open the file and jump to line
    const editorState = useEditor.getState();
    const openFiles = editorState.openFiles;
    const alreadyOpen = openFiles.find((f) => f.path === d.filePath);
    if (alreadyOpen) {
      editorState.setActive(d.filePath);
    }
    // Dispatch event to tell Monaco to reveal the line
    requestAnimationFrame(() => {
      window.dispatchEvent(
        new CustomEvent("ftre:reveal-line", {
          detail: { filePath: d.filePath, line: d.startLine, col: d.startCol },
        }),
      );
    });
  }, []);

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1.5 w-full px-2 py-1 text-xs font-medium text-t-default hover:bg-surface-hover transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <FileCode2 size={14} className="text-t-ghost shrink-0" />
        <span className="truncate">{fileName}</span>
        <span className="text-t-ghost ml-1 shrink-0">{filePath !== fileName ? filePath : ""}</span>
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {errors > 0 && (
            <span className="flex items-center gap-0.5 text-red-400">
              <XCircle size={12} />
              {errors}
            </span>
          )}
          {warnings > 0 && (
            <span className="flex items-center gap-0.5 text-yellow-400">
              <AlertTriangle size={12} />
              {warnings}
            </span>
          )}
        </span>
      </button>
      {expanded && (
        <div>
          {diagnostics.map((d, i) => (
            <DiagnosticItem key={`${d.startLine}-${d.startCol}-${i}`} d={d} onClick={() => handleDiagnosticClick(d)} />
          ))}
        </div>
      )}
    </div>
  );
}

export function ProblemsPanel() {
  const byFile = useDiagnostics((s) => s.byFile);

  // Subscribe to Monaco marker changes
  useEffect(() => {
    // Initial sync
    syncMarkers();
    // Listen for marker changes
    const disposable = monaco.editor.onDidChangeMarkers(() => {
      syncMarkers();
    });
    return () => disposable.dispose();
  }, []);

  const fileEntries = Object.entries(byFile).sort(([a], [b]) => a.localeCompare(b));
  const totalErrors = useDiagnostics((s) => s.errorCount());
  const totalWarnings = useDiagnostics((s) => s.warningCount());
  const isEmpty = fileEntries.length === 0;

  return (
    <div className="flex flex-col h-full">
      {/* Summary bar */}
      <div className="flex items-center gap-3 px-3 py-1 text-xs text-t-ghost border-b border-border shrink-0">
        <span className="flex items-center gap-1">
          <XCircle size={12} className="text-red-400" />
          {totalErrors} 个错误
        </span>
        <span className="flex items-center gap-1">
          <AlertTriangle size={12} className="text-yellow-400" />
          {totalWarnings} 个警告
        </span>
      </div>

      {/* Diagnostic list */}
      <div className="flex-1 overflow-y-auto">
        {isEmpty ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-t-ghost">
            <AlertTriangle size={32} strokeWidth={1.2} />
            <span className="text-xs">工作区未检测到问题</span>
          </div>
        ) : (
          fileEntries.map(([filePath, diagnostics]) => <FileGroup key={filePath} filePath={filePath} diagnostics={diagnostics} />)
        )}
      </div>
    </div>
  );
}
