/**
 * ChatInputEditor — 富文本输入编辑器的逻辑层
 *
 * 职责：
 * - 创建并持有 Slate editor 实例（含插件链）
 * - 提供内容操作 API（插入 chip、清空、序列化）
 * - 检测 / 触发词，供 UI 层显示 skill 候选列表
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
  Range,
} from "slate";
import { withReact, ReactEditor } from "slate-react";
import { withHistory } from "slate-history";
import { withCodeChips, withArchiveChips, withSkillChips } from "./plugins";
import type {
  CodeRef,
  CodeChipElement,
  ArchiveRef,
  ArchiveChipElement,
  SkillRef,
  SkillChipElement,
} from "./types";
import type { MessagePart } from "@/types/chat";

// ── 图片附件校验常量（由附件栏使用，与后端 ws_channel 校验一致）──
export const IMAGE_MIME_WHITELIST: readonly string[] = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
];
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024; // 3 MB
export const IMAGE_MAX_PER_MESSAGE = 8;

/** 直接可作为 user_input.data.attachments 上送的形态 */
export interface ImageAttachmentDTO {
  type: "image";
  mime_type: string;
  data: string;
  name?: string;
}

export interface SerializedInput {
  text: string;
  codeRefs: CodeRef[];
  archiveRefs: ArchiveRef[];
  skillRefs: SkillRef[];
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
    // withReact → withHistory → withCodeChips → withArchiveChips → withSkillChips
    this.editor = withSkillChips(
      withArchiveChips(withCodeChips(withHistory(withReact(createEditor())))),
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

  // ── / 检测（Skill 触发）──

  /**
   * 获取当前光标前的 / 搜索词。
   * 如果光标前有 "/xxx"，返回 "xxx"（可能为空字符串表示刚输入 /）。
   * 如果没有触发 /，返回 null。
   */
  getSkillSearch(): { search: string; range: Range } | null {
    const { selection } = this.editor;
    if (!selection || !Range.isCollapsed(selection)) return null;

    const [start] = Range.edges(selection);
    const lineStart = Editor.before(this.editor, start, { unit: "line" });
    if (!lineStart) return null;

    const beforeRange: Range = { anchor: lineStart, focus: start };
    const beforeText = Editor.string(this.editor, beforeRange);

    // 从文本末尾往前找 /，要求 / 前面是空格/行首
    const slashIndex = beforeText.lastIndexOf("/");
    if (slashIndex === -1) return null;

    // / 必须在行首或空格/换行符之后
    if (slashIndex > 0 && !/\s/.test(beforeText[slashIndex - 1])) return null;

    const search = beforeText.slice(slashIndex + 1);

    // 搜索词中不应包含空格（空格表示 / 已结束）
    if (/\s/.test(search)) return null;

    // 计算 / 符号的精确位置
    const slashPoint = Editor.before(this.editor, start, {
      unit: "offset",
      distance: beforeText.length - slashIndex,
    });
    if (!slashPoint) return null;

    const skillRange: Range = { anchor: slashPoint, focus: start };
    return { search, range: skillRange };
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

  /** 在指定 range（/搜索词所在范围）插入 skill chip */
  insertSkillChip(ref: SkillRef, targetRange: Range): void {
    const chip: SkillChipElement = {
      type: "skill-chip",
      skillRef: ref,
      children: [{ text: "" }],
    };

    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);

    // 插入一个空格方便继续输入
    Transforms.insertText(this.editor, " ");
  }

  /** 在编辑器末尾插入 skill chip（用于从「+」菜单选择 skill，不依赖 / 搜索范围） */
  insertSkillChipAtEnd(ref: SkillRef): void {
    const chip: SkillChipElement = {
      type: "skill-chip",
      skillRef: ref,
      children: [{ text: "" }],
    };
    ReactEditor.focus(this.editor as ReactEditor);
    const end = Editor.end(this.editor, []);
    Transforms.select(this.editor, end);
    Transforms.insertNodes(this.editor, chip);
    Transforms.move(this.editor);
    Transforms.insertText(this.editor, " ");
  }

  /** 用纯文本替换指定 range（用于把 / 搜索词换成完整命令文本） */
  replaceRange(targetRange: Range, text: string): void {
    Transforms.select(this.editor, targetRange);
    Transforms.delete(this.editor);
    Transforms.insertText(this.editor, text);
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
    const { text, codeRefs, archiveRefs, skillRefs } = this.serialize();
    return (
      text.length === 0 &&
      codeRefs.length === 0 &&
      archiveRefs.length === 0 &&
      skillRefs.length === 0
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
    const skillRefs: SkillRef[] = [];
    const parts: MessagePart[] = [];

    for (const node of nodes) {
      if (!SlateElement.isElement(node)) continue;

      if (node.type === "paragraph") {
        const lineTexts: string[] = []; // 纯文本（不含 chip 占位符）
        let pendingText = ""; // 累积的文本，遇到 chip 时 flush

        const flush = () => {
          if (pendingText) {
            parts.push({ type: "text", data: pendingText });
            lineTexts.push(pendingText);
            pendingText = "";
          }
        };

        for (const child of node.children) {
          if (SlateElement.isElement(child) && child.type === "code-chip") {
            const chip = child as CodeChipElement;
            codeRefs.push(chip.codeRef);
            flush();
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
            flush();
            parts.push({
              type: "archive_ref",
              data: {
                id: chip.archiveRef.id,
                display: chip.archiveRef.label || chip.archiveRef.summary,
              },
            });
          } else if (
            SlateElement.isElement(child) &&
            child.type === "skill-chip"
          ) {
            const chip = child as SkillChipElement;
            skillRefs.push(chip.skillRef);
            flush();
            parts.push({
              type: "skill",
              data: chip.skillRef.name || chip.skillRef.id,
            });
          } else if ("text" in child) {
            pendingText += (child as { text: string }).text;
          }
        }

        flush();
        textParts.push(lineTexts.join(""));
      }
    }

    const fullText = textParts.join("\n").trim();
    const hasChips =
      codeRefs.length > 0 || archiveRefs.length > 0 || skillRefs.length > 0;

    // 纯文本（无 chip）时简化为单个 text part
    if (!hasChips) {
      return {
        text: fullText,
        codeRefs,
        archiveRefs,
        skillRefs,
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
      skillRefs,
      parts:
        cleanParts.length > 0 ? cleanParts : [{ type: "text", data: fullText }],
    };
  }
}
