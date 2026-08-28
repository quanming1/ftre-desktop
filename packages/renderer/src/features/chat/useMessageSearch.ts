/**
 * useMessageSearch — MessageList 的 Ctrl+F 搜索状态机。
 *
 * 设计要点：
 * - 粒度为「消息条」：hits 是匹配的消息 id 列表，计数/导航都按条推进，
 *   避免 streaming 时文本长度变化导致"第 N 个匹配"漂移。
 * - query 经 200ms debounce 后才计算 hits：streaming 期间 messages 高频变化，
 *   每次 keystroke 全量提取文本会造成长会话卡顿。
 * - 文本提取覆盖：content（string）、parts[].text、blocks[].text。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChatMessage } from "@/stores/chat";

/** 提取一条消息的全部可搜索文本（换行拼接）。 */
export function extractMessageText(message: ChatMessage): string {
  const chunks: string[] = [];
  if (typeof message.content === "string" && message.content.trim()) {
    chunks.push(message.content);
  }
  // refill 回填消息运行时带 parts（类型未声明，宽松访问）
  const parts = (message as { parts?: Array<{ text?: string }> }).parts;
  if (Array.isArray(parts)) {
    for (const part of parts) {
      if (typeof part?.text === "string" && part.text.trim()) chunks.push(part.text);
    }
  }
  if (Array.isArray(message.blocks)) {
    for (const block of message.blocks) {
      if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
        chunks.push(block.text);
      }
    }
  }
  return chunks.join("\n");
}

export interface MessageSearchHit {
  msgId: string;
}

const DEBOUNCE_MS = 200;

export function useMessageSearch(messages: ChatMessage[]) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [current, setCurrent] = useState(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // query → debouncedQuery（200ms）
  useEffect(() => {
    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    debounceTimerRef.current = setTimeout(() => {
      setDebouncedQuery(query);
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [query]);

  // 匹配消息列表（大小写不敏感）
  const hits = useMemo<MessageSearchHit[]>(() => {
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return [];
    const out: MessageSearchHit[] = [];
    for (const message of messages) {
      if (extractMessageText(message).toLowerCase().includes(q)) {
        out.push({ msgId: message.id });
      }
    }
    return out;
  }, [messages, debouncedQuery]);

  // 新搜索（debounce 落定）重置游标；越界保护（messages 可能被清空/切换）
  useEffect(() => {
    setCurrent(0);
  }, [debouncedQuery]);
  useEffect(() => {
    if (current >= hits.length) setCurrent(hits.length ? hits.length - 1 : 0);
  }, [hits, current]);

  const next = useCallback(() => {
    if (!hits.length) return;
    setCurrent((c) => (c + 1) % hits.length);
  }, [hits.length]);

  const prev = useCallback(() => {
    if (!hits.length) return;
    setCurrent((c) => (c - 1 + hits.length) % hits.length);
  }, [hits.length]);

  const openSearch = useCallback(() => setOpen(true), []);
  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setDebouncedQuery("");
    setCurrent(0);
  }, []);

  const activeMsgId = open && hits.length ? hits[current]?.msgId ?? null : null;
  const total = open ? hits.length : 0;

  return {
    open,
    query,
    setQuery,
    debouncedQuery,
    current,
    total,
    hits,
    activeMsgId,
    next,
    prev,
    openSearch,
    closeSearch,
  };
}
