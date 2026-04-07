import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, Copy, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "./Button";
import { cn } from "../utils/cn";

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  level?: "app" | "region";
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
    copied: false,
  };

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
  }

  handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
      copied: false,
    });
    this.props.onReset?.();
  };

  handleCopy = async () => {
    const { error, errorInfo } = this.state;
    const errorText = [
      `Error: ${error?.message}`,
      "",
      "Stack:",
      error?.stack,
      "",
      "Component Stack:",
      errorInfo?.componentStack,
    ].join("\n");

    await navigator.clipboard.writeText(errorText);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  toggleDetails = () => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  render() {
    const { children, fallback, level = "region" } = this.props;
    const { hasError, error, errorInfo, showDetails, copied } = this.state;

    if (!hasError) {
      return children;
    }

    if (fallback) {
      return fallback;
    }

    const isAppLevel = level === "app";

    return (
      <div
        className={cn(
          "flex items-center justify-center",
          isAppLevel ? "h-full w-full" : "min-h-[200px] p-4",
        )}
        style={{ backgroundColor: "var(--ftre-base, #1e1e1e)" }}
      >
        <div
          className={cn(
            "relative overflow-hidden rounded-md",
            isAppLevel ? "w-full max-w-lg" : "w-full max-w-md",
          )}
          style={{
            backgroundColor: "var(--ftre-surface, #252526)",
            border: "1px solid var(--ftre-border, #3c3c3c)",
          }}
        >
          {/* 顶部错误指示条 */}
          <div
            className="h-1"
            style={{
              background:
                "linear-gradient(to right, var(--ftre-error, #f85149), var(--ftre-error, #f85149) 60%, transparent)",
            }}
          />

          <div className="p-6">
            {/* 错误图标和标题 */}
            <div className="flex items-start gap-4">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md"
                style={{ backgroundColor: "rgba(248, 81, 73, 0.1)" }}
              >
                <AlertTriangle
                  className="h-5 w-5"
                  style={{ color: "var(--ftre-error, #f85149)" }}
                />
              </div>
              <div className="min-w-0 flex-1">
                <h3
                  className="text-[14px] font-medium"
                  style={{ color: "var(--ftre-text-primary, #e8e8e8)" }}
                >
                  {isAppLevel ? "应用发生错误" : "组件渲染错误"}
                </h3>
                <p
                  className="mt-1 text-[13px] line-clamp-2"
                  style={{ color: "var(--ftre-text-muted, #aab0b8)" }}
                >
                  {error?.message || "发生了未知错误"}
                </p>
              </div>
            </div>

            {/* 错误详情（可折叠） */}
            {errorInfo && (
              <div className="mt-4">
                <button
                  onClick={this.toggleDetails}
                  className="flex w-full items-center gap-2 text-[12px] transition-colors"
                  style={{ color: "var(--ftre-text-dim, #969ca6)" }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.color = "var(--ftre-text-secondary, #cccccc)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.color = "var(--ftre-text-dim, #969ca6)")
                  }
                >
                  {showDetails ? (
                    <ChevronUp className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                  <span>{showDetails ? "隐藏详情" : "查看详情"}</span>
                </button>

                {showDetails && (
                  <div className="mt-3 space-y-3">
                    {/* 错误堆栈 */}
                    <div
                      className="rounded p-3"
                      style={{
                        backgroundColor: "var(--ftre-base, #1e1e1e)",
                        border: "1px solid var(--ftre-border-subtle, #454545)",
                      }}
                    >
                      <div
                        className="mb-2 text-[11px] font-medium uppercase tracking-wide"
                        style={{ color: "var(--ftre-text-ghost, #888e98)" }}
                      >
                        Error Stack
                      </div>
                      <pre
                        className="overflow-auto text-[11px] leading-relaxed font-mono max-h-32"
                        style={{ color: "rgba(248, 81, 73, 0.9)" }}
                      >
                        {error?.stack}
                      </pre>
                    </div>

                    {/* 组件堆栈 */}
                    <div
                      className="rounded p-3"
                      style={{
                        backgroundColor: "var(--ftre-base, #1e1e1e)",
                        border: "1px solid var(--ftre-border-subtle, #454545)",
                      }}
                    >
                      <div
                        className="mb-2 text-[11px] font-medium uppercase tracking-wide"
                        style={{ color: "var(--ftre-text-ghost, #888e98)" }}
                      >
                        Component Stack
                      </div>
                      <pre
                        className="overflow-auto text-[11px] leading-relaxed font-mono max-h-32"
                        style={{ color: "var(--ftre-text-dim, #969ca6)" }}
                      >
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 操作按钮 */}
            <div className="mt-6 flex items-center gap-3">
              <Button onClick={this.handleReset} variant="primary" size="sm" className="gap-1.5">
                <RotateCcw className="h-3.5 w-3.5" />
                重试
              </Button>
              <Button onClick={this.handleCopy} variant="ghost" size="sm" className="gap-1.5">
                <Copy className="h-3.5 w-3.5" />
                {copied ? "已复制" : "复制错误"}
              </Button>
            </div>
          </div>

          {/* 底部装饰线 */}
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{
              background:
                "linear-gradient(to right, transparent, var(--ftre-border, #3c3c3c), transparent)",
            }}
          />
        </div>
      </div>
    );
  }
}
