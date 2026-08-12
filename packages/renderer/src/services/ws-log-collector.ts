import type { WsLogInput } from "@ftre/shared";

const FLUSH_INTERVAL_MS = 100;
const MAX_BATCH_SIZE = 50;
const MAX_BUFFER_SIZE = 2_000;
const MAX_RAW_BYTES = 256 * 1024;

type LogDirection = WsLogInput["direction"];
type LogAttempt = NonNullable<WsLogInput["attempt"]>;

interface LogOptions {
  attempt?: LogAttempt;
  connectionId?: string;
}

/**
 * Renderer 侧的轻量收集器。
 *
 * 它只负责把 WS 帧转换成审计记录并批量交给 Electron；不把日志放进
 * Zustand，也不阻塞 WebSocket 的收发。真正的轮转和文件写入在主进程完成。
 */
class WsLogCollector {
  private buffer: WsLogInput[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dropped = 0;

  record(direction: LogDirection, raw: string, options: LogOptions = {}): void {
    let parsed: Record<string, any> | null = null;
    try {
      const value = JSON.parse(raw);
      if (value && typeof value === "object") parsed = value;
    } catch {
      // 原始文本仍然保留，解析失败本身也是需要审计的协议问题。
    }

    const data = parsed?.data && typeof parsed.data === "object" ? parsed.data : {};
    const metadata = parsed?.metadata && typeof parsed.metadata === "object"
      ? parsed.metadata
      : {};
    const compacted = compactRaw(raw);
    const eventType = typeof data.type === "string" ? data.type : undefined;
    this.enqueue({
      direction,
      attempt: options.attempt,
      connectionId: options.connectionId,
      type: typeof parsed?.type === "string" ? parsed.type : undefined,
      eventType,
      sessionId: this.stringValue(data.session_id) || this.stringValue(metadata.session_id),
      requestId: this.stringValue(data.request_id) || this.stringValue(metadata.request_id),
      frameId: this.stringValue(parsed?.frame_id),
      bytes: compacted.originalBytes,
      raw: compacted.raw,
      ...(compacted.truncated ? { truncated: true, originalBytes: compacted.originalBytes } : {}),
    });
  }

  recordSystem(type: string, raw: string, options: Omit<LogOptions, "attempt"> = {}): void {
    this.enqueue({
      direction: "system",
      connectionId: options.connectionId,
      type,
      bytes: new TextEncoder().encode(raw).byteLength,
      raw,
    });
  }

  private enqueue(entry: WsLogInput): void {
    if (this.buffer.length >= MAX_BUFFER_SIZE) {
      const deltaIndex = this.buffer.findIndex((item) => item.eventType?.endsWith("_DELTA"));
      if (deltaIndex >= 0) this.buffer.splice(deltaIndex, 1);
      else this.buffer.shift();
      this.dropped += 1;
    }
    this.buffer.push(entry);
    if (this.buffer.length >= MAX_BATCH_SIZE) {
      void this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, FLUSH_INTERVAL_MS);
    }
  }

  private async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    const entries = this.buffer.splice(0, this.buffer.length);
    if (this.dropped > 0) {
      entries.unshift({
        direction: "system",
        type: "log_dropped",
        bytes: 0,
        raw: JSON.stringify({ dropped: this.dropped, reason: "renderer_buffer_full" }),
      });
      this.dropped = 0;
    }
    if (typeof window === "undefined" || !window.desktop?.wsLog) return;
    try {
      window.desktop.wsLog.appendBatch(entries);
    } catch (error) {
      // IPC 故障不能影响聊天；下次只记录新的日志，避免无限堆积。
      console.warn("[ws-log] IPC append failed", error);
    }
  }

  private stringValue(value: unknown): string | undefined {
    return typeof value === "string" && value ? value : undefined;
  }
}

/** 大型流式帧只保留头尾，避免单个响应把渲染进程的日志缓冲撑爆。 */
function compactRaw(raw: string): { raw: string; originalBytes: number; truncated: boolean } {
  const bytes = new TextEncoder().encode(raw);
  if (bytes.byteLength <= MAX_RAW_BYTES) {
    return { raw, originalBytes: bytes.byteLength, truncated: false };
  }
  const marker = `\n...[truncated ${bytes.byteLength - MAX_RAW_BYTES} bytes]...\n`;
  const markerBytes = new TextEncoder().encode(marker).byteLength;
  const half = Math.max(1, Math.floor((MAX_RAW_BYTES - markerBytes) / 2));
  const decoder = new TextDecoder();
  return {
    raw: `${decoder.decode(bytes.slice(0, half))}${marker}${decoder.decode(bytes.slice(-half))}`,
    originalBytes: bytes.byteLength,
    truncated: true,
  };
}

export const wsLogCollector = new WsLogCollector();
