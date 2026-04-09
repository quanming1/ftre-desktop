# 修复编辑器外部文件同步问题

> **目标：** 修复 edit tool 编辑文件后，编辑器内容不同步更新的问题

## 简介

用户使用 edit tool 编辑了文件后，虽然文件系统已更新，但编辑器中显示的内容仍然是旧的。这是由于项目中存在两套独立的 TextModel 管理服务，EditorArea 更新了错误的服务导致。

## 术语表

- **TextModelService**: 旧架构的文本模型管理服务（`packages/editor/src/core/text-model.ts`）
- **TextModelResolverService**: 新架构的文本模型管理服务（`packages/editor/src/workbench/textModelResolverService.ts`），Monaco 编辑器实际使用此服务管理的 model
- **Monaco Model**: Monaco 编辑器的文本模型实例，存储文件内容

## 需求

### 需求 1：外部文件变更时正确同步编辑器内容

**用户故事：** 作为开发者，我希望当文件被外部修改（如 edit tool）后，编辑器能自动显示最新内容，以便我能看到实时的修改结果。

#### 验收标准

1. WHEN 外部工具修改了已打开的文件，且该文件在编辑器中无未保存更改，THE 编辑器 SHALL 自动更新显示最新的文件内容
2. WHEN 外部工具修改了已打开的文件，且该文件在编辑器中有未保存更改，THE 编辑器 SHALL 弹出提示询问用户是否重新加载
3. IF 用户选择"重新加载"，THEN THE 编辑器 SHALL 更新为最新的文件内容并清除 dirty 状态

### 需求 2：文件重命名/删除时正确同步

**用户故事：** 作为开发者，我希望当文件被重命名或删除时，编辑器能正确更新 Monaco model 状态。

#### 验收标准

1. WHEN 文件被重命名，THE 编辑器 SHALL 更新 TextModelResolverService 中的 model URI
2. WHEN 文件被删除，THE 编辑器 SHALL 从 TextModelResolverService 中清理对应的 model

## 边界情况

- **文件不在编辑器中打开**: 忽略，无需处理
- **用户保存触发的文件变更**: 通过 `wasRecentlySaved` 过滤，不触发刷新
- **TextModelResolverService 未初始化**: 跳过 model 操作，仅更新 editor store 状态
