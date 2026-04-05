/**
 * Slate 模块公共入口
 *
 * 外部只需从这里导入，不需要深入到子目录。
 */
export { ChatInputEditor } from "./ChatInputEditor";
export type { SerializedInput } from "./ChatInputEditor";
export { renderElement } from "./renderer";
export type {
  CodeRef,
  CodeChipElement,
  ArchiveRef,
  ArchiveChipElement,
  MentionRef,
  MentionChipElement,
  CustomElement,
  CustomText,
} from "./types";
