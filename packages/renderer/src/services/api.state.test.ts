import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchSessionStateMessage,
  fetchSessionStatePage,
  fetchSkills,
  forkSessionRemote,
  rollbackSessionRemote,
} from "./api";

describe("session state API", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("默认请求最近一页，显式 offset 时请求指定页", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [], page: { total: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await fetchSessionStatePage("ws_sess_a", { limit: 50 });
    const firstUrl = String(fetchMock.mock.calls[0][0]);
    expect(firstUrl).toContain("/api/sessions/ws_sess_a/state?");
    expect(firstUrl).toContain("limit=50");
    expect(firstUrl).not.toContain("offset=");

    await fetchSessionStatePage("ws_sess_a", { offset: 100, limit: 25 });
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

    await fetchSessionStateMessage("ws_sess_a", "call/a b");
    expect(String(fetchMock.mock.calls[0][0])).toContain(
      "/state/messages/call%2Fa%20b",
    );
  });

  it("HTTP 失败时抛出明确错误", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    await expect(fetchSessionStatePage("missing")).rejects.toThrow("HTTP 404");
  });

  it("旧 Skill 响应缺少 scope 时保持未知而不是误标为全局", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        skills: [{
          name: "browser",
          description: "Browser",
          source: { kind: "filesystem", path: "C:/Users/test/.codex/skills/browser/SKILL.md" },
        }],
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const [skill] = await fetchSkills("default");

    expect(skill.scope).toBeUndefined();
    expect(skill.origin).toBeUndefined();
    expect(skill.source).toEqual({
      kind: "filesystem",
      path: "C:/Users/test/.codex/skills/browser/SKILL.md",
    });
  });

  it("Fork 截止点通过 Msg id 发送，空参数保持全量 fork", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        fork_session_id: "ws_sess_child",
        title: "fork of parent",
        workspace: "E:/repo",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await forkSessionRemote("ws_sess_parent", "assistant-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/sessions/ws_sess_parent/fork");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ through_message_id: "assistant-1" });

    await forkSessionRemote("ws_sess_parent");
    expect(fetchMock.mock.calls[1][1]).toEqual({ method: "POST" });
  });

  it("rollback 使用独立接口并保留当前 session id", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        session_id: "ws_sess_parent",
        through_message_id: "user-1",
        seq: 12,
        removed_message_ids: ["user-1"],
        prefill_content: [{ type: "text", text: "retry" }],
        title: "parent",
        workspace: "E:/repo",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await rollbackSessionRemote("ws_sess_parent", "user-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toContain("/api/sessions/ws_sess_parent/rollback");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ through_message_id: "user-1" });
    expect(result?.session_id).toBe("ws_sess_parent");
  });
});
