# 归档文件夹 UI 功能

> ArchivesView 组件支持按文件夹分类管理归档

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/renderer/src/features/explorer/ArchivesView.tsx` | 归档文件夹主视图，左侧文件夹列表 + 右侧归档列表 |
| `packages/renderer/src/services/api.ts` | 归档文件夹 API（已对接） |
| `packages/renderer/src/components/ChatInput.tsx` | 接收归档拖拽的目标容器 |

## 数据结构

```typescript
// ArchiveFolder
{
  id: string;
  workspace: string;
  name: string;
  description: string;
  sort_order: number;
  meta: Record<string, unknown>;
  archive_count?: number;
  created_at: number;
  updated_at: number;
}

// ArchiveEntry 新增字段
{
  folder_ids: string[];  // 归档所属的文件夹 ID 列表
}
```

## API 列表

| 函数 | 端点 | 用途 |
|------|------|------|
| `createArchiveFolder` | POST /session/archive-folders | 创建文件夹 |
| `fetchArchiveFolders` | GET /session/archive-folders?workspace=xxx | 获取文件夹列表 |
| `updateArchiveFolder` | PUT /session/archive-folders/{id} | 更新文件夹 |
| `deleteArchiveFolder` | DELETE /session/archive-folders/{id} | 删除文件夹 |
| `linkArchiveToFolder` | POST /session/archive-folders/{id}/archives | 归档加入文件夹 |
| `unlinkArchiveFromFolder` | DELETE /session/archive-folders/{id}/archives/{archive_id} | 归档移出文件夹 |
| `fetchFolderArchives` | GET /session/archive-folders/{id}/archives | 获取文件夹下归档 |

## UI 交互

### 文件夹列表（左侧）
- 显示所有文件夹，按 sort_order 排序
- 显示每个文件夹的归档数量
- 支持右键菜单：编辑名称/描述、删除
- 支持创建新文件夹
- "未分类"虚拟文件夹显示无 folder_ids 的归档

### 归档列表（右侧）
- 点击文件夹显示该文件夹下的归档
- 归档项支持移动到文件夹（右键菜单）
- 支持从文件夹移出（在未分类视图显示）
- **统一布局**：文件夹和"未分类"使用同一个 GroupSection 组件渲染，视觉一致

### 归档项操作按钮
- **定位方案**：`absolute top-2 right-2`，hover 时浮在内容右上角
- **文本避让**：摘要文本需加 `pr-12` 右内边距，避免按钮出现时遮挡文字
- 避免与底部时间/统计信息重叠

## 拖拽交互

### 拖拽方案选择
- **不使用 @dnd-kit**：改为原生 HTML5 drag API
- **原因**：@dnd-kit 主要用于列表排序，而需求需要支持跨组件拖拽（归档 → ChatInput）

### 拖拽场景
| 场景 | 源 | 目标 | 操作 |
|------|----|------|------|
| 归档分类 | 归档项 | 文件夹 | `linkArchiveToFolder` |
| 归档引用 | 归档项 | ChatInput | 生成 archive_ref chip |

### ChatInput 接收归档
- 监听 `onDragOver` / `onDrop` 事件
- 通过 `dataTransfer` 传递归档 ID
- 拖入后生成 `<attached_archive>` 引用标记

## 设计决策

- **ContextMenu 改为平铺展示**：原 ContextMenu 组件不支持嵌套菜单，因此文件夹操作菜单改为平铺展示

## 注意事项

- 删除文件夹只删除文件夹本身和关联关系，归档不会被删除
- 同一归档可以属于多个文件夹
- folder_ids 为空数组表示未分类
- 按钮绝对定位时注意留出文本避让空间，避免文字被遮挡

## 相关提交

- `f41cfa5` feat(archives): add folder support for archive organization
- `7e471b9` feat(api): add archive folder CRUD APIs
