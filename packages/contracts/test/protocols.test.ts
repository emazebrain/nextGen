import { describe, expect, it } from "vitest";
import { DEFAULT_PROGRESSION, progressionRule, scheduleDates, stepInput, type GameStepInput } from "../src/protocols.ts";

const step = (extra: Partial<GameStepInput> = {}): GameStepInput => ({
  game_id: "catch-me-if-you-can",
  session_mode: "timed_lives",
  duration_s: 300,
  lives: 3,
  difficulty_start: 3,
  hemisphere: "left",
  timer_position: "left",
  practice: "auto",
  trial_window_ms: null,
  game_params: {},
  progression: DEFAULT_PROGRESSION,
  ...extra,
});

describe("steps", () => {
  it("accepts each mode with exactly its own fields", () => {
    expect(stepInput.safeParse(step()).success).toBe(true);
    expect(stepInput.safeParse(step({ session_mode: "timed", lives: null })).success).toBe(true);
    expect(stepInput.safeParse(step({ session_mode: "lives", duration_s: null })).success).toBe(true);
  });
  it("explains what a mode is missing", () => {
    const r = stepInput.safeParse(step({ session_mode: "timed", duration_s: null, lives: null }));
    expect(r.success).toBe(false);
    expect(r.error!.issues.map((i) => i.message)).toEqual(["needs_duration"]);
    const l = stepInput.safeParse(step({ session_mode: "lives", duration_s: 300, lives: null }));
    expect(l.error!.issues.map((i) => i.message).sort()).toEqual(["needs_lives", "no_duration_in_lives"]);
  });
  it("keeps the progression thresholds in order", () => {
    expect(progressionRule.safeParse({ ...DEFAULT_PROGRESSION, down_below: 0.85 }).success).toBe(false);
  });
});

describe("scheduleDates", () => {
  it("spreads sessions through each week", () => {
    expect(scheduleDates("2026-11-01", 2, 2)).toEqual([
      { seq: 1, week: 1, date: "2026-11-01" },
      { seq: 2, week: 1, date: "2026-11-04" },
      { seq: 3, week: 2, date: "2026-11-08" },
      { seq: 4, week: 2, date: "2026-11-11" },
    ]);
    expect(scheduleDates("2026-12-30", 1, 3).map((s) => s.date)).toEqual(["2026-12-30", "2027-01-01", "2027-01-03"]);
    expect(scheduleDates("2026-11-01", 6, 2)).toHaveLength(12);
  });
});

import { canonicalJson } from "../src/sessions.ts";
describe("canonicalJson", () => {
  it("sorts keys recursively and drops undefined", () => {
    expect(canonicalJson({ b: 1, a: { d: [2, { z: 1, y: 2 }], c: undefined } })).toBe('{"a":{"d":[2,{"y":2,"z":1}]},"b":1}');
  });
});
