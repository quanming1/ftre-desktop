/**
 * EditorPartView - EditorPart 的 React 包装组件
 *
 * 支持多编辑器组和分屏功能：
 * - 管理 EditorPart 实例
 * - 提供分屏操作 API
 * - 与 React 状态同步
 */

import {
  useRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  forwardRef,
  memo,
} from "react";
import * as monaco from "monaco-editor";
import {
  EditorPart,
  createEditorPart,
  EditorGroup,
  FileEditorInput,
  SplitDirection,
  GroupDirection,
  GroupLocation,
  saveAllEditorMementos,
  getTextModelResolverService,
  type IEditorOptions,
  type IDimension,
  type IEditorPartLayoutState,
  type IEditorLayoutState,
} from "../workbench";
import {
  CodeEditorPaneFactory,
  type IContentStore,
  type ICodeEditorPaneFactoryOptions,
} from "./CodeEditorPaneFactory";
import { registerFtreTheme } from "./theme-registry";
import { initTextMateGrammars } from "./textmate-registry";
import "./textmate-grammars"; // 注册所有 grammar（副作用 import）
import { getActiveThemeId } from "./themes";

// ═══════════════════════════════════════════════════════════════════════════
// 类型定义
// ═══════════════════════════════════════════════════════════════════════════

export interface EditorFile {
  /** 文件路径 */
  path: string;
  /** 文件名 */
  name: string;
  /** 语言 ID */
  language: string;
  /** 文件内容 */
  content: string;
  /** 是否已加载 */
  loaded: boolean;
}

export interface EditorPartViewProps {
  /** 初始文件（可选） */
  initialFile?: EditorFile;
  /** minimap 是否启用 */
  minimapEnabled?: boolean;
  /** 初始布局方向 */
  initialOrientation?: SplitDirection;
  /** 内容变化回调 */
  onContentChange?: (path: string, groupId: number) => void;
  /** dirty 状态变化回调 */
  onDirtyChange?: (path: string, dirty: boolean, groupId: number) => void;
  /** 光标位置变化回调 */
  onCursorChange?: (line: number, column: number, groupId: number) => void;
  /** 保存文件回调 */
  onSave?: (path: string, content: string) => Promise<boolean>;
  /** 活动组变化回调 */
  onActiveGroupChange?: (groupId: number | undefined) => void;
  /** 组数量变化回调 */
  onGroupCountChange?: (count: number) => void;
  /** 内容存储（用于获取文件内容） */
  contentStore?: IContentStore;
}

/**
 * EditorPartView 的命令式 API
 */
export interface EditorPartViewHandle {
  /** 打开编辑器 */
  openEditor: (
    file: EditorFile,
    options?: IEditorOptions,
    groupId?: number
  ) => Promise<void>;
  /** 关闭编辑器 */
  closeEditor: (path: string, groupId?: number) => Promise<void>;
  /** 分屏 */
  splitEditor: (direction: GroupDirection) => EditorGroup | undefined;
  /** 合并所有组 */
  mergeAllGroups: () => void;
  /** 设置布局方向 */
  setOrientation: (orientation: SplitDirection) => void;
  /** 激活组 */
  activateGroup: (groupId: number) => void;
  /** 获取活动组 ID */
  getActiveGroupId: () => number | undefined;
  /** 获取所有组 ID */
  getGroupIds: () => number[];
  /** 获取布局状态 */
  getLayoutState: () => IEditorPartLayoutState;
  /** 恢复布局状态 */
  restoreLayoutState: (state: IEditorPartLayoutState) => Promise<void>;
  /** 布局 */
  layout: (dimension?: IDimension) => void;
  /** 获取焦点 */
  focus: () => void;
  /** 保存状态 */
  saveState: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
// 组件实现
// ═══════════════════════════════════════════════════════════════════════════

export const EditorPartView = memo(
  forwardRef<EditorPartViewHandle, EditorPartViewProps>(
    function EditorPartView(
      {
        initialFile,
        minimapEnabled = true,
        initialOrientation = SplitDirection.HORIZONTAL,
        onContentChange,
        onDirtyChange,
        onCursorChange,
        onSave,
        onActiveGroupChange,
        onGroupCountChange,
        contentStore,
      },
      ref
    ) {
      // 容器 ref
      const containerRef = useRef<HTMLDivElement>(null);

      // EditorPart 实例
      const editorPartRef = useRef<EditorPart | null>(null);

      // 工厂实例
      const factoryRef = useRef<CodeEditorPaneFactory | null>(null);

      // 是否已初始化
      const initializedRef = useRef(false);

      // 内容存储 ref
      const contentStoreRef = useRef<IContentStore>(
        contentStore || {
          getContent: () => undefined,
          getLanguage: () => undefined,
        }
      );

      // 当前文件缓存（用于内容提供者）
      const filesCacheRef = useRef<Map<string, EditorFile>>(new Map());

      // 更新内容存储
      if (contentStore) {
        contentStoreRef.current = contentStore;
      }

      /**
       * 获取活动组
       */
      const getActiveGroup = useCallback((): EditorGroup | undefined => {
        return editorPartRef.current?.activeGroup;
      }, []);

      /**
       * 打开编辑器
       */
      const openEditor = useCallback(
        async (
          file: EditorFile,
          options?: IEditorOptions,
          groupId?: number
        ): Promise<void> => {
          const part = editorPartRef.current;
          if (!part) return;

          // 缓存文件内容
          filesCacheRef.current.set(file.path, file);

          // 获取目标组
          let group: EditorGroup | undefined;
          if (groupId !== undefined) {
            group = part.getGroup(groupId);
          }
          group = group || part.activeGroup;

          if (!group) return;

          // 创建 EditorInput
          const input = new FileEditorInput({
            path: file.path,
            name: file.name,
            language: file.language,
          });

          await group.openEditor(input, options);
        },
        []
      );

      /**
       * 关闭编辑器
       */
      const closeEditor = useCallback(
        async (path: string, groupId?: number): Promise<void> => {
          const part = editorPartRef.current;
          if (!part) return;

          // 创建临时 input 用于匹配
          const input = new FileEditorInput({ path });

          // 获取目标组
          let group: EditorGroup | undefined;
          if (groupId !== undefined) {
            group = part.getGroup(groupId);
          } else {
            group = part.findGroup(input);
          }

          if (group) {
            await group.closeEditor(input);
          }
        },
        []
      );

      /**
       * 分屏
       */
      const splitEditor = useCallback(
        (direction: GroupDirection): EditorGroup | undefined => {
          const part = editorPartRef.current;
          if (!part) return undefined;

          return part.addGroup(GroupLocation.NEXT, direction, {
            activate: true,
            copyActiveEditor: true,
          });
        },
        []
      );

      /**
       * 合并所有组
       */
      const mergeAllGroups = useCallback((): void => {
        const part = editorPartRef.current;
        if (!part) return;

        part.mergeAllGroups();
      }, []);

      /**
       * 设置布局方向
       */
      const setOrientation = useCallback(
        (orientation: SplitDirection): void => {
          const part = editorPartRef.current;
          if (!part) return;

          part.setOrientation(orientation);
        },
        []
      );

      /**
       * 激活组
       */
      const activateGroup = useCallback((groupId: number): void => {
        const part = editorPartRef.current;
        if (!part) return;

        const group = part.getGroup(groupId);
        if (group) {
          part.activateGroup(group);
        }
      }, []);

      /**
       * 获取活动组 ID
       */
      const getActiveGroupId = useCallback((): number | undefined => {
        return editorPartRef.current?.activeGroup?.id;
      }, []);

      /**
       * 获取所有组 ID
       */
      const getGroupIds = useCallback((): number[] => {
        const part = editorPartRef.current;
        if (!part) return [];
        return part.groups.map((g) => g.id);
      }, []);

      /**
       * 获取布局状态
       */
      const getLayoutState = useCallback((): IEditorPartLayoutState => {
        const part = editorPartRef.current;
        if (!part) {
          return {
            groups: [],
            activeGroupId: -1,
            orientation: SplitDirection.HORIZONTAL,
          };
        }
        return part.getLayoutState();
      }, []);

      /**
       * 恢复布局状态
       */
      const restoreLayoutState = useCallback(
        async (state: IEditorPartLayoutState): Promise<void> => {
          const part = editorPartRef.current;
          if (!part) return;

          await part.restoreLayoutState(
            state,
            (layout: IEditorLayoutState) => {
              if (layout.resource) {
                return new FileEditorInput({
                  path: layout.resource,
                });
              }
              return undefined;
            }
          );
        },
        []
      );

      /**
       * 布局
       */
      const layout = useCallback((dimension?: IDimension): void => {
        const part = editorPartRef.current;
        if (!part) return;

        if (dimension) {
          part.layout(dimension);
        } else if (containerRef.current) {
          const rect = containerRef.current.getBoundingClientRect();
          part.layout({ width: rect.width, height: rect.height });
        }
      }, []);

      /**
       * 获取焦点
       */
      const focus = useCallback((): void => {
        const group = getActiveGroup();
        group?.focus();
      }, [getActiveGroup]);

      /**
       * 保存状态
       */
      const saveState = useCallback((): void => {
        const part = editorPartRef.current;
        if (part) {
          part.saveState();
        }
        saveAllEditorMementos();
      }, []);

      // 暴露命令式 API
      useImperativeHandle(
        ref,
        () => ({
          openEditor,
          closeEditor,
          splitEditor,
          mergeAllGroups,
          setOrientation,
          activateGroup,
          getActiveGroupId,
          getGroupIds,
          getLayoutState,
          restoreLayoutState,
          layout,
          focus,
          saveState,
        }),
        [
          openEditor,
          closeEditor,
          splitEditor,
          mergeAllGroups,
          setOrientation,
          activateGroup,
          getActiveGroupId,
          getGroupIds,
          getLayoutState,
          restoreLayoutState,
          layout,
          focus,
          saveState,
        ]
      );

      /**
       * 初始化
       */
      useEffect(() => {
        if (!containerRef.current || initializedRef.current) return;

        // 注册主题
        registerFtreTheme(monaco);

        // 初始化 TextMate grammar（幂等，异步不阻塞）
        initTextMateGrammars(monaco).catch((e) => {
          console.warn("[TextMate] grammar init failed:", e);
        });

        // 初始化 TextModelResolverService
        const modelService = getTextModelResolverService();
        if (!modelService.isInitialized()) {
          modelService.init(monaco);
        }

        // 创建内容存储（支持文件缓存）
        const combinedContentStore: IContentStore = {
          getContent: (path: string) => {
            // 先检查文件缓存
            const cached = filesCacheRef.current.get(path);
            if (cached) {
              return cached.content;
            }
            // 回退到外部内容存储
            return contentStoreRef.current.getContent(path);
          },
          getLanguage: (path: string) => {
            const cached = filesCacheRef.current.get(path);
            if (cached) {
              return cached.language;
            }
            return contentStoreRef.current.getLanguage(path);
          },
        };

        // 创建工厂配置
        const factoryOptions: ICodeEditorPaneFactoryOptions = {
          monaco,
          editorOptions: {
            fontSize: 14,
            fontFamily:
              "'JetBrains Mono', 'Cascadia Code', 'Consolas', monospace",
            lineHeight: 22,
            minimap: { enabled: minimapEnabled },
            scrollBeyondLastLine: false,
            renderLineHighlight: "line",
            padding: { top: 10, bottom: 10 },
            smoothScrolling: false,
            theme: getActiveThemeId(),
          },
          callbacks: {
            onDidChangeContent: (resource) => {
              const groupId = getActiveGroupId();
              if (groupId !== undefined) {
                onContentChange?.(resource, groupId);
              }
            },
            onDidChangeDirty: (resource, dirty) => {
              const groupId = getActiveGroupId();
              if (groupId !== undefined) {
                onDirtyChange?.(resource, dirty, groupId);
              }
            },
            onDidChangeCursorPosition: (line, column) => {
              const groupId = getActiveGroupId();
              if (groupId !== undefined) {
                onCursorChange?.(line, column, groupId);
              }
            },
            onSaveRequest: async (resource, content) => {
              if (onSave) {
                return await onSave(resource, content);
              }
              return false;
            },
          },
          contentStore: combinedContentStore,
        };

        // 创建工厂
        const factory = new CodeEditorPaneFactory(factoryOptions);
        factoryRef.current = factory;

        // 创建 EditorPart
        const part = createEditorPart(factory);
        part.create(containerRef.current);

        // 设置初始方向
        part.setOrientation(initialOrientation);

        editorPartRef.current = part;
        initializedRef.current = true;

        // 监听活动组变化
        const activeGroupDisposable = part.onDidChangeActiveGroup((group) => {
          onActiveGroupChange?.(group?.id);
        });

        // 监听组添加/移除
        const addGroupDisposable = part.onDidAddGroup(() => {
          onGroupCountChange?.(part.count);
        });

        const removeGroupDisposable = part.onDidRemoveGroup(() => {
          onGroupCountChange?.(part.count);
        });

        // 初始布局
        const rect = containerRef.current.getBoundingClientRect();
        part.layout({ width: rect.width, height: rect.height });

        // 触发初始组数量
        onGroupCountChange?.(part.count);

        // 打开初始文件
        if (initialFile && initialFile.loaded) {
          openEditor(initialFile);
        }

        // ResizeObserver
        let rafId: number | null = null;
        const resizeObserver = new ResizeObserver(() => {
          if (rafId) return;
          rafId = requestAnimationFrame(() => {
            rafId = null;
            if (containerRef.current && editorPartRef.current) {
              const rect = containerRef.current.getBoundingClientRect();
              editorPartRef.current.layout({
                width: rect.width,
                height: rect.height,
              });
            }
          });
        });
        resizeObserver.observe(containerRef.current);

        return () => {
          // 保存状态
          saveState();

          // 清理 ResizeObserver
          if (rafId) {
            cancelAnimationFrame(rafId);
          }
          resizeObserver.disconnect();

          // 清理事件监听
          activeGroupDisposable.dispose();
          addGroupDisposable.dispose();
          removeGroupDisposable.dispose();

          // 销毁 EditorPart
          if (editorPartRef.current) {
            editorPartRef.current.dispose();
            editorPartRef.current = null;
          }

          factoryRef.current = null;
          initializedRef.current = false;
          filesCacheRef.current.clear();
        };
      }, []); // 只在挂载时执行一次

      // minimap 设置变化
      useEffect(() => {
        if (!initializedRef.current) return;

        // 更新所有组的编辑器选项
        const part = editorPartRef.current;
        if (part) {
          for (const group of part.groups) {
            // 这里需要访问 EditorPanes 来更新选项
            // 简化处理：通过工厂更新
          }
        }
      }, [minimapEnabled]);

      // 窗口事件监听
      useEffect(() => {
        const handleBeforeUnload = () => {
          saveState();
        };

        window.addEventListener("beforeunload", handleBeforeUnload);

        return () => {
          window.removeEventListener("beforeunload", handleBeforeUnload);
        };
      }, [saveState]);

      return (
        <div
          ref={containerRef}
          style={{
            width: "100%",
            height: "100%",
            overflow: "hidden",
          }}
        />
      );
    }
  )
);

// 默认导出
export default EditorPartView;
