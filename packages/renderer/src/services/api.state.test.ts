import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchAgentStateMessage, fetchAgentStatePage } from "./api";

describe("state.json API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("默认请求最近一页，显式 offset 时请求指定页", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], page: { total: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAgentStatePage("ws_sess_a", { limit: 50 });
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toContain("/api/sessions/ws_sess_a/state?");
    expect(firstUrl).toContain("limit=50");
    expect(firstUrl).not.toContain("offset=");

    await fetchAgentStatePage("ws_sess_a", { offset: 100, limit: 25 });
    const secondUrl = String(fetchMock.mock.calls[1][0]);
    expect(secondUrl).toContain("offset=100");
    expect(secondUrl).toContain("limit=25");
  });

  it("超长消息通过独立接口按需加载", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "call/a b" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchAgentStateMessage("ws_sess_a", "call/a b");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/state/messages/call%2Fa%20b",
    );
  });

  it("HTTP 失败时抛出明确错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchAgentStatePage("missing")).rejects.toThrow("HTTP 404");
  });
});
