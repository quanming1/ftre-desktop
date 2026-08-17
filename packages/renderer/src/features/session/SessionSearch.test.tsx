import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { SessionSearch } from "./SessionSearch";
import * as api from "@/services/api";

// fetch 走网络栈，mock 整个搜索 API
vi.mock("@/services/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/api")>();
  return { ...actual, fetchSessionSearch: vi.fn() };
});

const mockSearch = vi.mocked(api.fetchSessionSearch);

/** 显式推进防抖窗口（fake timers 下 waitFor 不会自动推进 macro task） */
async function flushDebounce(ms = 350) {
  await vi.advanceTimersByTimeAsync(ms);
}

function makeResult(sid: string, title: string, snippet: string) {
  return {
    session_id: sid,
    title,
    workspace: "E:/ftre",
    channel: "ws",
    updated_at: "2026-08-17T10:00:00+08:00",
    title_matched: title.includes("目标"),
    hits: [{ mid: "m1", role: "user", snippet }],
  };
}

beforeEach(() => {
  mockSearch.mockReset();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionSearch", () => {
  it("输入防抖后请求并渲染结果，标题与摘要高亮", async () => {
    mockSearch.mockResolvedValue({
      query: "目标",
      total: 1,
      results: [makeResult("s1", "部署目标文档", "正文里出现目标词的摘要")],
    });
    render(<SessionSearch onOpenSession={vi.fn()} onActiveChange={vi.fn()} />);

    fireEvent.change(screen.getByPlaceholderText("搜索会话内容..."), {
      target: { value: "目标" },
    });
    // 防抖 300ms 内未发起
    expect(mockSearch).not.toHaveBeenCalled();
    await flushDebounce();
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));

    // 标题分段渲染（高亮拆分文本），按按钮可访问名断言
    const item = await screen.findByRole("button", { name: /部署目标文档/ });
    // 标题 + 摘要各一处"目标"高亮
    const marks = screen.getAllByText("目标");
    expect(marks).toHaveLength(2);
    expect(marks.every((m) => m.tagName === "MARK")).toBe(true);
    expect(item.textContent).toContain("正文里出现目标词的摘要");
    expect(screen.getByText("1 个会话匹配")).toBeInTheDocument();
  });

  it("连续输入只保留最新请求，旧的被 abort", async () => {
    mockSearch.mockResolvedValue({ query: "", total: 0, results: [] });
    render(<SessionSearch onOpenSession={vi.fn()} onActiveChange={vi.fn()} />);
    const input = screen.getByPlaceholderText("搜索会话内容...");

    fireEvent.change(input, { target: { value: "会" } });
    vi.advanceTimersByTime(150);
    fireEvent.change(input, { target: { value: "会话" } });
    vi.advanceTimersByTime(150);
    fireEvent.change(input, { target: { value: "会话搜" } });
    await waitFor(() => expect(mockSearch).toHaveBeenCalledTimes(1));
    expect(mockSearch.mock.calls[0][0].q).toBe("会话搜");
    // signal 参数存在（供 abort）
    expect(mockSearch.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("点击结果调用 onOpenSession 并清空搜索", async () => {
    mockSearch.mockResolvedValue({
      query: "目标",
      total: 1,
      results: [makeResult("s1", "目标会话", "摘要")],
    });
    const onOpen = vi.fn();
    render(<SessionSearch onOpenSession={onOpen} onActiveChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话内容..."), {
      target: { value: "目标" },
    });
    await flushDebounce();
    fireEvent.click(await screen.findByRole("button", { name: /目标会话/ }));
    expect(onOpen).toHaveBeenCalledWith("s1");
    // 搜索已清空
    expect(screen.getByPlaceholderText("搜索会话内容...")).toHaveValue("");
  });

  it("Esc 清空退出，onActiveChange 反映搜索模式", async () => {
    mockSearch.mockResolvedValue({ query: "x", total: 0, results: [] });
    const onActive = vi.fn();
    render(<SessionSearch onOpenSession={vi.fn()} onActiveChange={onActive} />);
    const input = screen.getByPlaceholderText("搜索会话内容...");

    fireEvent.change(input, { target: { value: "目标" } });
    await waitFor(() => expect(onActive).toHaveBeenCalledWith(true));

    fireEvent.keyDown(input, { key: "Escape" });
    await waitFor(() => expect(onActive).toHaveBeenCalledWith(false));
    expect(input).toHaveValue("");
  });

  it("无结果显示空态", async () => {
    mockSearch.mockResolvedValue({ query: "zzz", total: 0, results: [] });
    render(<SessionSearch onOpenSession={vi.fn()} onActiveChange={vi.fn()} />);
    fireEvent.change(screen.getByPlaceholderText("搜索会话内容..."), {
      target: { value: "zzz" },
    });
    await flushDebounce();
    expect(await screen.findByText("无匹配会话")).toBeInTheDocument();
  });
});
