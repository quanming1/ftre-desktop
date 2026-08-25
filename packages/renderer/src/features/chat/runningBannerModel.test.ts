import { describe, expect, it } from "vitest";
import { resolveRunningBannerModel } from "./runningBannerModel";

describe("resolveRunningBannerModel", () => {
  it("uses the compact-start model instead of the previous assistant model", () => {
    expect(resolveRunningBannerModel({
      sessionStatus: "compacting",
      storeModel: "tencent/glm-5.3",
      messages: [
        {
          id: "reply-1",
          role: "assistant",
          content: "previous reply",
          timestamp: 1,
          model: "tencent/glm-5.3",
        },
        {
          id: "compact-1",
          role: "system",
          content: null,
          timestamp: 2,
          compact: { status: "running", model: "deepseek-v4-flash" },
        },
      ],
    })).toBe("deepseek-v4-flash");
  });

  it("does not mislabel compression when an old gateway omits the model", () => {
    expect(resolveRunningBannerModel({
      sessionStatus: "compacting",
      storeModel: "tencent/glm-5.3",
      messages: [
        {
          id: "reply-1",
          role: "assistant",
          content: "previous reply",
          timestamp: 1,
          model: "tencent/glm-5.3",
        },
        {
          id: "compact-1",
          role: "system",
          content: null,
          timestamp: 2,
          compact: { status: "running" },
        },
      ],
    })).toBeNull();
  });
});
