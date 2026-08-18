/**
 * CodeDiff 共享配置
 *
 * 库内置 light 主题背景是 #fafafa，而面板/侧边栏背景是 --ftre-bg-surface
 * （亮色 #ffffff），文件预览四周 padding 会露出一圈色差。
 * 这里把 light 背景统一为面板背景，且随主题切换（tokens.css 的 CSS 变量）。
 * FileRenderer（源码预览）与 DiffRenderer 共用同一份配置。
 */
import { mergeConfig } from "@jiang_quan_ming/react-code-diff";

export const codeDiffLightConfig = mergeConfig({
  colors: {
    light: {
      bg: "var(--ftre-bg-surface)",
    },
  },
});
