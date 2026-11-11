import { describe, expect, it } from "vitest";
import { computeMetrics } from "../src/metrics.ts";
import type { RoundRecord } from "../src/engine.ts";

const rec = (overrides: Partial<RoundRecord> = {}): RoundRecord => ({
  bodyPart: "hand", pose: "thumbsup", correctSide: "left", chosenSide: "left",
  rotationDeg: 30, rotationDir: "cw", rt_ms: 500, level: 5, outcome: "correct",
  ...overrides,
});

describe("computeMetrics", () => {
  it("computes accuracy, omission_rate, wrong_rate", () => {
    const records = [rec(), rec({ outcome: "wrong", chosenSide: "right" }), rec({ outcome: "omission", chosenSide: null, rt_ms: null })];
    const m = computeMetrics(records);
    expect(m.accuracy).toBeCloseTo(1 / 3);
    expect(m.wrong_rate).toBeCloseTo(1 / 3);
    expect(m.omission_rate).toBeCloseTo(1 / 3);
  });

  it("computes median RT for correct answers", () => {
    const records = [rec({ rt_ms: 400 }), rec({ rt_ms: 600 }), rec({ rt_ms: 800 })];
    const m = computeMetrics(records);
    expect(m.rt_correct_ms).toBe(600);
  });

  it("computes left_accuracy and right_accuracy", () => {
    const records = [
      rec({ correctSide: "left", outcome: "correct" }),
      rec({ correctSide: "left", outcome: "wrong", chosenSide: "right" }),
      rec({ correctSide: "right", outcome: "correct" }),
    ];
    const m = computeMetrics(records);
    expect(m.left_accuracy).toBeCloseTo(0.5);
    expect(m.right_accuracy).toBe(1);
  });

  it("computes best_streak and highest_level", () => {
    const records = [rec({ level: 3 }), rec({ level: 4 }), rec({ outcome: "wrong", level: 3, chosenSide: "right" }), rec({ level: 3 })];
    const m = computeMetrics(records);
    expect(m.best_streak).toBe(2);
    expect(m.highest_level).toBe(4);
  });

  it("returns null for rt_correct_ms with no correct answers", () => {
    const m = computeMetrics([rec({ outcome: "wrong", chosenSide: "right" })]);
    expect(m.rt_correct_ms).toBeNull();
  });

  it("returns nulls for empty input", () => {
    const m = computeMetrics([]);
    expect(m.accuracy).toBeNull();
  });

  it("computes rotation_effect_ms (median RT high-rotation minus low-rotation)", () => {
    const records = [
      rec({ rotationDeg: 10, rt_ms: 400 }),
      rec({ rotationDeg: 15, rt_ms: 420 }),
      rec({ rotationDeg: 100, rt_ms: 700 }),
      rec({ rotationDeg: 120, rt_ms: 750 }),
    ];
    const m = computeMetrics(records);
    // median low = 410, median high = 725 → effect = 315
    expect(m.rotation_effect_ms).toBe(315);
  });
});
