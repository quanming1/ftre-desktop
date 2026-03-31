# ChatInput 富文本重构 — TODO

## 前端 (已完成)
- [x] Slate.js 富文本编辑器替换 textarea
- [x] ChatInputEditor 类封装逻辑层
- [x] CodeChip inline void element
- [x] Ctrl+L 从 Monaco 插入代码引用
- [x] 数据流打通 (types, store, api, UserMessage)
- [x] serialize 输出 MessagePart[] 统一协议

## 后端 (已完成)
- [x] UserContent 转化层 (`packages/shared/user_content.py`)
- [x] ChatRequest.message 改为 `list[dict]` (parts 数组)
- [x] to_openai_messages 中 user_input 用 UserContent.to_llm_text()
- [x] compaction handler 用 UserContent.to_llm_text()
- [x] event.data 保留 content 字段向后兼容
- [x] replayEvents 从 data.parts 重建 codeRefs

## 前后端统一协议

### HTTP 请求 (POST /chat/stream)
```json
{
  "message": [
    {"type": "text", "data": "请帮我重构这个函数"},
    {"type": "code_ref", "data": {"path": "src/utils.ts", "name": "utils.ts", "lines": [12, 25], "raw": "function foo() {...}"}}
  ],
  "session_id": "...",
  "model": "..."
}
```

### 存储格式 (event.data)
```json
{
  "content": "请帮我重构这个函数 [utils.ts:L12-L25]",
  "parts": [
    {"type": "text", "data": "请帮我重构这个函数"},
    {"type": "code_ref", "data": {"path": "src/utils.ts", "name": "utils.ts", "lines": [12, 25], "raw": "..."}}
  ]
}
```

- `content`: 纯文本，向后兼容旧代码
- `parts`: 结构化数据，新代码通过 UserContent 解析

### UserContent 方法
| 方法 | 用途 | 输出 |
|------|------|------|
| `to_plain_text()` | 标题、日志、摘要 | 纯文本 |
| `to_llm_text()` | LLM 输入 | code_ref → `<attached_code>` 块 |
| `to_parts()` | 前端回显 | 原始 parts 数组 |
| `to_event_data()` | 存储 | `{content, parts}` |

### 兼容性
- 旧数据 `{"content": "hello"}` → `from_data()` 自动包装为 `[TextPart("hello")]`
- 新数据 `{"parts": [...]}` → 正常解析
- 所有旧代码读 `data.get("content", "")` 仍然能工作（content 字段始终存在）
