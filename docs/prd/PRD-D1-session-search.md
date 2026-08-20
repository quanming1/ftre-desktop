# PRD-D1-session-search

## 元信息

| 字段 | 值 |
|---|---|
| 阶段 | D1 |
| 名称 | 会话内容搜索（前端搜索框 / 高亮 / 跳转） |
| 状态 | 已验收 |
| 创建日期 | 2026-08-17 |
| 定稿日期 | 2026-08-17 |
| 验收日期 | 2026-08-20 |
| 关联文档 | docs/TODO.yaml 阶段 D1；后端 ftre E1（GET /sessions/search） |

## 1. 背景与目标

- **背景**：后端 E1 已提供内存态搜索接口（标题+正文，带命中摘要）。前端会话面板只有列表，无法按关键字定位历史会话。
- **目标**：会话面板顶部加搜索框，输入即搜（防抖 + 请求取消），结果列表高亮命中词与摘要，点击直接切到该会话。
- **非目标**：不做全局快捷键唤起、不做搜索历史、不做正则/筛选语法。

## 2. 需求范围

### 2.1 功能需求

- [x] FR1：展开态会话面板顶部显示搜索输入框（折叠态不显示）；输入 ≥1 字符进入搜索模式，清空退出恢复原列表。
- [x] FR2：输入防抖 300ms 后调 `GET /sessions/search`；连续输入时 AbortController 立即取消旧请求，仅渲染最新结果。
- [x] FR3：结果项显示：标题（命中词高亮，标题命中加"标题"角标）、命中摘要（命中词高亮，最多 3 条）、workspace 名与更新时间；显示总命中数。
- [x] FR4：点击结果项切换到该会话（复用 handleSwitchSession）并清空搜索。
- [x] FR5：Esc 清空搜索退出；加载中显示 spinner；空结果显示"无匹配会话"；接口失败静默保留上次结果。
- [x] FR6：完整结果分页——首屏请求 50 条；接口返回 `has_more` 时可点击“显示更多”连续加载后续页面，不因默认 30 条而遗漏旧会话。

### 2.2 非功能需求

- 输入体验：防抖期间不闪烁（loading 态覆盖在已有结果上）；请求全部可取消，无悬挂 setState。
- 样式贴合 SessionPanel 现有设计语言（t-ghost/t-muted 色阶、h-8 输入框）。

## 3. 技术方案

- `services/api.ts`：`fetchSessionSearch({q, limit, offset?, workspace?, signal?})` → `{total, results, has_more}`；AbortError 静默返回 null（调用方区分取消与失败）。
- `components/HighlightText.tsx`：`({text, query})` 大小写不敏感分段渲染 `<mark>`（黄色底）。
- `features/session/SessionSearchResults.tsx`：结果列表（纯展示，props: query/results/onOpen）。
- `SessionPanel.tsx`：顶部 `SessionSearchBox`（本地 state + 防抖 + AbortController）；搜索态时列表区渲染 SessionSearchResults 替换分组列表，并按 `has_more` 加载后续页面。

## 4. 接口定义

消费后端 E1：`GET /sessions/search?q=&limit=50&offset=&workspace=`（见 ftre PRD-E1）。

## 5. 验收标准

- [x] AC1：输入关键字 → 300ms 后出结果，标题与摘要命中词高亮。
- [x] AC2：快速连续输入只发最后一个请求（旧请求被 abort）。
- [x] AC3：点击结果跳转会话且搜索清空；Esc 清空退出。
- [x] AC4：SessionSearch 专项 vitest 9 项通过，Renderer 生产构建通过；全量 tsc 的存量基线错误不由本阶段引入。
- [x] AC5：匹配数超过首屏时，点击“显示更多”会以 offset 获取并追加后续会话；查询切换立即取消旧首屏/后续页请求，旧响应不得覆盖新查询。

## 6. 测试计划

- `HighlightText.test.tsx`：大小写/多命中/空 query。
- `SessionSearchResults.test.tsx`：结果渲染 + 高亮 + 点击回调。
- 手动：连接真实后端搜索中文关键字，验证延迟与跳转。

## 7. 变更记录

| 日期 | 变更内容 | 理由 |
|---|---|---|
| 2026-08-17 | 初始定稿 | — |
| 2026-08-20 | 新增 FR6 / AC5：首屏从默认 30 提高至 50，并支持 offset 分页加载全部匹配会话；查询改变时立即取消请求 | 修复：后端虽报告全部 total，客户端却只请求首 30 条，正文命中较多时旧会话被静默遗漏 |
| 2026-08-20 | 验收完成 | 前端搜索输入、防抖取消、结果高亮/摘要、会话跳转与分页专项测试 9 项通过，Renderer 生产构建通过；与后端 E1 联动验证 |
