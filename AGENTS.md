<project>
前端路径：E:\binn\ftre-desktop\
后端路径：E:\ftre\src\ftre\
Agent 核心库：E:\ftre-agent-core\
配置目录：C:\Users\蒋全明\.ftre\
包结构：packages/electron（主进程）/ packages/renderer（React 前端）/ packages/shared（共享类型）/ packages/ui（UI 组件）
技术栈：Electron + React + TypeScript + Vite（pnpm workspace）
日志：console（前端）、logging（Python 后端）

MANDATORY 首次进入本仓库先读 3 份文档，之后每次 commit 前重读第 1 份：
1. docs/COMMIT.md — 提交规范唯一完整定义（type/scope/hook 机制）
2. docs/PROCESS.md — PRD 驱动开发流程（六步闭环）
3. docs/TODO.yaml — 阶段 id 唯一事实源（commit scope 校验依据）
</project>

<git_flow MANDATORY>

<basic_discipline>
- NEVER 私自 commit / push：除非用户明确要求（"commit"、"push"、"提交"），否则只改代码不提交
- 回滚需确认：回滚前告知内容/范围/影响，得到确认后再执行
- ALWAYS push 前先 commit；多仓库联动（改前端后同步验证后端 API）
- 跨仓库操作必须 set_workspace 显式切换：`cd A && git ...` 中的 cd 不改变 bash 工具工作区
</basic_discipline>

<branch_model>
master（仅发布，永不直接提交）← develop（默认基底，只接受 PR 合入）← feature/&lt;阶段id&gt;-&lt;name&gt; / prd-update / todos-update / release/&lt;ver&gt; / hotfix/&lt;name&gt;

- 默认工作分支是 develop
- NEVER 直接提交 master；NEVER 直接 commit 到 develop——**全 PR 流：develop 只接受 GitHub PR 服务器端合入，本地 develop 永远只 pull 同步**（pre-push hook 强制）
- MANDATORY feat/fix 分支名必须关联 TODO 阶段 id（如 feature/A2-chat-ui），提交 scope 与分支名阶段 id 必须一致（commit-msg hook 强制）
</branch_model>

<commit_format>
`&lt;type&gt;(&lt;scope&gt;): &lt;subject&gt;`，subject 中文
- type 白名单：feat / fix / prd / todos / docs / refactor / test / style / chore / perf
- feat/fix/prd/todos 的 scope 必须是 docs/TODO.yaml 中真实存在的阶段 id
- feat 额外强制：暂存必须包含对应阶段 PRD（docs/prd/PRD-&lt;scope&gt;-*.md）——行为变更必须同步 PRD 变更记录（无 PRD 的基建阶段跳过）
- perf 的 scope 必须带 FR 引用（如 perf(C2-FR6)），引用的 FR 编号必须真实存在于对应 PRD
- 其他 type 的 scope 用模块名（check_commit_msg.py 顶部「裁剪点」MODULE_SCOPES）
- 一条提交只做一件事；NEVER 写 fix stuff / update / misc 这类无意义 message
</commit_format>

<merge_and_hooks>
- feature/* → develop 一律走 GitHub PR/MR（Code Review）：push 分支后提 PR，NEVER 本地 `git merge --no-ff` 合并回 develop
- develop 与 master 之间同样禁止本地 merge，一律走 PR：develop → master 走 release/* 提 PR；hotfix 回灌走 PR
- NEVER rebase 已推送历史
- 本地强制：.githooks/commit-msg（提交校验）+ .githooks/pre-push（master 双保护 + develop 三重保护：禁删 / 禁 feature 直推 / 本地领先即拒）
- merge:/revert: 开头系统提交跳过
- MANDATORY 首次在本仓库提交前，先完整阅读 docs/COMMIT.md（提交规范唯一完整定义，含 type/scope 规则与常见错误速查）
- 标准流程：checkout develop && pull → checkout -b feature/&lt;阶段id&gt;-&lt;task&gt; → 开发+测试 → commit → push origin feature/&lt;task&gt; → GitHub 提 PR 合入 develop → checkout develop && pull 同步
</merge_and_hooks>

</git_flow>

<prd_driven MANDATORY>
- MANDATORY 首次在本仓库开工前，先完整阅读 docs/PROCESS.md（PRD 驱动流程六步闭环）
- ALWAYS 先 PRD 后开发：TODO 阶段开工前先在 docs/prd/ 建 PRD（从 PRD-TEMPLATE.md 复制）并定稿 approved
- PRD 是唯一依据：需求/实现/测试/验收全部对照 PRD；验收按 PRD「验收标准」逐条核对
- 阶段 id 与状态见 docs/TODO.yaml（commit scope 的唯一事实源）
</prd_driven>

<architecture>

<features>
前端功能模块（packages/renderer/src/features/）：
- chat：聊天界面（ChatPanel/ChatMessageList/ChatInput/AssistantMessage/CodeBlock/InlineToolCallCard/QueuedMessagesBanner）
- inspector：扩展面板（DiffRenderer/FileRenderer/ImageRenderer/WsLogInspectorPanel/tabRegistry/FileTreeSidebar）
- git：Git 集成（GitService，git:poll 协商缓存；文件树由 Inspector 持有）
- session：会话列表（SessionPanel/工作区分组/置顶）
- editor：编辑器区域
- settings：设置面板 / terminal：xterm 终端 / traces：追踪 / skills：技能面板 / global-search：全局搜索 / mcp：MCP 管理
</features>

<ws_protocol>
与后端走 WebSocket（services/websocket-client.ts）+ HTTP（services/api.ts）双通道：
- mailbox 快照：session_event:mailbox_snapshot → phase/activity/pending/queueDepth/canCancel
- durable admission：user_message 等待 message_ack（outbox 断线保留 + 重连重发）
- 取消：sendCancel(expected_request_id) 精确取消排队消息；HTTP DELETE /sessions/{id}/queue/{requestId}
- WS Log 审计：ws-log-collector 采集 in/out/system 帧，Inspector WS Logs tab 查询
</ws_protocol>

<electron>
主进程（packages/electron/src/）：窗口管理 / preload IPC bridge / 内嵌 Python 后端 spawn（打包模式）/ ws-log IPC
渲染进程通过 window.desktop API 访问 IPC（类型定义在 packages/renderer/src/types/desktop.d.ts + packages/shared/src/types.ts）
</electron>

</architecture>

<run_and_test>
- 启动：`cd E:\binn\ftre-desktop && pnpm dev`（客户端）；后端单独 `ftre gateway`
- 测试：vitest（packages/renderer/src/**/*.test.ts(x)）
- MANDATORY 提交/合并前通过：`pnpm test` + 类型检查（tsc）
- 新功能必须配测试；bug 修复必须配回归测试
</run_and_test>

<anti_lazy>
- NEVER 用空函数、TODO、placeholder 假装完成
- NEVER 重复性任务做几个就声称全部完成——逐个执行，验证全部
- NEVER 跳过失败的步骤——修复后重新验证
- 同一问题反复改不好就停下：回到初始假设、复现路径和失败证据重新判断，换方向
- 收尾前通读改过的文件：确认连贯、无语法错误、无残留调试代码
- 违反以上任何一条：下一轮立即自纠
</anti_lazy>
