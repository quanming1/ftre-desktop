import { useState, useEffect, useRef, useCallback } from "react";
import type { MemoryUsage } from "@ftre/shared";
import { Input } from "@ftre/ui";
import { toast } from "sonner";

interface DataPoint {
  time: number;
  rss: number;
  heapUsed: number;
}

const MAX_POINTS = 120;
const POLL_INTERVAL = 5000;
const DEFAULT_THRESHOLD_MB = 350;
const THRESHOLD_STORE_KEY = "perf:alertThresholdMb";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDuration(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m ${sec}s`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

const LABEL = "text-[11px] text-[var(--ftre-text-ghost)] tracking-wider";

export function PerformanceSettings() {
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [currentUsage, setCurrentUsage] = useState<MemoryUsage | null>(null);
  const [startTime, setStartTime] = useState<number | null>(null);
  const [uptime, setUptime] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [thresholdMb, setThresholdMb] = useState(DEFAULT_THRESHOLD_MB);
  const [peakRss, setPeakRss] = useState(0);
  const [peakHeap, setPeakHeap] = useState(0);
  const alertedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const uptimeTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountTimeRef = useRef(Date.now());

  useEffect(() => {
    (async () => {
      try {
        const result = await window.desktop?.store?.get(THRESHOLD_STORE_KEY);
        if (result?.value !== undefined && result.value !== null) {
          setThresholdMb(Number(result.value));
        }
      } catch { /* */ }
    })();
  }, []);

  const handleThresholdChange = useCallback((mb: number) => {
    setThresholdMb(mb);
    window.desktop?.store?.set(THRESHOLD_STORE_KEY, mb);
    alertedRef.current = false;
  }, []);

  const fetchMemory = useCallback(async () => {
    try {
      if (!window.desktop?.memory?.getUsage) return;
      const usage = await window.desktop.memory.getUsage();
      setCurrentUsage(usage);
      setError(null);

      if (startTime === null && usage.startTime) setStartTime(usage.startTime);

      setPeakRss((p) => Math.max(p, usage.main.rss));
      setPeakHeap((p) => Math.max(p, usage.main.heapUsed));

      const tb = thresholdMb * 1024 * 1024;
      if (usage.main.rss > tb && !alertedRef.current) {
        alertedRef.current = true;
        toast.warning(`内存超过 ${thresholdMb} MB 预警值`, {
          description: `RSS ${formatBytes(usage.main.rss)}`,
          duration: 6000,
        });
      } else if (usage.main.rss <= tb && alertedRef.current) {
        alertedRef.current = false;
      }

      setDataPoints((prev) => {
        const next = [
          ...prev,
          { time: usage.timestamp, rss: usage.main.rss, heapUsed: usage.main.heapUsed },
        ];
        if (next.length > MAX_POINTS) return next.slice(-MAX_POINTS);
        return next;
      });
    } catch {
      setError("无法获取内存数据，请确认在 Electron 环境中运行");
    }
  }, [startTime, thresholdMb]);

  useEffect(() => {
    fetchMemory();
    timerRef.current = setInterval(fetchMemory, POLL_INTERVAL);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [fetchMemory]);

  useEffect(() => {
    uptimeTimerRef.current = setInterval(() => {
      setUptime(Date.now() - (startTime ?? mountTimeRef.current));
    }, 1000);
    return () => { if (uptimeTimerRef.current) clearInterval(uptimeTimerRef.current); };
  }, [startTime]);

  const th = thresholdMb * 1024 * 1024;
  const rss = currentUsage?.main.rss ?? 0;
  const heap = currentUsage?.main.heapUsed ?? 0;
  const external = currentUsage?.main.external ?? 0;
  const pct = th > 0 ? Math.min((rss / th) * 100, 100) : 0;
  const over = rss > th;

  return (
    <div className="font-mono text-[var(--ftre-text-primary)]">
      {/* ── 标题 ── */}
      <div className="flex items-center gap-2 mb-5">
        <span className="text-[14px] font-semibold">Performance</span>
        <span className="inline-flex items-center gap-1 text-[11px] text-[var(--ftre-text-muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--ftre-status-success)] inline-block" />
          running
        </span>
      </div>

      {error && (
        <div className="mb-4 px-3 py-2 text-[12px] bg-[var(--ftre-status-danger)]/10 text-[var(--ftre-status-danger)]">
          {error}
        </div>
      )}

      {/* ── Overview ── */}
      <div className="mb-5">
        <div className={`${LABEL} mb-2`}>Overview</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--ftre-border-subtle)]">
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">运行时长</th>
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">启动时间</th>
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">RSS 峰值</th>
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">堆峰值</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--ftre-border-subtle)]">
              <td className="px-3 py-2 text-[13px] tabular-nums text-[var(--ftre-text-secondary)]">
                {formatDuration(uptime)}
              </td>
              <td className="px-3 py-2 text-[13px] tabular-nums text-[var(--ftre-text-secondary)]">
                {startTime ? new Date(startTime).toLocaleString() : "--"}
              </td>
              <td className="px-3 py-2 text-[13px] tabular-nums text-[var(--ftre-text-secondary)]">
                {formatBytes(peakRss)}
              </td>
              <td className="px-3 py-2 text-[13px] tabular-nums text-[var(--ftre-text-secondary)]">
                {formatBytes(peakHeap)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Current ── */}
      <div className="mb-5">
        <div className={`${LABEL} mb-2`}>Current</div>
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b border-[var(--ftre-border-subtle)]">
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">RSS</th>
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">JS Heap</th>
              <th className="text-left px-3 py-1 text-[11px] font-normal text-[var(--ftre-text-ghost)]">External</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[var(--ftre-border-subtle)]">
              <td className={`px-3 py-2 text-[15px] font-semibold tabular-nums ${over ? "text-[var(--ftre-status-danger)]" : "text-[var(--ftre-text-primary)]"}`}>
                {formatBytes(rss)}
              </td>
              <td className="px-3 py-2 text-[15px] font-semibold tabular-nums text-[var(--ftre-text-primary)]">
                {formatBytes(heap)}
              </td>
              <td className="px-3 py-2 text-[15px] font-semibold tabular-nums text-[var(--ftre-text-primary)]">
                {formatBytes(external)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* ── Alert ── */}
      <div className="mb-5">
        <div className={`${LABEL} mb-2`}>Alert Threshold</div>
        <div className="flex items-end gap-4">
          <div className="flex items-end gap-2">
            <Input
              type="number" min={50} max={10000} step={10}
              value={thresholdMb}
              onChange={(e) => handleThresholdChange(Number(e.target.value) || DEFAULT_THRESHOLD_MB)}
              className="w-20 h-9 text-[15px] text-center font-semibold [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span className="text-[12px] text-[var(--ftre-text-ghost)] pb-2">MB</span>
          </div>

          <div className="flex-1 min-w-0 pb-1">
            <div className="flex justify-between text-[12px] mb-1.5">
              <span className="text-[var(--ftre-text-muted)] tabular-nums">
                {formatBytes(rss)} / {thresholdMb} MB
              </span>
              <span className={over ? "text-[var(--ftre-status-danger)] tabular-nums font-medium" : "text-[var(--ftre-text-secondary)] tabular-nums"}>
                {Math.round((rss / th) * 100)}%
              </span>
            </div>
            <div className="h-1 bg-[var(--ftre-bg-hover)]">
              <div
                className={`h-full transition-[width] duration-500 ${over ? "bg-[var(--ftre-status-danger)]" : pct > 80 ? "bg-[var(--ftre-status-warning)]" : "bg-[var(--ftre-text-muted)]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        </div>
      </div>

      {/* ── Chart ── */}
      {dataPoints.length >= 2 && (
        <div>
          <div className={`${LABEL} mb-2`}>History · RSS</div>
          <div className="text-right text-[11px] text-[var(--ftre-text-faint)] mb-1 tabular-nums">
            {dataPoints.length} points · max {formatBytes(Math.max(...dataPoints.map((d) => d.rss)))}
          </div>
          <MemoryLineChart data={dataPoints} thresholdBytes={th} />
        </div>
      )}
    </div>
  );
}

// ─── Chart ─────────────────────────────────────────────────

function MemoryLineChart({ data, thresholdBytes }: { data: DataPoint[]; thresholdBytes: number }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number; label: string } | null>(null);

  const w = 680;
  const h = 200;
  const pad = { top: 8, right: 12, bottom: 28, left: 48 };
  const plotW = w - pad.left - pad.right;
  const plotH = h - pad.top - pad.bottom;

  const rssValues = data.map((d) => d.rss);
  const minV = Math.min(...rssValues) * 0.95;
  const maxV = Math.max(Math.max(...rssValues), thresholdBytes) * 1.06;
  const range = maxV - minV || 1;

  const xScale = (i: number) => pad.left + (i / Math.max(data.length - 1, 1)) * plotW;
  const yScale = (v: number) => pad.top + plotH - ((v - minV) / range) * plotH;
  const pointsStr = data.map((d, i) => `${xScale(i)},${yScale(d.rss)}`).join(" ");

  const yTicks = 4;
  const yt = Array.from({ length: yTicks + 1 }, (_, i) => {
    const v = minV + (range / yTicks) * i;
    return { v, label: formatBytes(v) };
  });

  const xTickIvl = Math.max(1, Math.floor((data.length - 1) / 5));

  const thY = thresholdBytes > 0 && thresholdBytes >= minV && thresholdBytes <= maxV
    ? yScale(thresholdBytes) : null;

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let bestIdx = 0, bestDist = Infinity;
    for (let i = 0; i < data.length; i++) {
      const d = Math.abs(xScale(i) - mx);
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    const pt = data[bestIdx];
    setTooltip({ x: xScale(bestIdx), y: yScale(pt.rss), label: `${formatBytes(pt.rss)} · ${new Date(pt.time).toLocaleTimeString()}` });
  };

  return (
    <svg ref={svgRef} viewBox={`0 0 ${w} ${h}`} className="w-full h-auto"
      onMouseMove={handleMouseMove} onMouseLeave={() => setTooltip(null)}>
      <defs>
        <linearGradient id="mGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#6366f1" stopOpacity={0.12} />
          <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
        </linearGradient>
      </defs>

      {/* grid */}
      {yt.map(({ v }, i) => (
        <line key={i} x1={pad.left} y1={yScale(v)} x2={w - pad.right} y2={yScale(v)}
          stroke="currentColor" strokeOpacity={0.06} strokeWidth={1} />
      ))}

      {/* Y axis */}
      {yt.map(({ v, label }, i) => (
        <text key={i} x={pad.left - 6} y={yScale(v) + 4} textAnchor="end"
          className="fill-[var(--ftre-text-faint)] tabular-nums" fontSize={10}>{label}</text>
      ))}

      {/* X axis */}
      {data.map((d, i) => i % xTickIvl === 0 ? (
        <text key={i} x={xScale(i)} y={h - 6} textAnchor="middle"
          className="fill-[var(--ftre-text-faint)] tabular-nums" fontSize={10}>
          {new Date(d.time).toLocaleTimeString()}
        </text>
      ) : null)}

      {/* threshold line */}
      {thY !== null && (
        <g>
          <line x1={pad.left} y1={thY} x2={w - pad.right} y2={thY}
            stroke="var(--ftre-status-warning)" strokeOpacity={0.5} strokeWidth={1} strokeDasharray="3 2" />
          <text x={w - pad.right - 2} y={thY - 3} textAnchor="end"
            className="fill-[var(--ftre-status-warning)]" fontSize={9}>threshold</text>
        </g>
      )}

      {/* area */}
      <polygon points={`${pad.left},${pad.top + plotH} ${pointsStr} ${w - pad.right},${pad.top + plotH}`}
        fill="url(#mGrad)" />

      {/* line */}
      <polyline points={pointsStr} fill="none" stroke="#6366f1" strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />

      {/* dots */}
      {data.map((d, i) => (
        <circle key={i} cx={xScale(i)} cy={yScale(d.rss)} r={2} fill="#6366f1"
          className="opacity-0 hover:opacity-100 transition-opacity" />
      ))}

      {/* tooltip */}
      {tooltip && (
        <g pointerEvents="none">
          <line x1={tooltip.x} y1={pad.top} x2={tooltip.x} y2={pad.top + plotH}
            stroke="#6366f1" strokeWidth={1} opacity={0.3} strokeDasharray="2 2" />
          <circle cx={tooltip.x} cy={tooltip.y} r={3} fill="#6366f1" />
          <rect x={Math.min(tooltip.x + 8, w - 190)} y={Math.max(tooltip.y - 22, 0)}
            width={180} height={20} rx={4} fill="var(--ftre-bg-base)" opacity={0.95} />
          <text x={Math.min(tooltip.x + 14, w - 184)} y={Math.max(tooltip.y - 7, 14)}
            className="fill-[var(--ftre-text-primary)] tabular-nums" fontSize={11}>{tooltip.label}</text>
        </g>
      )}
    </svg>
  );
}
