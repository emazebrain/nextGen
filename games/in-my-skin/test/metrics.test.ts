import { describe, expect, it } from "vitest";
import { METRIC_KEYS, computeMetrics, coverageBands, type RoundRecord } from "../src/metrics.ts";
import { manifest } from "../src/manifest.ts";

const row = (over: Partial<RoundRecord>): RoundRecord => ({
  level: 1, picture: "rocket", category: "objects_3d", direction: "ltr", movementType: 0, cls: "on_time", leg: 1, kind: "glide",
  errorMs: 0, offset: 0, spotsOff: null, coverage: 1, strayTaps: 0, ...over,
});

describe("metrics", () => {
  it("returns every key the manifest declares, and nothing when no round was played", () => {
    const empty = computeMetrics([]);
    expect(Object.keys(empty).sort()).toEqual([...manifest.metrics.map((m) => m.key)].sort());
    expect(Object.keys(empty).sort()).toEqual([...METRIC_KEYS].sort());
    for (const v of Object.values(empty)) expect(v).toBeNull();
  });

  it("shares rounds between on time, early, late and no stop", () => {
    const m = computeMetrics([
      row({ errorMs: 40 }),
      row({ cls: "early", errorMs: -300, coverage: 0.2 }),
      row({ cls: "late", errorMs: 200, coverage: 0.5, leg: 2 }),
      row({ cls: "no_stop", leg: null, errorMs: null, coverage: null }),
    ]);
    expect(m.accuracy).toBe(0.25);
    expect(m.early_rate).toBe(0.25);
    expect(m.late_rate).toBe(0.25);
    expect(m.no_stop_rate).toBe(0.25);
    expect(m.coverage_mean).toBeCloseTo(0.567, 3);
  });

  it("describes timing by size, direction and consistency, from glide stops", () => {
    const m = computeMetrics([row({ errorMs: -100 }), row({ errorMs: -50 }), row({ errorMs: 30 }), row({ kind: "jump", errorMs: null, spotsOff: 0 })]);
    expect(m.timing_error_ms).toBe(60);
    expect(m.timing_bias_ms).toBe(-40);
    expect(m.timing_spread_ms).toBe(66); // sample standard deviation of −100, −50, 30
    expect(computeMetrics([row({ errorMs: 20 })]).timing_spread_ms).toBeNull();
  });

  it("separates continuous movement from movement in intervals", () => {
    const m = computeMetrics([row({}), row({ cls: "late" }), row({ kind: "jump" }), row({ kind: "jump" }), row({ kind: "jump", cls: "no_stop", leg: null })]);
    expect(m.glide_accuracy).toBe(0.5);
    expect(m.jump_accuracy).toBeCloseTo(0.667, 3);
    expect(computeMetrics([row({})]).jump_accuracy).toBeNull();
  });

  it("counts first-pass stops, stray taps, the best streak and the highest level", () => {
    const m = computeMetrics([row({ strayTaps: 2 }), row({ leg: 2, level: 3 }), row({ cls: "early", strayTaps: 1 }), row({ leg: 3 })]);
    expect(m.first_leg_rate).toBeCloseTo(0.333, 3);
    expect(m.stray_taps).toBe(3);
    expect(m.best_streak).toBe(2);
    expect(m.highest_level).toBe(3);
  });

  it("groups stops by how much of the outline was covered", () => {
    expect(coverageBands([row({ coverage: 1 }), row({ coverage: 0.86 }), row({ coverage: 0.5 }), row({ coverage: 0.3 }), row({ coverage: 0 }), row({ coverage: null })])).toEqual({
      full: 1, c80: 1, c50: 1, c20: 1, less: 1,
    });
  });
});
