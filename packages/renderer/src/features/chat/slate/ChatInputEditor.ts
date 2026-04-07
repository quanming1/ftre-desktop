/**
 * ChatInputEditor — 富文本输入编辑器的逻辑层
 *
 * 职责：
 * - 创建并持有 Slate editor 实例（含插件链）
 * - 提供内容操作 API（插入 chip、清空、序列化）
 * - 不依赖 React，可独立测试
 *
 * 设计原则：
 * - UI 组件（ChatInput.tsx）只调用本类的方法，不直接操作 Slate API
 * - 新增 element 类型时，在 plugins/ 加插件，在 elements/ 加渲染，
 *   在本类加对应的 insert 方法和序列化逻辑
 */
import {
  createEditor,
  Transforms,
  Editor,
  Descendant,
  Element as SlateElement,
} from "slate";
import { withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import { withCodeChips, withArchiveChips } from "./plugins";
import type {
  CodeRef,
  CodeChipElement,
  ArchiveRef,
  ArchiveChipElement,
} from "./types";
import type { MessagePart } from "@/types/chat";

export interface SerializedInput {
  text: string;
  codeRefs: CodeRef[];
  archiveRefs: ArchiveRef[];
  parts: MessagePart[];
}

const EMPTY_VALUE: Descendant[] = [
  { type: "paragraph", children: [{ text: "" }] },
];

export class ChatInputEditor {
  readonly editor: Editor;
  private _value: Descendant[] = EMPTY_VALUE;

  constructor() {
    // 插件链：顺序 = 最内层先应用
    // withReact → withHistory → withCodeChips → withArchiveChips
    this.editor = withArchiveChips(
      withCodeChips(withHistory(withReact(createEditor()))),
    );
  }

  // ── 状态 ──

  get value(): Descendant[] {
    return this._value;
  }

  /** Slate onChange 回调，由 <Slate> 组件调用 */
  onChange = (value: Descendant[]): void => {
    this._value = value;
  };

  get initialValue(): Descendant[] {
    return EMPTY_VALUE;
  }

  // ── 内容操作 ──

  /** 在光标位置插入代码引用 chip */
  insertCodeChip(ref: CodeRef): void {
    const chip: CodeChipElement = {
      type: "code-chip",
      codeRef: ref,
      children: [{ text: "" }],
    };
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);
  }

  /** 在光标位置插入归档引用 chip */
  insertArchiveChip(ref: ArchiveRef): void {
    const chip: ArchiveChipElement = {
      type: "archive-chip",
      archiveRef: ref,
      children: [{ text: "" }],
    };
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);
  }

  /** 清空编辑器内容，恢复到初始状态 */
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

  // ── 内容恢复 ──

  /** 从后端返回的 parts 数组恢复输入框内容 */
  setContent(parts: Array<{ type: string; data: unknown }>): void {
    // 1. 清空现有内容
    this.clear();

    // 2. 遍历 parts 数组并插入内容
    for (const part of parts) {
      if (part.type === "text") {
        // 插入文本
        const text = part.data as string;
        if (text) {
          Transforms.insertText(this.editor, text);
        }
      } else if (part.type === "code_ref") {
        // 转换 data 为 CodeRef 格式并插入
        const data = part.data as {
          path: string;
          name: string;
          lines: [number, number];
          raw: string;
        };
        const codeRef: CodeRef = {
          filePath: data.path,
          fileName: data.name,
          startLine: data.lines[0],
          endLine: data.lines[1],
          content: data.raw,
        };
        this.insertCodeChip(codeRef);
      } else if (part.type === "archive_ref") {
        // 转换 data 为 ArchiveRef 格式并插入
        const data = part.data as {
          id: string;
          display: string;
        };
        const archiveRef: ArchiveRef = {
          id: data.id,
          summary: data.display,
          turnCount: 0,
          totalMessages: 0,
          label: data.display,
          createdAt: 0,
        };
        this.insertArchiveChip(archiveRef);
      }
    }

    // 3. 聚焦编辑器
    this.focus();
  }

  // ── 序列化 ──

  /** 将当前内容序列化为发送给后端的格式 */
  serialize(): SerializedInput {
    return ChatInputEditor.serializeValue(this._value);
  }

  /** 检查当前内容是否为空 */
  get isEmpty(): boolean {
    const { text, codeRefs, archiveRefs } = this.serialize();
    return (
      text.length === 0 && codeRefs.length === 0 && archiveRefs.length === 0
    );
  }

  /**
   * 静态序列化方法，可用于不持有实例时的序列化
   * （如从快照恢复时）
   */
  static serializeValue(nodes: Descendant[]): SerializedInput {
    const textParts: string[] = [];
    const codeRefs: CodeRef[] = [];
    const archiveRefs: ArchiveRef[] = [];
    const parts: MessagePart[] = [];

    for (const node of nodes) {
      if (!SlateElement.isElement(node)) continue;

      if (node.type === "paragraph") {
        const lineTexts: string[] = []; // 纯文本（不含 chip 占位符）
        let pendingText = ""; // 累积的文本，遇到 chip 时 flush

        for (const child of node.children) {
          if (SlateElement.isElement(child) && child.type === "code-chip") {
            const chip = child as CodeChipElement;
            codeRefs.push(chip.codeRef);

            // flush 累积的文本到 parts
            if (pendingText) {
              parts.push({ type: "text", data: pendingText });
              lineTexts.push(pendingText);
              pendingText = "";
            }

            parts.push({
              type: "code_ref",
              data: {
                path: chip.codeRef.filePath,
                name: chip.codeRef.fileName,
                lines: [chip.codeRef.startLine, chip.codeRef.endLine],
                raw: chip.codeRef.content,
              },
            });
          } else if (
            SlateElement.isElement(child) &&
            child.type === "archive-chip"
          ) {
            const chip = child as ArchiveChipElement;
            archiveRefs.push(chip.archiveRef);

            // flush 累积的文本到 parts
            if (pendingText) {
              parts.push({ type: "text", data: pendingText });
              lineTexts.push(pendingText);
              pendingText = "";
            }

            parts.push({
              type: "archive_ref",
              data: {
                id: chip.archiveRef.id,
                display: chip.archiveRef.label || chip.archiveRef.summary,
              },
            });
          } else if ("text" in child) {
            pendingText += (child as { text: string }).text;
          }
        }

        // flush 段落末尾的文本
        if (pendingText) {
          parts.push({ type: "text", data: pendingText });
          lineTexts.push(pendingText);
        }

        textParts.push(lineTexts.join(""));
      }
    }

    const fullText = textParts.join("\n").trim();
    const hasChips = codeRefs.length > 0 || archiveRefs.length > 0;

    // 纯文本（无 chip）时简化为单个 text part
    if (!hasChips) {
      return {
        text: fullText,
        codeRefs,
        archiveRefs,
        parts: fullText ? [{ type: "text", data: fullText }] : [],
      };
    }

    // 过滤空白 text parts
    const cleanParts = parts.filter(
      (p) => !(p.type === "text" && !p.data.trim()),
    );

    return {
      text: fullText,
      codeRefs,
      archiveRefs,
      parts:
        cleanParts.length > 0 ? cleanParts : [{ type: "text", data: fullText }],
    };
  }
}
