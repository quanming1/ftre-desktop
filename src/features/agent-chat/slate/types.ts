/**
 * Agent Chat Slate 类型 — 从全局 Slate 类型中 re-export
 *
 * Slate 的 CustomTypes 只能声明一次（在 chat/slate/types.ts 中），
 * 这里只做 re-export 供 agent-chat 模块内部使用。
 */
export type {
  MentionRef,
  MentionChipElement,
  ParagraphElement,
  CustomElement,
  CustomText,
} from '@/features/chat/slate/types';
