import { describe, expect, it } from "vitest";
import {
  buildProviderInfos,
  resolveEffortOnModelSwitch,
} from "./providerInfo";

describe("resolveEffortOnModelSwitch", () => {
  it("keeps the current effort when the new model lists it as selectable", () => {
    expect(resolveEffortOnModelSwitch("high", ["none", "low", "high", "max"])).toBe(
      "high",
    );
  });

  it("clears the effort when the new model supports reasoning but not the current value", () => {
    expect(resolveEffortOnModelSwitch("high", ["none", "low"])).toBe("");
  });

  it("clears the effort when the new model has no reasoning_effort_values (unsupported)", () => {
    expect(resolveEffortOnModelSwitch("max", undefined)).toBe("");
    expect(resolveEffortOnModelSwitch("max", [])).toBe("");
  });

  it("keeps the empty default when it is listed", () => {
    expect(resolveEffortOnModelSwitch("", ["", "low", "high"])).toBe("");
  });
});

describe("buildProviderInfos", () => {
  it("preserves reasoning_effort_values on the model entries", () => {
    const providers = {
      providerA: {
        api_key: "sk-test",
        models: [
          {
            name: "Model A",
            id: "model-a",
            reasoning_effort_values: ["none", "low", "high", "max"],
          },
          { name: "Model B", id: "model-b" },
        ],
      },
    };

    const infos = buildProviderInfos(providers);
    const models = infos[0].models;
    expect(models[0].reasoning_effort_values).toEqual(["none", "low", "high", "max"]);
    expect(models[1].reasoning_effort_values).toBeUndefined();
  });

  it("filters providers without api_key or models", () => {
    const providers = {
      noKey: { models: [{ name: "A", id: "a" }] },
      noModels: { api_key: "sk" },
      ok: { api_key: "sk", models: [{ name: "B", id: "b" }] },
    };

    const infos = buildProviderInfos(providers);
    expect(infos.map((p) => p.name)).toEqual(["ok"]);
  });
});
