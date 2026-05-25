/**
 * WelcomeView — 新会话欢迎页
 *
 * 当当前 session 还没有任何消息且不在处理中时，渲染居中布局：
 *   Hero 标题 + ChatInput
 */
import { ChatInput } from "./ChatInput";

export function WelcomeView() {
  return (
    <div className="h-full flex flex-col items-center justify-center overflow-y-auto">
      <div className="w-full max-w-[760px] py-10">
        {/* Hero */}
        <div className="text-center mb-7 px-6">
          <h1 className="text-[26px] font-medium text-t-primary mb-1.5 tracking-tight">
            今天想做点什么？
          </h1>
          <p className="text-[13px] text-t-muted">描述你的需求</p>
        </div>

        {/* ChatInput —— 复用现有组件（自带 px-6 pb-4 pt-3 + max-w-[960px]） */}
        <ChatInput />
      </div>
    </div>
  );
}
