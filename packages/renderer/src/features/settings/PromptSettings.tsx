/**
 * PromptSettings — 用户偏好提示词（USER.md）
 *
 * 读写 ~/.ftre/agents/default/USER.md。
 * 后端 AgentManager._compose_system_prompt 会将其内容追加到系统提示词，
 * 用 <USER_PROFILE> 标签包裹。
 */
import { useState, useEffect, useCallback } from "react";
import { Save } from "lucide-react";
import { fetchAgentPrompts, updateAgentPrompt } from "@/services/api";

const AGENT_ID = "default";
const FILENAME = "USER.md";

export function PromptSettings() {
  const [value, setValue] = useState("");
  const [initial, setInitial] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const prompts = await fetchAgentPrompts(AGENT_ID);
      const text = prompts[FILENAME] ?? "";
      setValue(text);
      setInitial(text);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = value !== initial;

  const handleSave = async () => {
    setSaving(true);
    try {
      const ok = await updateAgentPrompt(AGENT_ID, FILENAME, value);
      if (ok) {
        setInitial(value);
        setSavedAt(Date.now());
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-[15px] font-semibold text-black">用户偏好提示词</h2>
        <p className="text-[12px] text-black/40 mt-1">
          此内容写入 USER.md，会追加到系统提示词中，对所有会话生效。用于声明你的个人偏好与额外要求。
        </p>
      </div>

      {loading ? (
        <div className="text-[12px] text-black/30">加载中...</div>
      ) : (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="例如：回答尽量简洁；代码注释用中文；优先使用 TypeScript……"
            rows={12}
            className="w-full px-3.5 py-2.5 rounded-lg bg-black/[0.02] border border-black/[0.08] text-[13px] text-black placeholder:text-black/25 focus:outline-none focus:border-black/30 focus:bg-white resize-y transition-all font-mono leading-relaxed"
          />

          <div className="flex items-center gap-3">
            <button
              onClick={handleSave}
              disabled={saving || !dirty}
              className="flex items-center gap-1.5 h-9 px-5 rounded-full text-[13px] font-medium bg-black text-white hover:bg-black/85 active:scale-[0.96] transition-[background-color,transform] disabled:opacity-30 disabled:pointer-events-none"
            >
              <Save size={14} />
              {saving ? "保存中..." : "保存"}
            </button>
            {savedAt && !dirty && (
              <span className="text-[12px] text-black/35">已保存</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
