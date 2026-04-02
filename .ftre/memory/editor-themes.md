# 编辑器主题系统

> Monaco Editor 主题配置与管理，支持未来用户自定义。现已支持动态主题切换，不再硬编码主题ID。

## 核心文件

| 文件 | 职责 |
|------|------|
| `packages/editor/src/ui/themes/types.ts` | 主题数据模型定义 (`FtreThemeDefinition`) |
| `packages/editor/src/ui/themes/darcula.ts` | IntelliJ IDEA Darcula 风格主题实现 |
| `packages/editor/src/ui/themes/ftre-neon.ts` | 项目专属 Neon 主题实现（基于品牌色 #00ff88） |
| `packages/editor/src/ui/themes/index.ts` | 主题注册、查询、切换 API |
| `packages/editor/src/ui/theme-registry.ts` | 将主题配置注册到 Monaco Editor |

## 业务流程

### 主题注册与应用流程
所有编辑器组件 → `theme-registry.ts:registerFtreTheme` + `monaco.editor.setTheme(getActiveThemeId())` → `themes/index.ts:getTheme` → 具体主题文件

### 主题切换流程
调用 `themes/index.ts:setActiveThemeId` → 更新活跃主题ID → 下次编辑器初始化时自动应用新主题

## 关键数据结构

FtreThemeDefinition: `{ id, label, base, inherit, tokenRules[], editorColors }`
FtreThemeTokenRule: `{ token, foreground?, fontStyle? }`

## 设计决策

- **动态主题ID**：编辑器组件必须通过 `getActiveThemeId()` 获取当前主题ID，禁止硬编码（如 "ftre-dark"）。
- **配置与逻辑分离**：`theme-registry.ts` 只负责注册，不包含具体配色，便于扩展。
- **CSS 变量覆盖**：`editor.background` 等关键颜色从 CSS 变量读取，保证编辑器与应用外壳风格一致，并提供 fallback 防止白色背景。
- **面向未来扩展**：提供 `registerTheme` API，为用户自定义主题预留入口。

## 注意事项

- 主题 ID 必须全局唯一，当前默认主题为 `darcula`。
- 所有使用 Monaco Editor 的组件（包括 DiffViewer）都必须遵循动态主题获取模式。
- `tokenRules` 中的 `token` 值需参考 Monaco 的 TextMate 作用域命名规范。
- 修改主题后需重新调用 `registerFtreTheme` 才能生效。
- CSS 变量读取必须提供 fallback，防止因变量未加载导致编辑器背景变白。