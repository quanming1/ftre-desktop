# 记忆索引

| 文件 | 主题 | 关键词 |
|------|------|--------|
| archive-system.md | 归档系统工作流 | archive, 归档, query_json, list_folders, create_folder, add_to_folder, submit, 会话分析, 归档工具链 |
| skill-system.md | Skill 系统 | skill, skill_demo, cursor commands, speckit, 格式转换, SKILL.md, YAML frontmatter, name, description, skill-creator, 目录结构, 触发方式, 前置条件, subagent, spawn_session, 批量创建, 并发执行, 工作流 |
| diff-view.md | Diff View (差异对比视图) | diff, diff view, MonacoDiffViewer, DiffBar, pendingDiffs, diffEntry, 差异对比, 跳转到源文件, ftre://diff, virtual path |
| settings-tab.md | Settings Tab (设置面板) | settings, settings tab, 设置面板, TitleBar, editor store, OpenFile, EditorArea, 虚拟路径, ftre://settings, VSCode, EditorInput, 单例模式, AgentDef, agent_def 配置, 可视化表单, MultiSelect, tools 配置, IPC, fs:writeFile, 状态保持, keep-alive, EditorPane 复用, EditorMemento, display none, setVisible, ModelSettings, 模型配置, ProviderConfig, MODEL_REGISTRY, dashscope, deepminer, mock 数据, api_key, base_url, parallel_tool_calls, vision, max_context_length |
| chat-panel.md | Chat 面板 (AI 对话) | chat, ChatPanel, MessageList, ChatInput, UserMessage, AssistantMessage, message, PixelLogo, ai_turn_start, 渲染单元, part 协议, archive_ref, 归档引用, code_ref, email, fork, fork session, insert-archive-ref, ArchiveChipView, ArchiveRef, metadata.archive_id, stream-manager, GlobalEventStream, StreamSession, switchSession, replayInto, streamingTail, 流式处理, running tool, tool_call, session切换 |
| session-panel.md | Session 面板 (会话管理) | session, SessionPanel, SessionSidebar, source, 分组, delete session, rename session, updateSession, LayoutSwitcher, panelOrder, 面板管理, 拖拽排序, 搜索框, 时间颜色渐变, 流式loading, streamManager, 工作区切换, 切换按钮, workspace switcher |
| workbench-layout.md | Workbench 布局系统 | workbench, ResizeHandle, panelOrder, panel layout, 拖拽调整, sessionsWidth, sidebarWidth, centerRatio, createFixedPanelResizeHandler, createCenterResizeHandler |
| editor-core.md | 编辑器核心机制 | editor-core, MonacoEditor, refreshFile, file watcher, edit tool |
| editor-architecture-redesign.md | 编辑器架构重构方案 | editor, 架构重构, VSCode 三层架构, model-service, text-file-model, text-file-model-manager, code-editor-widget, editor-pane, text-editor-pane, editor-panes, editor-input, file-editor-input, EditorAreaV2, EditorAreaV2Props, getModelService, getTextFileModelManager, createFileEditorInput, createCodeEditorWidget, TextFileModel, FileEditorInput, FileReader, ITextFileModelManager, TextFileResolveOptions, resolve, markSaved, revert, save, setModel, createModel, destroyModel, Document, DocumentManager, SlotPool, 单一内容源, 状态机, isDirty, migration, hibernate, 跨平台, 工作区切换, snapshot, line ending, BOM, hash, specs, design.md, migration-guide.md, editor-guardian, Agent, 四不要原则, VSCode, TextFileEditorModel, TextFileEditorModelManager, ModelService, CodeEditorWidget, EditorPane, AbstractTextCodeEditor, 按类型复用, versionId, setModel, _attachModel, _detachModel, show/hide, getAlternativeVersionId, bufferSavedVersionId, closeEditor, dispose, ViewState 清理, canDispose, tracksDisposedEditorViewState, onWillCloseEditor, onWillDispose, handleOnDidCloseEditor |
| editor-guardian-agent.md | Editor Guardian Agent | editor-guardian, AGENT.md, 架构守护, 单一内容源, 状态机, 主动修复, 危险模式, Document, SlotPool, send_email |
| editor-package-migration.md | 编辑器独立包拆分 | editor package, @ftre/editor, migration plan, architecture, core, runtime, UI |
| editor-themes.md | 编辑器主题系统 | editor themes, Monaco theme, theme-registry, FtreThemeDefinition, registerFtreTheme, darcula |
| terminal-features.md | 终端功能特性 | terminal, keybindings, font zoom, Ctrl+=, xterm |
| explorer.md | 文件浏览器 (Explorer) | explorer, ExplorerView, FileTreeItem, file tree, drag-drop, git changes |
| archives-folder-ui.md | 归档文件夹功能 | archive, archive folder, ArchivesView, folder_ids, link, unlink, sort_order, createArchiveFolder, fetchArchiveFolders |
| error-boundary.md | Error Boundary 错误边界 | error-boundary, ErrorBoundary, 错误边界, app crash, fallback UI, level=app, level=region, 组件错误 |
| ui-package-migration.md | UI 组件库拆分 | @ftre/ui, components, renderer, ContextMenu, ConfirmDialog, FloatingWindow, 纯 UI, 业务解耦 |
| design-system.md | 设计系统规范 | design system, 设计规范, 色彩系统, tailwind, theme, 霓虹绿, neon, SKILL.md, JetBrains Mono, Inter |
| virtual-list.md | 虚拟列表组件 | @ftre/virtual-list, VirtualList, VLManager, 动态高度, 虚拟化, bufferSize, forceRenderItem, useCacheState, useVirtualization, useIsAtBottom, combineRef, VLItemWrap |
| spacious-ui.md | Spacious UI 设计模式 | spacious-ui, 留白设计, 大方布局, big design, 下划线输入框, 简洁不简陋, 主角突出, 表单设计, 列表设计, 页面模板, AgentDefSettings, mb-12, space-y-8, font-light, design skill |
| git-integration.md | Git 集成 | git, GitService, GitPanel, git IPC, stage, unstage, commit, push, diff, git status, git info, changedFiles, gitExec |
