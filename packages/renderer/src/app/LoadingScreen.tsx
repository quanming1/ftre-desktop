import { useState, useEffect, useRef, useCallback } from "react";

export function LoadingScreen() {
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // 订阅后端日志和退出事件
  useEffect(() => {
    const cleanups: (() => void)[] = [];

    if (window.desktop?.backend) {
      const offLog = window.desktop.backend.onLog((line: string) => {
        setLogs((prev) => {
          const next = [...prev, line];
          return next.length > 100 ? next.slice(-100) : next;
        });
      });
      cleanups.push(offLog);

      const offExit = window.desktop.backend.onExit((code: number | null) => {
        if (code !== 0 && code !== null) {
          setError(`后端进程异常退出 (code=${code})。请检查 ~/.ftre/config.json 中的 API Key 是否正确配置。`);
        }
      });
      cleanups.push(offExit);
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  // 自动滚到底部
  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 24,
        backgroundColor: "var(--ftre-bg-base)",
        color: "var(--ftre-text-primary)",
        fontFamily: "var(--font-sans)",
        zIndex: 9999,
      }}
    >
      {/* Spinner + 标题 */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        {!error ? (
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "3px solid var(--ftre-border-default)",
              borderTopColor: "var(--ftre-accent-default)",
              animation: "ftre-spin 0.8s linear infinite",
            }}
          />
        ) : (
          <div style={{ width: 36, height: 36, fontSize: 28, color: "var(--ftre-status-error)" }}>!</div>
        )}
        <div style={{ fontSize: 15, fontWeight: 500 }}>
          {error ? "启动失败" : "正在启动后端..."}
        </div>
      </div>

      {/* 日志区 */}
      <div
        style={{
          width: "min(560px, 90vw)",
          maxHeight: 240,
          overflowY: "auto",
          borderRadius: 8,
          backgroundColor: "rgba(0, 0, 0, 0.15)",
          border: "1px solid var(--ftre-border-subtle)",
          padding: 12,
        }}
      >
        {logs.length === 0 && !error ? (
          <div style={{ color: "var(--ftre-text-faint)", fontSize: 12, textAlign: "center" }}>
            等待后端输出...
          </div>
        ) : (
          <pre
            style={{
              margin: 0,
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              lineHeight: 1.5,
              color: "var(--ftre-text-muted)",
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
            }}
          >
            {logs.join("\n")}
            <div ref={logEndRef} />
          </pre>
        )}
      </div>

      {/* 错误提示 */}
      {error && (
        <div
          style={{
            width: "min(560px, 90vw)",
            padding: 12,
            borderRadius: 8,
            backgroundColor: "var(--ftre-accent-dim)",
            border: "1px solid var(--ftre-status-error)",
            fontSize: 12,
            color: "var(--ftre-text-secondary)",
            lineHeight: 1.6,
          }}
        >
          {error}
        </div>
      )}

      {/* 旋转动画 keyframes（内联注入） */}
      <style>{`
        @keyframes ftre-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
