/**
 * MermaidBlock — markdown 内 ```mermaid 代码块的图表渲染
 *
 * - 按需动态 import mermaid（仅出现 mermaid 块时才加载，避免拖累首屏）
 * - securityLevel 保持默认 strict：图表内容按文本处理，不执行其中 html/脚本
 * - 渲染失败时回退显示原始代码，不阻塞页面
 */
import { memo, useEffect, useState } from "react";

let renderCounter = 0;

export const MermaidBlock = memo(function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const id = `mmd-${++renderCounter}`;
    setSvg("");
    setError(null);
    setLoading(true);

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "default",
          fontFamily: "inherit",
        });
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (error) {
    return (
      <div className="my-2 rounded-md border border-border bg-red-50 p-3 dark:bg-red-950/20">
        <div className="mb-1 text-xs font-medium text-red-600 dark:text-red-400">Mermaid 渲染失败</div>
        <pre className="overflow-auto text-[12px] leading-5 whitespace-pre-wrap text-t-secondary">{code}</pre>
      </div>
    );
  }

  if (loading) {
    return <div className="my-2 py-4 text-center text-xs text-t-ghost">图表渲染中…</div>;
  }

  return (
    <div
      className="my-2 flex justify-center overflow-auto rounded-md border border-border bg-white p-3"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
});
