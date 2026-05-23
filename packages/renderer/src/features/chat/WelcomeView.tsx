/**
 * WelcomeView — 新会话欢迎页
 *
 * 当当前 session 还没有任何消息且不在处理中时，渲染居中布局：
 *   Hero 标题 + ChatInput + 起手建议卡片
 *
 * 起手卡片点击会通过自定义事件 `ftre:rollback-refill` 把文本塞进 ChatInput
 * （复用既有的"回填编辑器"通道，避免新增另一种 IPC 事件）。
 */
import { Sparkles, Code2, Bug, FileText } from "lucide-react";
import { ChatInput } from "./ChatInput";

interface Example {
  icon: typeof Sparkles;
  title: string;
  description: string;
  prompt: string;
}

const EXAMPLES: Example[] = [
  {
    icon: Code2,
    title: "解释这段代码",
    description: "粘贴片段，让我拆解结构和意图",
    prompt: "帮我解释下面这段代码的整体结构和关键逻辑：\n\n",
  },
  {
    icon: Sparkles,
    title: "重构得更简洁",
    description: "去掉重复、提取函数、命名优化",
    prompt: "帮我重构下面这段代码，让它更简洁、可读性更好：\n\n",
  },
  {
    icon: Bug,
    title: "排查报错",
    description: "贴上 stacktrace，一起定位根因",
    prompt: "我遇到了下面这个报错，帮我分析下可能原因和排查思路：\n\n",
  },
  {
    icon: FileText,
    title: "写一份 README",
    description: "根据当前项目结构生成入门文档",
    prompt: "请基于当前项目的结构，帮我起草一份适合新人阅读的 README。",
  },
];

function fillInput(text: string): void {
  window.dispatchEvent(
    new CustomEvent("ftre:rollback-refill", {
      detail: { parts: [{ type: "text", data: text }] },
    }),
  );
}

export function WelcomeView() {
  return (
    <div className="h-full flex flex-col items-center justify-center overflow-y-auto">
      <div className="w-full max-w-[760px] py-10">
        {/* Hero */}
        <div className="text-center mb-7 px-6">
          <h1 className="text-[26px] font-medium text-t-primary mb-1.5 tracking-tight">
            今天想做点什么？
          </h1>
          <p className="text-[13px] text-t-muted">
            描述你的需求，或从下面的灵感开始
          </p>
        </div>

        {/* ChatInput —— 复用现有组件（自带 px-6 pb-4 pt-3 + max-w-[960px]） */}
        <ChatInput />

        {/* 起手卡片：跟 ChatInput 同款 px-6 + max-w-[960px] 居中保持视觉对齐 */}
        <div className="px-6">
          <div className="mx-auto w-full max-w-[960px]">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.title}
                  type="button"
                  onClick={() => fillInput(ex.prompt)}
                  className="group flex items-start gap-2.5 text-left p-3 rounded-lg border border-border-subtle bg-elevated/30 hover:bg-elevated hover:border-border transition-colors"
                >
                  <ex.icon
                    size={14}
                    className="shrink-0 mt-0.5 text-t-ghost group-hover:text-t-primary transition-colors"
                  />
                  <div className="min-w-0">
                    <div className="text-[12.5px] text-t-primary leading-tight mb-0.5 truncate">
                      {ex.title}
                    </div>
                    <div className="text-[11px] text-t-muted leading-snug">
                      {ex.description}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
