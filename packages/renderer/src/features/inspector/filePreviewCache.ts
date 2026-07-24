/**
 * FilePreviewCache — LRU 文件内容缓存，带 mtime 校验和轮询。
 *
 * - LRU 驱逐：上限 50 个，超出时淘汰最久未访问的
 * - mtime 校验：get 时乐观返回缓存，后台轮询 3s 一次用 fs:stat 校验
 * - mtime 不一致 → 清除缓存 → 触发 onInvalidate 回调
 * - delete(path)：关闭 tab 时主动清理
 */
import { createManagedInterval } from "@/services/visibility-manager";

export interface CacheEntry {
  content: string;
  language: string;
  mtime: number;
}

type InvalidateListener = (filePath: string) => void;

const MAX_ENTRIES = 50;
const POLL_INTERVAL_MS = 3000;

class FilePreviewCache {
  private cache = new Map<string, CacheEntry>();
  private listeners = new Set<InvalidateListener>();
  private cancelPoll: (() => void) | null = null;

  /** 启动轮询。在首个 entry 写入时自动启动。 */
  private startPolling() {
    if (this.cancelPoll) return;
    this.cancelPoll = createManagedInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** 停止轮询。在 cache 清空时自动停止。 */
  private stopPolling() {
    if (this.cancelPoll) {
      this.cancelPoll();
      this.cancelPoll = null;
    }
  }

  /** 轮询：检查所有缓存文件的 mtime 是否变化。 */
  private async poll() {
    if (this.cache.size === 0) return;
    const paths = [...this.cache.keys()];
    const invalidated: string[] = [];
    for (const p of paths) {
      try {
        const result = await window.desktop.fs.stat(p);
        const entry = this.cache.get(p);
        if (!entry) continue;
        if (result.mtime === null || result.mtime !== entry.mtime) {
          this.cache.delete(p);
          invalidated.push(p);
        }
      } catch {
        // stat 失败（文件被删除等），清除缓存
        if (this.cache.has(p)) {
          this.cache.delete(p);
          invalidated.push(p);
        }
      }
    }
    if (this.cache.size === 0) this.stopPolling();
    for (const p of invalidated) {
      this.listeners.forEach((fn) => fn(p));
    }
  }

  /** 写入缓存。LRU：Map 保持插入顺序，set 时先 delete 再 set 让它排到最后。 */
  set(filePath: string, entry: CacheEntry) {
    if (this.cache.has(filePath)) {
      this.cache.delete(filePath);
    } else if (this.cache.size >= MAX_ENTRIES) {
      // 淘汰最久未访问的（Map 的第一个 key）
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(filePath, entry);
    this.startPolling();
  }

  /** 乐观读取缓存。不阻塞，不校验 mtime（轮询负责校验）。 */
  get(filePath: string): CacheEntry | null {
    const entry = this.cache.get(filePath);
    if (!entry) return null;
    // LRU：访问时移到末尾
    this.cache.delete(filePath);
    this.cache.set(filePath, entry);
    return entry;
  }

  has(filePath: string): boolean {
    return this.cache.has(filePath);
  }

  /** 删除单个缓存。关闭 tab 时调用。 */
  delete(filePath: string) {
    this.cache.delete(filePath);
    if (this.cache.size === 0) this.stopPolling();
  }

  /** 清空全部缓存。 */
  clear() {
    this.cache.clear();
    this.stopPolling();
  }

  /** 注册缓存失效监听器。mtime 变化时触发。返回取消注册函数。 */
  onInvalidate(fn: InvalidateListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

export const filePreviewCache = new FilePreviewCache();
