/**
 * 快捷键设置 — 展示当前所有已注册快捷键，按 category 分组。
 *
 * 现阶段是"只读"展示：快捷键是写死在 default-shortcuts.ts 里的，
 * 这里主要做"用户能查看到所有快捷键的入口"。
 */
import { useEffect, useState } from "react";
import { Keyboard } from "lucide-react";
import { useShortcut, type ShortcutBinding } from "@/stores/shortcut";

function KeyCap({ children }: { children: string }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-6 px-1.5 rounded-md text-[11.5px] font-mono font-medium border border-black/[0.12] bg-gradient-to-b from-white to-black/[0.04] text-black/75 shadow-[inset_0_-1px_0_rgba(0,0,0,0.06)]">
      {children}
    </kbd>
  );
}

function ShortcutRow({ binding }: { binding: ShortcutBinding }) {
  // 解析 "ctrl+shift+p" → ["ctrl", "shift", "p"]
  const parts = binding.keys
    .split("+")
    .filter(Boolean)
    .map((p) => p.trim());

  // 修饰键缩写统一为大写展示，键名做友好化
  const display = (p: string) => {
    if (p === "ctrl") return "Ctrl";
    if (p === "shift") return "Shift";
    if (p === "alt") return "Alt";
    if (p === "meta") return "⌘";
    if (p === "arrowup") return "↑";
    if (p === "arrowdown") return "↓";
    if (p === "arrowleft") return "←";
    if (p === "arrowright") return "→";
    if (p === "escape") return "Esc";
    if (p === "enter") return "Enter";
    if (p === "tab") return "Tab";
    return p.toUpperCase();
  };

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3 rounded-lg bg-black/[0.02] border border-black/[0.05]">
      <span className="text-[13px] text-black/80">{binding.label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        {binding.keys ? (
          parts.map((p, i) => (
            <span key={i} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-[10px] text-black/30">+</span>}
              <KeyCap>{display(p)}</KeyCap>
            </span>
          ))
        ) : (
          <span className="text-[11px] text-black/30 italic">未绑定</span>
        )}
      </div>
    </div>
  );
}

export function ShortcutsSettings() {
  const [bindings, setBindings] = useState<ShortcutBinding[]>(() =>
    useShortcut.getState().getAll(),
  );

  // 监听快捷键 store 变化，确保新增/卸载时自动刷新
  useEffect(() => {
    return useShortcut.subscribe((state) => {
      setBindings(state.getAll());
    });
  }, []);

  // 按 category 分组
  const grouped = bindings.reduce<Record<string, ShortcutBinding[]>>((acc, b) => {
    const key = b.category || "其他";
    (acc[key] ||= []).push(b);
    return acc;
  }, {});

  const categoryOrder = ["通用", "视图", "会话", "编辑", "其他"];
  const sortedCategories = Object.keys(grouped).sort(
    (a, b) =>
      (categoryOrder.indexOf(a) === -1 ? 999 : categoryOrder.indexOf(a)) -
      (categoryOrder.indexOf(b) === -1 ? 999 : categoryOrder.indexOf(b)),
  );

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-black flex items-center gap-2">
          <Keyboard size={16} className="text-black/50" />
          键盘快捷键
        </h2>
        <p className="text-[12px] text-black/40 mt-1">
          当前所有已注册的快捷键。后续版本将支持自定义修改。
        </p>
      </div>

      {sortedCategories.length === 0 ? (
        <div className="py-12 text-center text-[13px] text-black/40">
          暂无快捷键
        </div>
      ) : (
        <div className="space-y-5">
          {sortedCategories.map((cat) => (
            <div key={cat}>
              <div className="text-[11px] font-semibold text-black/50 tracking-wider mb-2 px-1">
                {cat}
              </div>
              <div className="space-y-1.5">
                {grouped[cat].map((b) => (
                  <ShortcutRow key={b.id} binding={b} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
