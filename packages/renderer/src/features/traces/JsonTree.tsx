import { useCallback, useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Copy } from "lucide-react";

const INITIAL_CHILDREN = 50;
const LONG_STRING_LENGTH = 280;

function isContainer(value: unknown): value is Record<string, unknown> | unknown[] {
  return value !== null && typeof value === "object";
}

function entriesOf(value: Record<string, unknown> | unknown[]): [string, unknown][] {
  return Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : Object.entries(value);
}

function serialize(value: unknown): string {
  try {
    return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function NodeCopyButton({ value, label }: { value: unknown; label: string }) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(serialize(value));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  }, [value]);

  return (
    <button
      type="button"
      onClick={(event) => void copy(event)}
      aria-label={`复制 ${label}`}
      title={`复制 ${label}`}
      className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded text-t-ghost opacity-0 transition-all hover:bg-hover hover:text-t-primary group-hover:opacity-100 focus:opacity-100"
    >
      {copied ? <Check size={11} className="text-emerald-500" /> : <Copy size={11} />}
    </button>
  );
}

function PrimitiveValue({ value }: { value: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (value === null) return <span className="font-mono italic text-rose-500">null</span>;
  if (typeof value === "boolean") return <span className="font-mono text-violet-500">{String(value)}</span>;
  if (typeof value === "number") return <span className="font-mono text-sky-600">{value}</span>;
  if (typeof value === "undefined") return <span className="font-mono italic text-t-ghost">undefined</span>;

  const text = String(value);
  const isLong = text.length > LONG_STRING_LENGTH;
  const displayed = isLong && !expanded ? `${text.slice(0, LONG_STRING_LENGTH)}...` : text;
  return (
    <span className="min-w-0">
      <span className="font-mono text-emerald-600 whitespace-pre-wrap break-all">&quot;{displayed}&quot;</span>
      {isLong && (
        <button type="button" onClick={() => setExpanded((current) => !current)} className="ml-2 rounded bg-elevated px-1.5 py-0.5 text-[9px] text-t-muted hover:text-t-primary">
          {expanded ? "收起" : `展开 ${text.length.toLocaleString()} 字符`}
        </button>
      )}
    </span>
  );
}

interface TreeNodeProps {
  name: string;
  value: unknown;
  depth: number;
  isRoot?: boolean;
}

function TreeNode({ name, value, depth, isRoot = false }: TreeNodeProps) {
  const container = isContainer(value);
  const [expanded, setExpanded] = useState(isRoot);
  const [visibleCount, setVisibleCount] = useState(INITIAL_CHILDREN);
  const entries = useMemo(() => container ? entriesOf(value) : [], [container, value]);
  const visibleEntries = entries.slice(0, visibleCount);
  const remaining = entries.length - visibleEntries.length;
  const typeLabel = Array.isArray(value) ? `Array(${entries.length})` : `Object(${entries.length})`;

  if (!container) {
    return (
      <div className="group flex min-h-7 items-start gap-2 rounded-md px-1.5 py-1 hover:bg-hover/60">
        <span className="w-3 shrink-0" />
        <span data-testid="json-tree-key" className="shrink-0 font-mono text-[11px] text-t-primary">{name}</span>
        <span className="text-t-ghost">:</span>
        <span className="min-w-0 flex-1 text-[11px]"><PrimitiveValue value={value} /></span>
        <NodeCopyButton value={value} label={name} />
      </div>
    );
  }

  return (
    <div>
      <div className="group flex min-h-8 items-center gap-2 rounded-md px-1.5 py-1 hover:bg-hover/60">
        <button type="button" onClick={() => setExpanded((current) => !current)} aria-label={`${expanded ? "收起" : "展开"} ${name}`} className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-t-ghost hover:bg-hover hover:text-t-primary">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        {!isRoot && <><span data-testid="json-tree-key" className="font-mono text-[11px] font-medium text-t-primary">{name}</span><span className="text-t-ghost">:</span></>}
        {isRoot && <span className="text-[10px] font-medium text-t-muted">Root</span>}
        <span className={`rounded px-1.5 py-0.5 font-mono text-[9px] ${Array.isArray(value) ? "bg-sky-500/10 text-sky-600" : "bg-violet-500/10 text-violet-500"}`}>{typeLabel}</span>
        {!expanded && entries.length > 0 && <span className="min-w-0 truncate font-mono text-[10px] text-t-ghost">{Array.isArray(value) ? "[...]" : "{...}"}</span>}
        <span className="flex-1" />
        <NodeCopyButton value={value} label={isRoot ? "Root" : name} />
      </div>

      {expanded && (
        <div className={`${depth > 0 || isRoot ? "ml-3 border-l border-border-subtle pl-3" : ""}`}>
          {visibleEntries.map(([key, child]) => <TreeNode key={key} name={key} value={child} depth={depth + 1} />)}
          {entries.length === 0 && <div className="px-7 py-1.5 font-mono text-[10px] italic text-t-ghost">{Array.isArray(value) ? "[]" : "{}"}</div>}
          {remaining > 0 && (
            <div className="ml-6 my-1 flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => setVisibleCount((current) => current + INITIAL_CHILDREN)} className="rounded-md border border-border-subtle bg-elevated px-2 py-1 text-[9px] text-t-muted hover:text-t-primary">
                再显示 {Math.min(INITIAL_CHILDREN, remaining)} 项
              </button>
              <button type="button" onClick={() => setVisibleCount(entries.length)} className="rounded-md border border-neon/20 bg-neon/5 px-2 py-1 text-[9px] text-neon hover:bg-neon/10">
                显示全部剩余 {remaining} 项
              </button>
            </div>
          )}
          {remaining === 0 && entries.length > INITIAL_CHILDREN && (
            <button type="button" onClick={() => setVisibleCount(INITIAL_CHILDREN)} className="ml-6 my-1 rounded-md border border-border-subtle bg-elevated px-2 py-1 text-[9px] text-t-muted hover:text-t-primary">
              收回到前 {INITIAL_CHILDREN} 项
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function JsonTree({ value }: { value: unknown }) {
  if (value == null || (typeof value === "object" && Object.keys(value as object).length === 0)) {
    return <div className="flex min-h-44 items-center justify-center font-mono text-[11px] text-t-ghost">无</div>;
  }
  return (
    <div className="max-h-[calc(100vh-330px)] min-h-44 overflow-auto p-3 text-[11px]">
      <TreeNode name="Root" value={value} depth={0} isRoot />
    </div>
  );
}
