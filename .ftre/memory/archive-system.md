# 归档系统工作流程

> 会话归档的完整工具链和使用方法

## 核心工具

| 工具 | 用途 |
|------|------|
| `query_json` | 执行任意 JS 代码分析会话数据（data、turns 变量可用） |
| `list_folders` | 列出所有归档文件夹 |
| `create_folder` | 创建新的归档文件夹 |
| `add_to_folder` | 关联归档到文件夹（commit 时生效） |
| `submit` | 提交归档（mode: append/rewrite/commit） |

## 会话分析流程

```
query_json（概览）
  ↓
query_json（详细内容）
  ↓
think（梳理分组策略）
  ↓
list_folders（查看现有分类）
  ↓
create_folder（如需新分类）
  ↓
add_to_folder
  ↓
submit(mode='commit')
```

## query_json 示例

```javascript
// 获取会话概览
`会话 ID: ${data['session_id']}`
`总轮次: ${len(turns)}`

// 遍历轮次
for t in turns:
    print(f"[{t['index']}] {t['user'][:100]}...")

// 查看消息详情
for i, m in enumerate(turns[0]['messages']):
    role = m.get('role')
    content = m.get('content', '')
    tool_calls = m.get('tool_calls', [])
```

## 归档模式

- `append`：追加到缓冲区
- `rewrite`：重写缓冲区内容
- `commit`：提交最终归档

## 注意事项

- 需先 `add_to_folder` 再 `submit(mode='commit')`
- 归档前用 `think` 自检，模拟用户可能的追问
- 裁剪时保留：用户需求、关键发现、文件改动、分类标签