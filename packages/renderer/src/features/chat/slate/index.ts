/**
 * Slate 模块公共入口
 *
 * 外部只需从这里导入，不需要深入到子目录。
 */
export { ChatInputEditor } from "./ChatInputEditor";
export type {
  SerializedInput,
  ImageAttachmentDTO,
} from "./ChatInputEditor";
export {
  IMAGE_MIME_WHITELIST,
  IMAGE_MAX_BYTES,
  IMAGE_MAX_PER_MESSAGE,
} from "./ChatInputEditor";
export { renderElement } from "./renderer";
export type {
  MentionRef,
  MentionChipElement,
  SkillRef,
  SkillChipElement,
  ImageRef,
  CustomElement,
  CustomText,
} from "./types";
