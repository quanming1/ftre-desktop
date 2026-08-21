# Changelog

## [未发布]

### 新增

- A6：运行详情的 Changes 入口打开唯一 Inspector 审阅 Tab，支持未提交/未暂存/已暂存对比、文件级按需 Diff、复制 Diff 和打开源文件。

### 修复

- A2：重复的 TOOL_CALL_START 事件按 tool_call_id 幂等处理，消除聊天工具卡片 duplicate key 警告；Reply 快照转换同样按 id 去重。
- A1：renderer 声明 Content-Security-Policy（index.html meta + 开发模式响应头注入），消除 Electron 开发模式 Insecure Content-Security-Policy 警告。

## [0.1.9] - 2026-08-20

### 变更

- D3：标题点击直接展开最近 WebSocket 会话列表，移除箭头、绿点和 WS 数量统计；重命名保留在更多操作菜单中。

## [0.1.8] - 2026-08-20

### 新增

- D2：会话消息列表左侧新增悬停式历史定位导航，可预览并平滑跳转至已加载的用户消息。
- D3：运行详情迁移到 Header 弹窗，保留 pending 队列输入区；支持任务、文件、Git 分支和 Git 变更详情及 Diff。
- D3：运行详情按钮常驻并持久化全局开关；规范“本轮修改 / Changes”分组与视觉样式，Changes 条目可直接打开 Inspector 预览。

### 修复

- A2：上下文压缩横幅读取后端事件中的实际摘要模型，旧协议缺少该字段时不再显示陈旧的普通对话模型。
- D1：会话搜索首屏提高至 50 条，并可继续加载后续页面，确保全部匹配会话可见。
- A2：流式回复期间点击“从服务器加载更早的消息”不再丢弃已成功返回的历史页。
