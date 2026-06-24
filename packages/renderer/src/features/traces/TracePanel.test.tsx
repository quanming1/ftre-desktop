import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TracePanel } from "./TracePanel";

const clearTraceFocus = vi.hoisted(() => vi.fn());

vi.mock("@/stores/layout", () => ({
  useLayout: (selector: (state: any) => unknown) => selector({
    traceFocusSessionId: "sess_1",
    clearTraceFocus,
  }),
}));

vi.mock("@/services/api", () => ({
  fetchTraces: vi.fn(async () => ({
    path: "C:\\Users\\test\\.ftre\\traces\\agent-traces.sqlite",
    total: 1,
    limit: 100,
    offset: 0,
    next_offset: null,
    has_more: false,
    traces: [{
      trace_id: "trace-1",
      name: "session:sess_1",
      status: "completed",
      start_time: "2026-06-22T10:00:00Z",
      end_time: "2026-06-22T10:00:01Z",
      duration_ms: 1000,
      metadata: { session_id: "sess_1" },
      tags: ["ws"],
      outputs: { success: true },
      run_count: 2,
      llm_run_count: 1,
      tool_run_count: 0,
      stop_without_tools: 1,
      response_models: ["qwen3.7-max"],
      error_count: 0,
    }],
  })),
  fetchTrace: vi.fn(async () => ({
    trace_id: "trace-1",
    runs: [
      {
        id: "root", trace_id: "trace-1", parent_run_id: null, name: "react_agent",
        run_type: "agent", status: "completed", start_time: "2026-06-22T10:00:00Z",
        end_time: "2026-06-22T10:00:01Z", duration_ms: 1000,
        inputs: {}, outputs: { success: true }, error: null, metadata: {}, tags: [], events: [],
      },
      {
        id: "llm", trace_id: "trace-1", parent_run_id: "root", name: "llm",
        run_type: "llm", status: "completed", start_time: "2026-06-22T10:00:00Z",
        end_time: "2026-06-22T10:00:00.5Z", duration_ms: 500, inputs: {},
        outputs: { finish_reason: "stop", has_tool_calls: false, response_metadata: { model: "qwen3.7-max" } },
        error: null, metadata: {}, tags: [], events: [],
      },
    ],
  })),
  fetchTraceRun: vi.fn(async () => ({
    id: "root", trace_id: "trace-1", parent_run_id: null, name: "react_agent",
    run_type: "agent", status: "completed", start_time: "2026-06-22T10:00:00Z",
    end_time: "2026-06-22T10:00:01Z", duration_ms: 1000,
    inputs: { message: "start" }, outputs: { success: true }, error: null,
    metadata: { session_id: "sess_1" }, tags: [], events: [], payload_loaded: true,
  })),
}));

describe("TracePanel", () => {
  afterEach(() => vi.clearAllMocks());

  it("loads trace summaries and renders the run tree", async () => {
    render(<TracePanel />);

    expect(screen.getByTestId("trace-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("sess_1")).toBeInTheDocument());
    await waitFor(() => expect(clearTraceFocus).toHaveBeenCalled());
    expect(screen.getAllByText("react_agent")).toHaveLength(2);
    expect(screen.getByText("LLM 1")).toBeInTheDocument();
    expect(screen.getByText("stop/no-tool 1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Input" })).toBeInTheDocument();
    expect(screen.queryByText("INPUT")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Tree" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "文本" })).toBeInTheDocument();
    expect(screen.getByText("Root")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "收起 Traces" }));
    expect(screen.getByRole("button", { name: "展开 Traces" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起 Run Tree" }));
    expect(screen.getByRole("button", { name: "展开 Run Tree" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起 Run Detail" }));
    expect(screen.getByRole("button", { name: "展开 Run Detail" })).toBeInTheDocument();
  });
});
