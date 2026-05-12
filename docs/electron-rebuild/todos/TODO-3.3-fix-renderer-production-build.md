# TODO-3.3: 修复 renderer production build

## 阶段
Phase 3: 构建流水线

## 状态
- [x] 完成

## 目标
确保 renderer 的 Vite build 产物能被 Electron 以 file:// 协议加载。

## 涉及文件
- `packages/renderer/vite.config.ts`
- `packages/renderer/index.html`

## 具体任务
1. 确认 base: "./" 配置使 asset 路径为相对路径
2. 确认 `pnpm build` 输出的 dist/ 包含 index.html + assets
3. 确认 Electron loadFile 能正确加载 production 页面

## 验收标准
- `cd packages/renderer && pnpm build` 成功
- Electron 加载 dist/index.html → 页面正常（含 CSS/JS/字体）

## 前置依赖
TODO-3.2

## 预估难度
低
