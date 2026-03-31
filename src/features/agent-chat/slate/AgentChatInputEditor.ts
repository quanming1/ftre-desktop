/**
 * AgentChatInputEditor — Agent 群聊富文本输入编辑器逻辑层
 *
 * 职责：
 * - 创建并持有 Slate editor 实例（含 mention 插件）
 * - 提供内容操作 API（插入 mention chip、清空、序列化）
 * - 检测 @ 触发词，供 UI 层显示候选列表
 * - 不依赖 React，可独立测试
 */
import { createEditor, Transforms, Editor, Descendant, Element as SlateElement, Range } from 'slate';
import { withReact, ReactEditor } from 'slate-react';
import { withHistory } from 'slate-history';
import { withMentions } from './plugins';
import type { MentionRef, MentionChipElement } from './types';

export interface SerializedAgentInput {
  text: string;
  mentions: MentionRef[];
}

const EMPTY_VALUE: Descendant[] = [
  { type: 'paragraph', children: [{ text: '' }] },
];

export class AgentChatInputEditor {
  readonly editor: Editor;
  private _value: Descendant[] = EMPTY_VALUE;

  constructor() {
    this.editor = withMentions(withHistory(withReact(createEditor())));
  }

  // ── 状态 ──

  get value(): Descendant[] {
    return this._value;
  }

  /** Slate onChange 回调 */
  onChange = (value: Descendant[]): void => {
    this._value = value;
  };

  get initialValue(): Descendant[] {
    return EMPTY_VALUE;
  }

  // ── @ 检测 ──

  /**
   * 获取当前光标前的 @ 搜索词。
   * 如果光标前有 "@xxx"，返回 "xxx"（可能为空字符串表示刚输入 @）。
   * 如果没有触发 @，返回 null。
   */
  getMentionSearch(): { search: string; range: Range } | null {
    const { selection } = this.editor;
    if (!selection || !Range.isCollapsed(selection)) return null;

    const [start] = Range.edges(selection);
    const lineStart = Editor.before(this.editor, start, { unit: 'line' });
    if (!lineStart) return null;

    const beforeRange: Range = { anchor: lineStart, focus: start };
    const beforeText = Editor.string(this.editor, beforeRange);

    // 从文本末尾往前找 @，要求 @ 前面是空格/行首
    const atIndex = beforeText.lastIndexOf('@');
    if (atIndex === -1) return null;

    // @ 必须在行首或空格/换行符之后
    if (atIndex > 0 && !/\s/.test(beforeText[atIndex - 1])) return null;

    const search = beforeText.slice(atIndex + 1);

    // 搜索词中不应包含空格（空格表示 @ 已结束）
    if (/\s/.test(search)) return null;

    // 计算 @ 符号的精确位置
    const atPoint = Editor.before(this.editor, start, {
      unit: 'offset',
      distance: beforeText.length - atIndex,
    });
    if (!atPoint) return null;

    const mentionRange: Range = { anchor: atPoint, focus: start };
    return { search, range: mentionRange };
  }

  // ── 内容操作 ──

  /** 在指定 range（@搜索词所在范围）插入 mention chip */
  insertMention(ref: MentionRef, targetRange: Range): void {
    const chip: MentionChipElement = {
      type: 'mention-chip',
      mention: ref,
      children: [{ text: '' }],
    };

    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);

    // 插入一个空格方便继续输入
    Transforms.insertText(this.editor, ' ');
  }

  /** 清空编辑器内容 */
  clear(): void {
    Transforms.delete(this.editor, {
      at: {
        anchor: Editor.start(this.editor, []),
        focus: Editor.end(this.editor, []),
      },
    });
    const point = Editor.start(this.editor, []);
    Transforms.select(this.editor, point);
  }

  /** 聚焦编辑器 */
  focus(): void {
    ReactEditor.focus(this.editor as ReactEditor);
  }

  // ── 序列化 ──

  /** 将当前内容序列化 */
  serialize(): SerializedAgentInput {
    return AgentChatInputEditor.serializeValue(this._value);
  }

  get isEmpty(): boolean {
    const { text, mentions } = this.serialize();
    return text.trim().length === 0 && mentions.length === 0;
  }

  static serializeValue(nodes: Descendant[]): SerializedAgentInput {
    const textParts: string[] = [];
    const mentions: MentionRef[] = [];

    for (const node of nodes) {
      if (!SlateElement.isElement(node)) continue;

      if (node.type === 'paragraph') {
        const lineTexts: string[] = [];

        for (const child of node.children) {
          if (SlateElement.isElement(child) && child.type === 'mention-chip') {
            const chip = child as MentionChipElement;
            mentions.push(chip.mention);
            lineTexts.push(`@${chip.mention.memberName}`);
          } else if ('text' in child) {
            lineTexts.push((child as { text: string }).text);
          }
        }

        textParts.push(lineTexts.join(''));
      }
    }

    const text = textParts.join('\n').trim();
    return { text, mentions };
  }
}
