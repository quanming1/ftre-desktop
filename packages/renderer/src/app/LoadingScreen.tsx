import { useState, useEffect, useRef, useCallback } from "react";
import { ChevronDown, AlertTriangle, RotateCw } from "lucide-react";
import { FtreLogo } from "@/components/FtreLogo";
import { useWsStatus } from "@/stores/chat";

export function LoadingScreen() {
  const wsStatus = useWsStatus();
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

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
          setError((current) => current || "后端进程异常退出，请展开日志查看原因。");
          setLogsExpanded(true);
        }
      });
      cleanups.push(offExit);

      const applyStatus = (status: {
        state: string;
        error?: { message: string; recentLogs?: string[] };
      }) => {
        if (status.error?.recentLogs?.length) {
          setLogs(status.error.recentLogs.slice(-100));
        }
        if (status.state === "failed") {
          setError(status.error?.message || "后端启动失败，请检查运行时和配置。");
          setLogsExpanded(true);
        } else if (status.state === "starting" || status.state === "ready") {
          setError(null);
        }
      };
      const offState = window.desktop.backend.onState(applyStatus);
      cleanups.push(offState);
      void window.desktop.backend.getStatus().then(applyStatus).catch(() => undefined);
    }

    return () => cleanups.forEach((fn) => fn());
  }, []);

  const scrollToBottom = useCallback(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [logs, scrollToBottom]);

  const handleRestart = async () => {
    if (!window.desktop?.backend?.restart) return;
    setRestarting(true);
    setError(null);
    try {
      await window.desktop.backend.restart();
    } catch (e) {
      console.error("[loading] 重启后端失败:", e);
    }
    setTimeout(() => setRestarting(false), 3000);
  };

  const statusText = () => {
    if (error) return "启动失败";
    if (restarting) return "正在重启后端...";
    if (wsStatus === "reconnecting") return "正在重新连接...";
    return "正在启动后端...";
  };

  const hasLogs = logs.length > 0;

  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-8 bg-[var(--ftre-bg-base)] text-[var(--ftre-text-primary)] z-[9999] font-sans">
      {/* Logo + 状态 */}
      <div className="flex flex-col items-center gap-5">
        <div className={`${error ? "" : "animate-pulse"}`}>
          {error ? (
            <div className="w-10 h-10 rounded-full flex items-center justify-center bg-[var(--ftre-accent-dim)] border border-[var(--ftre-status-error)]">
              <AlertTriangle size={20} className="text-[var(--ftre-status-error)]" />
            </div>
          ) : (
            <FtreLogo size={3} />
          )}
        </div>
        <div className="text-[15px] font-medium text-[var(--ftre-text-secondary)]">
          {statusText()}
        </div>
      </div>

      {/* 日志区（可折叠） */}
      {hasLogs && (
        <div className="w-[min(560px,90vw)]">
          <button
            onClick={() => setLogsExpanded(!logsExpanded)}
            className="flex items-center gap-1.5 text-[12px] text-[var(--ftre-text-dim)] hover:text-[var(--ftre-text-secondary)] transition-colors"
          >
            <ChevronDown size={13} className={`transition-transform duration-200 ${logsExpanded ? "rotate-180" : ""}`} />
            后端日志 ({logs.length})
          </button>
          {logsExpanded && (
            <div className="mt-2 max-h-[240px] overflow-y-auto rounded-lg bg-[var(--ftre-bg-elevated)] border border-[var(--ftre-border-subtle)] p-3">
              <pre className="m-0 font-mono text-[11px] leading-[1.5] text-[var(--ftre-text-muted)] whitespace-pre-wrap break-all">
                {logs.join("\n")}
                <div ref={logEndRef} />
              </pre>
            </div>
          )}
        </div>
      )}

      {/* 错误态 + 重启按钮 */}
      {error && (
        <div className="flex flex-col items-center gap-3 w-[min(560px,90vw)]">
          <div className="w-full p-3 rounded-lg bg-[var(--ftre-accent-dim)] border border-[var(--ftre-status-error)] text-[12px] text-[var(--ftre-text-secondary)] leading-[1.6]">
            {error}
          </div>
          {window.desktop?.backend?.restart && (
            <button
              onClick={handleRestart}
              disabled={restarting}
              className="flex items-center gap-2 h-9 px-5 rounded-md text-[13px] font-medium bg-[var(--ftre-accent-default)] text-[var(--ftre-bg-base)] hover:bg-[var(--ftre-accent-hover)] active:scale-[0.96] transition-[background-color,transform] disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <RotateCw size={13} className={restarting ? "animate-spin" : ""} />
              {restarting ? "重启中..." : "重启后端"}
            </button>
          )}
        </div>
      )}

      {/* 等待输出提示 */}
      {!hasLogs && !error && (
        <div className="text-[12px] text-[var(--ftre-text-faint)]">
          等待后端输出...
        </div>
      )}
    </div>
  );
}
