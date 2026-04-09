/**
 * settingsEditorInput.ts — 设置编辑器输入
 *
 * 参考 VSCode 的 SettingsEditorInput
 */

import { EditorInput, type ISerializedEditorInput } from "./editorInput";

/**
 * SettingsEditorInput — 设置编辑器的输入
 *
 * 每个 EditorGroup 可以有独立的 Settings Tab
 */
export class SettingsEditorInput extends EditorInput {
  static readonly TYPE_ID = "workbench.editors.settingsEditor";
  static readonly RESOURCE = "ftre://settings";

  readonly typeId = SettingsEditorInput.TYPE_ID;

  private static _instanceCounter = 0;
  private readonly _instanceId: number;

  constructor() {
    super();
    this._instanceId = ++SettingsEditorInput._instanceCounter;
  }

  /**
   * 资源 URI（虚拟路径）
   */
  get resource(): string {
    return SettingsEditorInput.RESOURCE;
  }

  /**
   * 序列化（Settings 不需要序列化额外数据）
   */
  serialize(): ISerializedEditorInput {
    return {
      typeId: this.typeId,
    };
  }

  override getName(): string {
    return "Settings";
  }

  override getDescription(): string {
    return "";
  }

  override matches(other: EditorInput): boolean {
    // 每个 SettingsEditorInput 实例是独立的（支持多 Group）
    return this === other;
  }

  /**
   * 获取实例 ID（用于调试）
   */
  get instanceId(): number {
    return this._instanceId;
  }
}
