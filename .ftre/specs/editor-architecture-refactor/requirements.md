> ⚠️ **设计阶段文档** — 实际实现与本文档有差异。以代码和 `.ftre/agents_def/editor-guardian/AGENT.md` 为准。

# 编辑器架构重构 (Editor Architecture Refactor) - Requirements

## 背景与原始痛点

在目前的编辑器模块中，存在两个长期未彻底解决的 Bug：
1. **偶发灰色空白：** 打开某些文件时，只展示一个灰色空白区域，感觉就像没有加载代码编辑器一样。
2. **打开文件立即提示被修改：** 刚打开一个文件，就错误地提示该文件处于“被修改（Dirty）”状态。

虽然尝试过打补丁（如轮询等待 Monaco 初始化、首次加载强制同步等）来修复，但这种补丁式的修复方式不可持续。问题的根本原因在于当前的架构设计存在严重缺陷。

## 现有架构缺陷分析

1. **三重内容同步灾难：** 文件内容被分散存储在三个地方：
   - React Store (`file.content`)
   - 非响应式全局缓存 (`editorCore` 的 `contents` 和 `diskContents`)
   - Monaco Editor 的内部 Model
   这三者之间需要通过各种 React 生命周期（`useEffect`）手动同步，任何时序偏差（如懒加载与 Monaco 初始化的竞争）都会导致状态不同步（引发空白 Bug）。

2. **跨平台差异导致 Dirty 误报：**
   - 现有的 `isDirty` 判断仅仅是比较 `contents` 字符串与 `diskContents` 字符串。
   - 但是，Monaco Editor 在初始化 TextModel 时，会自动将文件内容进行规范化（处理 BOM 头，将所有 `\r\n` 转换为 `\n`）。
   - 这导致从磁盘读取的原始内容与 Monaco 规范化后的内容在字符串层面上不一致，从而触发了刚打开文件就提示“被修改”的 Bug。

3. **UI 组件承担过多底层职责：**
   - `ManagedEditor.tsx` 作为 UI 组件，内部却塞满了文件读取、内容同步、Dirty 检测与通知、编辑器初始化等待等业务逻辑。
   - 这违反了“分离关注点”原则，导致代码极度脆弱。

## 核心目标与需求

1. **单一内容源 (Single Source of Truth)：**
   - 彻底废弃 `editorCore`。
   - 文件内容唯一且真实地存在于 Monaco Model 中。
   - 引入 `Document` 实体，由它全权负责文件内容的生命周期。

2. **状态机驱动：**
   - 摒弃基于 `useEffect` 相互依赖的条件判断。
   - 每个打开的文件 (`Document`) 拥有明确的状态：`IDLE` → `LOADING` → `LOADED` → `HIBERNATED` → `CLOSED`。
   - UI 层仅需根据当前状态进行傻瓜式渲染。

3. **解决跨平台差异与 Dirty 误报：**
   - 在文件读取时，检测并记录原始的编码、BOM 标记以及行尾符风格（CRLF 还是 LF）。
   - 将统一规范化（剥离 BOM，转为 LF）后的内容存入 Monaco Model。
   - `isDirty` 的判断逻辑改为：比对**当前规范化内容的 Hash 值**与**原始加载时规范化内容的 Hash 值**。
   - 在文件保存时，依据记录的元数据，恢复其原始的行尾符和 BOM。

4. **完美兼容并优化工作区缓存设计：**
   - 保留跨工作区切换时“未保存修改不丢失”的特性。
   - 实现 `Hibernate`（休眠）机制：当工作区切换或文件不再活跃时，销毁内存占用大的 Monaco Model，但将其未保存的内容提取为字符串缓存（Cache）并保留光标/滚动状态。
   - 当文件再次激活时，从 Cache 中瞬间恢复 Model。这比现有粗暴的全局快照（Snapshot）方案更节省内存且更稳定。

5. **分离实例管理：**
   - 将 Monaco 编辑器实例的池化复用逻辑从原来的混合管理器中剥离出来，成立专职的 `SlotPool`。
