import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  SessionSearchInput,
  SessionSearchResults,
  useSessionSearch,
} from "./SessionSearch";
import * as api from "@/services/api";

vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return { ...actual, fetchSessionSearch: vi.fn() };
});

const mockSearch = vi.mocked(api.fetchSessionSearch);

/** 显式推进防抖窗口（fake timers 下 waitFor 不会自动推进 macro task） */
async function flushDebounce(ms = 350) {
  await vi.advanceTimersByTimeAsync(ms);
}

/** 把 hook 挂到宿主组件上测试（状态 + 防抖 + abort 行为） */
function HookHost({ onRender }: { onRender: (h: ReturnType<typeof useSessionSearch>) => void }) {
  const hook = useSessionSearch();
  onRender(hook);
  return null;
}

beforeEach(() => {
  mockSearch.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useSessionSearch", () => {
  it("防抖 300ms 后发起请求，结果入 state", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSearch.mockResolvedValue({
      query: "目标",
      total: 1,
      results: [
        {
          session_id: "s1",
          title: "目标会话",
          workspace: "",
          channel: "ws",
          updated_at: "2026-08-17T10:00:00+08:00",
          title_matched: true,
          hits: [{ mid: "m1", role: "user", snippet: "正文目标" }],
        },
      ],
    });
    let hook: ReturnType<typeof useSessionSearch> | null = null;
    render(
      <HookHost
        onRender={(h) => {
          hook = h;
        }}
      />,
    );

    hook!.setQuery("目标");
    expect(mockSearch).not.toHaveBeenCalled();
    await flushDebounce();
    await waitFor(() => expect(hook!.response?.total).toBe(1));
    expect(hook!.active).toBe(true);
    expect(hook!.loading).toBe(false);
  });

  it("连续输入只保留最后一次（旧的被 abort）", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockSearch.mockResolvedValue({ query: "", total: 0, results: [] });
    let hook: ReturnType<typeof useSessionSearch> | null = null;
    render(
      <HookHost
        onRender={(h) => {
          hook = h;
        }}
      />,
    );

    const setQ = (v: string) => act(() => void hook!.setQuery(v));
    setQ("会");
    await vi.advanceTimersByTimeAsync(100);
    setQ("会话");
    await vi.advanceTimersByTimeAsync(100);
    setQ("会话搜");
    await flushDebounce();
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
    expect(mockSearch.mock.calls[0][0].q).toBe("会话搜");
    expect(mockSearch.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("openAndReset 清空搜索并回调", () => {
    const open = vi.fn();
    let hook: ReturnType<typeof useSessionSearch> | null = null;
    render(
      <HookHost
        onRender={(h) => {
          hook = h;
        }}
      />,
    );
    hook!.openAndReset("s9", open);
    expect(open).toHaveBeenCalledWith("s9");
    expect(hook!.query).toBe("");
  });
});

describe("SessionSearchInput", () => {
  it("受控输入 + Esc 清空", () => {
    const onChange = vi.fn();
    render(<SessionSearchInput query="目标" loading={false} onChange={onChange} />);
    const input = screen.getByPlaceholderText("搜索会话...");
    fireEvent.change(input, { target: { value: "目标词" } });
    expect(onChange).toHaveBeenCalledWith("目标词");
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("空 query 不显示清空按钮", () => {
    render(<SessionSearchInput query="" loading={false} onChange={vi.fn()} />);
    expect(screen.queryByTitle("清空 (Esc)")).not.toBeInTheDocument();
  });
});

describe("SessionSearchResults", () => {
  const response = {
    query: "目标",
    total: 1,
    results: [
      {
        session_id: "s1",
        title: "部署目标文档",
        workspace: "E:/ftre",
        channel: "ws",
        updated_at: new Date(Date.now() - 3600_000).toISOString(),
        title_matched: true,
        hits: [{ mid: "m1", role: "user", snippet: "正文里出现目标词" }],
      },
    ],
  };

  it("渲染匹配数、高亮标题与摘要，点击回调", () => {
    const onOpen = vi.fn();
    render(
      <SessionSearchResults query="目标" response={response} loading={false} onOpen={onOpen} />,
    );

    expect(screen.getByText("1 个会话匹配")).toBeInTheDocument();
    expect(screen.getByText("标题")).toBeInTheDocument(); // 命中角标
    const marks = screen.getAllByText("目标");
    expect(marks.every((m) => m.tagName === "MARK")).toBe(true);

    // 标题被高亮分段，按整串 textContent 定位行容器后点击
    const titleSpan = screen.getByText(
      (_, el) => el?.textContent === "部署目标文档" && el.tagName === "SPAN",
    );
    fireEvent.click(titleSpan.closest("div.rounded-lg")!);
    expect(onOpen).toHaveBeenCalledWith("s1");
  });

  it("无结果显示空态", () => {
    render(
      <SessionSearchResults query="zzz" response={null} loading={false} onOpen={vi.fn()} />,
    );
    expect(screen.getByText("无匹配会话")).toBeInTheDocument();
  });
});
