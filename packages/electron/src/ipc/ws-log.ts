import { ipcMain, shell } from "electron";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { WsLogEntry, WsLogInput, WsLogPage, WsLogQuery, WsLogStats } from "@ftre/shared";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES = 5;
const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_RAW_BYTES = 512 * 1024;
const MAX_QUERY_LIMIT = 200;

function logDirectory(): string {
  // 日志固定放在用户目录下，Renderer 不能传入任意路径。
  return path.join(os.homedir(), ".ftre", "logs", "ws");
}

function isLogFile(name: string): boolean {
  return name === "ws-current.ndjson" || /^ws-\d{14}-\d+\.ndjson$/.test(name);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function normalizeEntry(input: WsLogInput): WsLogEntry {
  const raw = typeof input.raw === "string" ? input.raw : "";
  const originalBytes = byteLength(raw);
  const truncated = originalBytes > MAX_RAW_BYTES;
  // 单条原始帧限制在约 512KB，避免异常大的流式消息占满磁盘。
  const boundedRaw = truncated
    ? `${raw.slice(0, 240 * 1024)}\n...[truncated]...\n${raw.slice(-240 * 1024)}`
    : raw;
  return {
    ...input,
    id: `wslog_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`,
    timestamp: input.timestamp || new Date().toISOString(),
    // bytes 表示网络帧原始大小；raw 可能被截断，但不能改变审计中的传输大小。
    bytes: typeof input.bytes === "number" ? input.bytes : byteLength(raw),
    raw: boundedRaw,
    ...(truncated ? { truncated: true, originalBytes } : {}),
  };
}

function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  const value = Number.parseInt(cursor, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

export class WsLogWriter {
  private writeChain: Promise<void> = Promise.resolve();
  private dropped = 0;
  /** 闈㈡澘榛樿鍙湅鏈€杩戣褰曪紝缂撳瓨杩欓儴鍒嗗彲閬垮厤姣忕閲嶆柊鎵弿 50MB 鏃ュ織銆?*/
  private recentEntries: WsLogEntry[] = [];
  private entryCount = 0;
  private entryCountKnown = false;
  private statsCache: WsLogStats | null = null;
  private statsDirty = true;

  appendBatch(entries: WsLogInput[]): void {
    if (!Array.isArray(entries) || entries.length === 0) return;
    const safeEntries = entries.slice(0, 100);
    this.statsDirty = true;
    this.writeChain = this.writeChain
      .then(() => this.append(safeEntries))
      .catch((error) => {
        this.dropped += safeEntries.length;
        console.error("[ws-log] append failed", error);
      });
  }

  async flush(): Promise<void> {
    await this.writeChain;
  }

  async stats(): Promise<WsLogStats> {
    await this.flush();
    if (this.statsCache && !this.statsDirty) return this.statsCache;
    const files = await this.listFiles();
    let bytes = 0;
    let entries = this.entryCountKnown ? this.entryCount : 0;
    for (const file of files) {
      try {
        const stat = await fs.promises.stat(path.join(logDirectory(), file));
        bytes += stat.size;
        if (!this.entryCountKnown) {
          const content = await fs.promises.readFile(path.join(logDirectory(), file), "utf8");
          entries += content.split("\n").filter(Boolean).length;
        }
      } catch {
        // 文件可能在轮转/清理时消失，统计时跳过即可。
      }
    }
    if (!this.entryCountKnown) {
      this.entryCount = entries;
      this.entryCountKnown = true;
    }
    this.statsCache = { directory: logDirectory(), files: files.length, bytes, entries, dropped: this.dropped };
    this.statsDirty = false;
    return this.statsCache;
  }

  async query(query: WsLogQuery = {}): Promise<WsLogPage> {
    await this.flush();
    const limit = Math.max(1, Math.min(MAX_QUERY_LIMIT, query.limit ?? 100));
    const skip = decodeCursor(query.cursor);
    const hasFilter = Boolean(
      query.sessionId || query.direction || query.type || query.eventType || query.requestId || query.search,
    );
    if (!hasFilter && !query.cursor && this.recentEntries.length > 0) {
      const entries = this.recentEntries.slice(-limit);
      const total = this.entryCountKnown ? this.entryCount : this.recentEntries.length;
      return { entries, nextCursor: total > entries.length ? String(entries.length) : null, total };
    }
    const files = await this.listFiles();
    const matched: WsLogEntry[] = [];
    let matchedTotal = 0;

    // 从新到旧读取，cursor 表示已经跳过的匹配记录数。
    for (const file of files) {
      let lines: string[];
      try {
        lines = (await fs.promises.readFile(path.join(logDirectory(), file), "utf8"))
          .split("\n").filter(Boolean);
      } catch {
        continue;
      }
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        let entry: WsLogEntry;
        try {
          entry = JSON.parse(lines[index]) as WsLogEntry;
        } catch {
          continue;
        }
        if (!matches(entry, query)) continue;
        if (matchedTotal++ < skip) continue;
        if (matched.length < limit) matched.push(entry);
      }
    }

    matched.reverse();
    const consumed = skip + matched.length;
    if (!hasFilter) {
      this.entryCount = matchedTotal;
      this.entryCountKnown = true;
      this.recentEntries = matched.slice(-500);
    }
    return {
      entries: matched,
      nextCursor: consumed < matchedTotal ? String(consumed) : null,
      total: matchedTotal,
    };
  }

  async clear(): Promise<void> {
    await this.flush();
    const files = await this.listFiles();
    await Promise.all(files.map((file) => fs.promises.rm(path.join(logDirectory(), file), { force: true })));
    this.dropped = 0;
    this.recentEntries = [];
    this.entryCount = 0;
    this.entryCountKnown = true;
    this.statsCache = { directory: logDirectory(), files: 0, bytes: 0, entries: 0, dropped: 0 };
    this.statsDirty = false;
  }

  private async append(inputs: WsLogInput[]): Promise<void> {
    const directory = logDirectory();
    await fs.promises.mkdir(directory, { recursive: true });
    const normalizedEntries: WsLogEntry[] = [];
    for (const input of inputs) {
      const entry = normalizeEntry(input);
      normalizedEntries.push(entry);
      const line = `${JSON.stringify(entry)}\n`;
      const current = path.join(directory, "ws-current.ndjson");
      let currentBytes = 0;
      try {
        currentBytes = (await fs.promises.stat(current)).size;
      } catch {
        currentBytes = 0;
      }
      if (currentBytes > 0 && currentBytes + byteLength(line) > MAX_FILE_BYTES) {
        await this.rotate(current, directory);
      }
      await fs.promises.appendFile(current, line, "utf8");
    }
    this.recentEntries.push(...normalizedEntries);
    if (this.recentEntries.length > 500) this.recentEntries.splice(0, this.recentEntries.length - 500);
    if (this.entryCountKnown) this.entryCount += normalizedEntries.length;
    await this.cleanup(directory);
  }

  private async rotate(current: string, directory: string): Promise<void> {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
    let sequence = 0;
    let target = path.join(directory, `ws-${stamp}-${sequence}.ndjson`);
    while (await exists(target)) {
      sequence += 1;
      target = path.join(directory, `ws-${stamp}-${sequence}.ndjson`);
    }
    await fs.promises.rename(current, target);
  }

  private async cleanup(directory: string): Promise<void> {
    const names = await this.listFiles();
    const now = Date.now();
    const records = await Promise.all(names.map(async (name) => {
      const filePath = path.join(directory, name);
      try {
        const stat = await fs.promises.stat(filePath);
        return { name, filePath, size: stat.size, mtime: stat.mtimeMs };
      } catch {
        return null;
      }
    }));
    const valid = records.filter((record): record is NonNullable<typeof record> => record !== null)
      .sort((a, b) => b.mtime - a.mtime);
    let total = 0;
    let removedAny = false;
    for (const [index, record] of valid.entries()) {
      const expired = now - record.mtime > MAX_AGE_MS;
      const overCount = index >= MAX_FILES;
      const overBytes = total + record.size > MAX_TOTAL_BYTES;
      if (expired || overCount || overBytes) {
        await fs.promises.rm(record.filePath, { force: true });
        removedAny = true;
      } else {
        total += record.size;
      }
    }
    if (removedAny) {
      this.entryCountKnown = false;
      this.recentEntries = [];
    }
  }

  private async listFiles(): Promise<string[]> {
    try {
      const names = await fs.promises.readdir(logDirectory());
      const files = names.filter(isLogFile);
      const stats = await Promise.all(files.map(async (name) => {
        try {
          return { name, mtime: (await fs.promises.stat(path.join(logDirectory(), name))).mtimeMs };
        } catch {
          return null;
        }
      }));
      return stats.filter((item): item is NonNullable<typeof item> => item !== null)
        .sort((a, b) => b.mtime - a.mtime)
        .map((item) => item.name);
    } catch {
      return [];
    }
  }
}

function matches(entry: WsLogEntry, query: WsLogQuery): boolean {
  if (query.sessionId && entry.sessionId !== query.sessionId) return false;
  if (query.direction && entry.direction !== query.direction) return false;
  if (query.type && entry.type !== query.type) return false;
  if (query.eventType && entry.eventType !== query.eventType) return false;
  if (query.requestId && entry.requestId !== query.requestId) return false;
  if (query.search) {
    const needle = query.search.toLowerCase();
    if (!entry.raw.toLowerCase().includes(needle)) return false;
  }
  return true;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

const writer = new WsLogWriter();

export function registerWsLogIPC(): void {
  ipcMain.on("ws-log:append-batch", (_event, entries: WsLogInput[]) => writer.appendBatch(entries));
  ipcMain.handle("ws-log:query", (_event, query: WsLogQuery) => writer.query(query));
  ipcMain.handle("ws-log:stats", () => writer.stats());
  ipcMain.handle("ws-log:clear", async () => {
    try {
      await writer.clear();
      return { success: true };
    } catch (error) {
      return { success: false, error: String(error) };
    }
  });
  ipcMain.handle("ws-log:reveal", () => shell.openPath(logDirectory()));
}





