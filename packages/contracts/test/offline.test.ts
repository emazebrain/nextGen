import { describe, expect, it } from "vitest";
import { offlineParams, paramsWithinAllowed, type AllowedParams } from "../src/index.ts";

const allowed: AllowedParams = {
  exact: { session_mode: "timed", duration_s: 60, hemisphere: "left", timer_position: "left", lang: "en", context: "clinic" },
  difficulty: { min: 1, max: 5 },
};
const params: Record<string, unknown> = { ...allowed.exact, difficulty: 3, seed: 42, practice: "off", instructions: "short" };

describe("paramsWithinAllowed", () => {
  it("accepts a difficulty inside the range with any seed, practice and instructions", () => {
    expect(paramsWithinAllowed(allowed, { ...params, difficulty: 4, seed: 7, practice: "on", instructions: "always" })).toBe(true);
  });
  it("refuses a changed setting, a difficulty outside the range, or an extra parameter", () => {
    expect(paramsWithinAllowed(allowed, { ...params, hemisphere: "right" })).toBe(false);
    expect(paramsWithinAllowed(allowed, { ...params, difficulty: 6 })).toBe(false);
    expect(paramsWithinAllowed(allowed, { ...params, difficulty: 2.5 })).toBe(false);
    expect(paramsWithinAllowed(allowed, { ...params, speed_scale: 2 })).toBe(false);
    const { duration_s: _d, ...missing } = params;
    expect(paramsWithinAllowed(allowed, missing)).toBe(false);
  });
});

describe("offlineParams", () => {
  const base = { ...allowed.exact };
  it("shows practice only on a step's first session when it's automatic, and full instructions for the first two", () => {
    expect(offlineParams(base, { difficulty: 3, sessionsCompleted: 0, practiceSetting: "auto", seed: 1 })).toMatchObject({ practice: "on", instructions: "always" });
    expect(offlineParams(base, { difficulty: 3, sessionsCompleted: 1, practiceSetting: "auto", seed: 1 })).toMatchObject({ practice: "off", instructions: "always" });
    expect(offlineParams(base, { difficulty: 3, sessionsCompleted: 2, practiceSetting: "on", seed: 1 })).toMatchObject({ practice: "on", instructions: "short" });
  });
  it("applies difficulty and seed and leaves the base untouched", () => {
    const p = offlineParams(base, { difficulty: 5, sessionsCompleted: 3, practiceSetting: "off", seed: 99 });
    expect(p).toMatchObject({ difficulty: 5, seed: 99 });
    expect(paramsWithinAllowed(allowed, p)).toBe(true);
    expect(base).not.toHaveProperty("difficulty");
  });
});
