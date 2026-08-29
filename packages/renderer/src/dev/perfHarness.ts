/**
 * perfHarness — MessageList 性能压测入口（仅 dev 构建动态加载，生产构建被静态消除）。
 *
 * 用途：构造大规模 mock 会话 + 模拟流式 delta，为 MessageList 性能优化提供
 * 可重复的测量基线。不触碰 WS / projection 真实链路——直接按 projection 的
 * 不可变约定（新数组 + 被修改消息新对象）写 store，重演完全相同的渲染路径。
 *
 * 用法（DevTools Console）：
 *   __ftrePerf.inject(300)                        // 注入 300 条历史消息
 *   __ftrePerf.start()                            // 以 10ms 间隔开始流式 delta（默认模拟）
 *   __ftrePerf.start({ intervalMs: 10, chunk: 8 }) // 自定义节奏
 *   __ftrePerf.stop()                             // 结束流式（streaming=false）
 *   __ftrePerf.report()                           // 输出 long task / flush 统计
 *   __ftrePerf.reset()                            // 清空回初始态
 *
 * 指标口径：
 * - flushes：模拟 delta 的 store 更新次数；
 * - flushJsMs：每次 setState 的同步 JS 耗时（不含 React 调度后的 commit）；
 * - longTasks：>50ms 的主线程任务数（PerformanceObserver longtask），
 *   期间平均 Long Task 总时长一并给出。
 */
import { useChat } from "@/stores/chat";
import type { ChatMessage, ContentBlock, ToolResult } from "@/stores/chat";

interface PerfReport {
  flushes: number;
  totalFlushJsMs: number;
  maxFlushJsMs: number;
  longTaskCount: number;
  longTaskTotalMs: number;
  streaming: boolean;
  messageCount: number;
}

interface StreamOptions {
  /** 两次 delta 的间隔毫秒（默认 10，模拟 WS 微批节奏） */
  intervalMs?: number;
  /** 每次 delta 追加的文本长度（默认 6~14 随机） */
  chunk?: number;
  /** 总 delta 次数上限（默认 Infinity，直到 stop） */
  maxDeltas?: number;
}

const SESSION_ID = "perf-mock-session";

let flushes = 0;
let totalFlushJsMs = 0;
let maxFlushJsMs = 0;
let longTaskCount = 0;
let longTaskTotalMs = 0;
let observer: PerformanceObserver | null = null;
let streamTimer: ReturnType<typeof setTimeout> | null = null;
let deltaCount = 0;

function ensureObserver(): void {
  if (observer || typeof PerformanceObserver === "undefined") return;
  observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      longTaskCount += 1;
      longTaskTotalMs += entry.duration;
    }
  });
  try {
    observer.observe({ entryTypes: ["longtask"] });
  } catch {
    // longtask 不支持时静默降级，flushJsMs 仍可用
  }
}

// ─── Mock 内容生成 ──────────────────────────────────────────────────

const MARKDOWN_SAMPLE = [
  "## 实现说明\n\n本方案分为三个阶段落地：\n\n1. **数据层**——先补齐快照去重\n2. **渲染层**——按块缓存 markdown 解析结果\n3. **交互层**——滚动位置补偿\n\n```ts\nexport function applySnapshot(b: State, snap: Payload): void {\n  const next = new Map(b.dedupe);\n  for (const ev of snap.events) next.set(ev.id, ev);\n  b.dedupe = next;\n}\n```\n\n> 注意：快照回放必须幂等，`request_id` 重复的事件直接丢弃。\n",
  "这里有一个边界情况需要处理：当 `blockId` 缺失时，`contentBlocksEqual` 会退化到逐字符比较。对长文本这开销不可忽略，建议上游保证 `block_id` 稳定。此外还需要考虑 **CRLF** 行尾在 markdown 列表中的表现差异。\n\n- 列表项一：稳定性\n- 列表项二：吞吐\n- 列表项三：内存\n\n| 场景 | 耗时 | 备注 |\n| --- | --- | --- |\n| 冷启动 | 120ms | 含首屏解析 |\n| 热更新 | 8ms | 仅尾块 |\n",
  "追加一段普通说明文字，用来撑起段落长度，观察流式追加过程中 markdown 分块与 React reconciliation 的开销是否随内容长度线性增长。".repeat(3) + "\n",
];

let mockSeq = 0;

function mockMarkdown(): string {
  return MARKDOWN_SAMPLE[mockSeq++ % MARKDOWN_SAMPLE.length];
}

function buildTurn(turnIndex: number): ChatMessage[] {
  const base = Date.now() - (1000 - turnIndex) * 60_000;
  const userMsg: ChatMessage = {
    id: `perf-u-${turnIndex}`,
    role: "user",
    content: `第 ${turnIndex} 个问题：请分析这个模块的性能瓶颈，并给出分阶段优化方案，注意流式场景。`,
    timestamp: base,
  };

  const toolId = `perf-tool-${turnIndex}`;
  const toolResult: ToolResult = {
    id: toolId,
    name: "read",
    result: `src/stores/chat.ts\n1| export const useChat = create(...)()\n2| // mock result line for perf harness, turn ${turnIndex}`,
    error: null,
    status: "completed",
  };
  const blocks: ContentBlock[] = [
    { type: "thinking", thinking: `先梳理消息列表的渲染链路，定位第 ${turnIndex} 轮需要修改的位置。重点看 memo 比较器与 store 订阅粒度。`, blockId: `perf-th-${turnIndex}` },
    { type: "toolCall", id: toolId, name: "read", arguments: { path: "src/stores/chat.ts" }, argumentsText: '{"path":"src/stores/chat.ts"}' },
    { type: "text", text: mockMarkdown(), blockId: `perf-tx-${turnIndex}` },
  ];
  const assistantMsg: ChatMessage = {
    id: `perf-a-${turnIndex}`,
    role: "assistant",
    content: blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""),
    blocks,
    toolResults: { [toolId]: toolResult },
    timestamp: base + 1000,
    streaming: false,
    durationSec: 3 + (turnIndex % 7),
    finishedAt: base + 4000,
    model: "perf/mock-model",
    token: {
      usage: { prompt_tokens: 1200 + turnIndex, completion_tokens: 800, total_tokens: 2000 + turnIndex },
      last_call_usage: { prompt_tokens: 1200, completion_tokens: 800, total_tokens: 2000 },
    },
  };
  return [userMsg, assistantMsg];
}

function buildSession(count: number): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let turn = 0;
  while (messages.length < count) {
    messages.push(...buildTurn(turn++));
  }
  // 追加一条待流式的 assistant 尾消息（空 text block，start 往里灌 delta）
  messages.push({
    id: "perf-a-live",
    role: "assistant",
    content: "",
    blocks: [{ type: "text", text: "", blockId: "perf-tx-live" }],
    toolResults: {},
    timestamp: Date.now(),
    streaming: false,
  });
  return messages;
}

// ─── 流式模拟（复刻 projection 的不可变更新约定）──────────────────────

function applyDelta(chunk: number): void {
  const state = useChat.getState();
  const messages = state.messages;
  if (!Array.isArray(messages) || messages.length === 0) return;
  const lastIndex = messages.length - 1;
  const tail = messages[lastIndex];
  if (tail.role !== "assistant") return;

  const blocks = [...(tail.blocks || [])];
  let lastTextIdx = -1;
  for (let i = blocks.length - 1; i >= 0; i--) {
    if (blocks[i].type === "text") { lastTextIdx = i; break; }
  }
  if (lastTextIdx < 0) return;
  const block = blocks[lastTextIdx];
  if (block.type !== "text") return;

  const words = "性能 基线 渲染 订阅 节流 缓存 布局 提交 补偿 增量 ";
  const append = (words.repeat(3) + "\n").slice(0, chunk) || "x";
  blocks[lastTextIdx] = { ...block, text: block.text + append };

  const next = [...messages];
  next[lastIndex] = {
    ...tail,
    streaming: true,
    blocks,
    content: blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(""),
  };

  const t0 = performance.now();
  useChat.setState({ messages: next });
  const dt = performance.now() - t0;
  flushes += 1;
  totalFlushJsMs += dt;
  if (dt > maxFlushJsMs) maxFlushJsMs = dt;
}

function startStream(options: StreamOptions = {}): void {
  const { intervalMs = 10, chunk = 10, maxDeltas = Infinity } = options;
  stopStream();
  ensureObserver();
  deltaCount = 0;
  const tick = () => {
    applyDelta(chunk);
    deltaCount += 1;
    if (deltaCount >= maxDeltas) {
      streamTimer = null;
      return;
    }
    streamTimer = setTimeout(tick, intervalMs);
  };
  tick();
}

function stopStream(): void {
  if (streamTimer) {
    clearTimeout(streamTimer);
    streamTimer = null;
  }
  const messages = useChat.getState().messages;
  if (Array.isArray(messages) && messages.length > 0) {
    const lastIndex = messages.length - 1;
    const tail = messages[lastIndex];
    if (tail.role === "assistant" && tail.streaming) {
      const next = [...messages];
      next[lastIndex] = { ...tail, streaming: false };
      useChat.setState({ messages: next });
    }
  }
}

// ─── 注册 ───────────────────────────────────────────────────────────

export function registerPerfHarness(): void {
  (window as unknown as Record<string, unknown>).__ftrePerf = {
    /** 注入 count 条历史消息（user/assistant 成对，含 thinking/toolCall/markdown） */
    inject(count = 300): number {
      stopStream();
      useChat.setState({
        sessionId: SESSION_ID,
        messages: buildSession(count),
        sessionStatus: "idle",
        sessionActivity: "idle",
        queueDepth: 0,
        pendingMessages: [],
      });
      return useChat.getState().messages.length;
    },
    start: startStream,
    stop: stopStream,
    report(): PerfReport {
      return {
        flushes,
        totalFlushJsMs: Math.round(totalFlushJsMs * 10) / 10,
        maxFlushJsMs: Math.round(maxFlushJsMs * 10) / 10,
        longTaskCount,
        longTaskTotalMs: Math.round(longTaskTotalMs),
        streaming: streamTimer != null,
        messageCount: Array.isArray(useChat.getState().messages) ? useChat.getState().messages.length : 0,
      };
    },
    reset(): void {
      stopStream();
      flushes = 0; totalFlushJsMs = 0; maxFlushJsMs = 0;
      longTaskCount = 0; longTaskTotalMs = 0; deltaCount = 0;
      useChat.setState({
        sessionId: null,
        messages: [],
        sessionStatus: "idle",
        sessionActivity: "idle",
        queueDepth: 0,
        pendingMessages: [],
      });
    },
    /** 供脚本读取的计数器（deltaCount 同 flushes，保留给未来细分指标） */
    counters(): { deltaCount: number } {
      return { deltaCount };
    },
  };
}
