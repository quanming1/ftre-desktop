type CounterName =
  | "fs.fileChanged.events"
  | "tree.refresh.events"
  | "tree.refresh.root"
  | "tree.refresh.child"
  | "git.refresh.requests"
  | "git.refresh.info"
  | "git.refresh.status"
  | "fileIndex.builds"
  | "fileIndex.invalidations"
  | "fileIndex.incremental.add"
  | "fileIndex.incremental.remove"
  | "fileIndex.incremental.rename";

type TimerName =
  | "git.refresh.info.ms"
  | "git.refresh.status.ms"
  | "fileIndex.build.ms"
  | "tree.refresh.root.ms"
  | "tree.refresh.dir.ms";

interface TimerStat {
  count: number;
  totalMs: number;
  maxMs: number;
  lastMs: number;
}

interface MetricsSnapshot {
  counters: Record<string, number>;
  timers: Record<string, TimerStat>;
  createdAt: number;
  updatedAt: number;
}

const counters = new Map<CounterName, number>();
const timers = new Map<TimerName, TimerStat>();
const createdAt = Date.now();
let updatedAt = createdAt;

function touch(): void {
  updatedAt = Date.now();
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function incrementCounter(name: CounterName, delta: number = 1): void {
  counters.set(name, (counters.get(name) ?? 0) + delta);
  touch();
}

function recordTimer(name: TimerName, ms: number): void {
  const prev = timers.get(name) ?? {
    count: 0,
    totalMs: 0,
    maxMs: 0,
    lastMs: 0,
  };

  const next: TimerStat = {
    count: prev.count + 1,
    totalMs: prev.totalMs + ms,
    maxMs: Math.max(prev.maxMs, ms),
    lastMs: ms,
  };

  timers.set(name, next);
  touch();
}

function mapToObject<T extends string, V>(map: Map<T, V>): Record<string, V> {
  const obj: Record<string, V> = {};
  for (const [key, value] of map.entries()) {
    obj[key] = value;
  }
  return obj;
}

export const performanceMetrics = {
  count(name: CounterName, delta: number = 1): void {
    incrementCounter(name, delta);
  },

  start(): number {
    return now();
  },

  end(name: TimerName, startMark: number): number {
    const duration = Math.max(0, now() - startMark);
    recordTimer(name, duration);
    return duration;
  },

  measure<T>(name: TimerName, fn: () => T): T {
    const startMark = now();
    try {
      return fn();
    } finally {
      this.end(name, startMark);
    }
  },

  async measureAsync<T>(name: TimerName, fn: () => Promise<T>): Promise<T> {
    const startMark = now();
    try {
      return await fn();
    } finally {
      this.end(name, startMark);
    }
  },

  getCounter(name: CounterName): number {
    return counters.get(name) ?? 0;
  },

  getTimer(name: TimerName): TimerStat {
    return (
      timers.get(name) ?? {
        count: 0,
        totalMs: 0,
        maxMs: 0,
        lastMs: 0,
      }
    );
  },

  snapshot(): MetricsSnapshot {
    return {
      counters: mapToObject(counters),
      timers: mapToObject(timers),
      createdAt,
      updatedAt,
    };
  },

  reset(): void {
    counters.clear();
    timers.clear();
    updatedAt = Date.now();
  },

  printSummary(): void {
    const snapshot = this.snapshot();
    // Keep output compact for debugging.
    console.table(snapshot.counters);
    console.table(
      Object.fromEntries(
        Object.entries(snapshot.timers).map(([name, stat]) => [
          name,
          {
            count: stat.count,
            avgMs:
              stat.count > 0
                ? Number((stat.totalMs / stat.count).toFixed(2))
                : 0,
            maxMs: Number(stat.maxMs.toFixed(2)),
            lastMs: Number(stat.lastMs.toFixed(2)),
          },
        ]),
      ),
    );
  },
};

if (typeof window !== "undefined") {
  (
    window as typeof window & {
      __ftrePerf?: typeof performanceMetrics;
    }
  ).__ftrePerf = performanceMetrics;
}

export type { CounterName, TimerName, TimerStat, MetricsSnapshot };
