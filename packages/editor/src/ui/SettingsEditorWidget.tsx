/**
 * SettingsEditorWidget — 设置编辑器 React 组件
 *
 * 封装 EditorPanes + SettingsEditorPane 架构
 * 通过 renderSettings prop 接收要渲染的 React 组件
 */

import { useRef, useEffect, useLayoutEffect, memo, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  EditorPanes,
  SettingsEditorInput,
  SettingsEditorPane,
  settingsEditorPaneDescriptor,
  type IEditorPaneFactory,
  type IEditorPaneDescriptor,
  type IEditorGroup,
  type SettingsRenderCallback,
  type SettingsUnmountCallback,
} from "../workbench";
import type { EditorInput } from "../workbench/editorInput";
import type { EditorPane } from "../workbench/editorPane";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

export interface SettingsEditorWidgetProps {
  /** 编辑器组 ID */
  groupId: number;
  /** 渲染设置内容的回调 */
  renderSettings: () => ReactNode;
}

// ═══════════════════════════════════════════════════════════════════════════
// 辅助函数
// ═══════════════════════════════════════════════════════════════════════════

/**
 * 创建简单的编辑器组实现
 */
function createSimpleEditorGroup(id: number): IEditorGroup {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const closeListeners: Array<(e: any) => void> = [];

  return {
    id,
    label: `Group ${id}`,
    activeEditor: undefined,
    onWillCloseEditor: (listener) => {
      closeListeners.push(listener);
      return {
        dispose: () => {
          const index = closeListeners.indexOf(listener);
          if (index !== -1) {
            closeListeners.splice(index, 1);
          }
        },
      };
    },
  };
}

/**
 * 创建 Settings 编辑器工厂
 */
function createSettingsEditorPaneFactory(
  renderCallback: SettingsRenderCallback,
  unmountCallback: SettingsUnmountCallback,
): IEditorPaneFactory {
  return {
    getDescriptor(input: EditorInput): IEditorPaneDescriptor | undefined {
      if (settingsEditorPaneDescriptor.canHandle(input)) {
        return settingsEditorPaneDescriptor;
      }
      return undefined;
    },

    createEditorPane(
      descriptor: IEditorPaneDescriptor,
      group: IEditorGroup,
    ): EditorPane {
      const pane = new SettingsEditorPane(group);
      pane.setRenderCallback(renderCallback, unmountCallback);
      return pane;
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 组件
// ═══════════════════════════════════════════════════════════════════════════

export const SettingsEditorWidget = memo(function SettingsEditorWidget({
  groupId,
  renderSettings,
}: SettingsEditorWidgetProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorPanesRef = useRef<EditorPanes | null>(null);
  const rootRef = useRef<Root | null>(null);
  const initializedRef = useRef(false);

  // 保持 renderSettings 的最新引用
  const renderSettingsRef = useRef(renderSettings);
  renderSettingsRef.current = renderSettings;

  /**
   * 初始化 EditorPanes
   */
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || initializedRef.current) return;

    initializedRef.current = true;

    // 创建工厂
    const factory = createSettingsEditorPaneFactory(
      // 渲染回调
      (paneContainer: HTMLElement) => {
        if (!rootRef.current) {
          rootRef.current = createRoot(paneContainer);
        }
        rootRef.current.render(renderSettingsRef.current());
      },
      // 卸载回调
      () => {
        if (rootRef.current) {
          rootRef.current.unmount();
          rootRef.current = null;
        }
      },
    );

    // 创建 EditorPanes
    const group = createSimpleEditorGroup(groupId);
    const panes = new EditorPanes(group, factory);
    panes.create(container);
    editorPanesRef.current = panes;

    // 打开 Settings
    const input = new SettingsEditorInput();
    panes.openEditor(input, undefined, {});

    return () => {
      // 清理
      if (rootRef.current) {
        rootRef.current.unmount();
        rootRef.current = null;
      }
      if (editorPanesRef.current) {
        editorPanesRef.current.dispose();
        editorPanesRef.current = null;
      }
      initializedRef.current = false;
    };
  }, [groupId]);

  /**
   * 当 renderSettings 变化时重新渲染
   */
  useEffect(() => {
    if (rootRef.current) {
      rootRef.current.render(renderSettingsRef.current());
    }
  }, [renderSettings]);

  return (
    <div
      ref={containerRef}
      className="settings-editor-widget"
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
});
