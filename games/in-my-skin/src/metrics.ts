/** Session measures for In My Skin, from the round records. Pure. */
import type { StopClass } from "./engine.ts";
import type { LegKind } from "./motion.ts";

export interface RoundRecord {
  level: number;
  picture: string;
  category: string;
  direction: string;
  movementType: number;
  cls: StopClass;
  /** 1–3, or null when there was no stop. */
  leg: number | null;
  /** The kind of leg the stop came on; for a round with no stop, the kind of its last leg. */
  kind: LegKind;
  /** Glide stops only: signed timing error in ms (negative = early). */
  errorMs: number | null;
  /** Glide stops only: offset in picture lengths. */
  offset: number | null;
  /** Jump stops only: spots off (negative = before). */
  spotsOff: number | null;
  /** Share of the outline covered at the stop (0–1); null when there was no stop. */
  coverage: number | null;
  strayTaps: number;
}

export const METRIC_KEYS = [
  "accuracy", "early_rate", "late_rate", "no_stop_rate", "timing_error_ms", "timing_bias_ms", "timing_spread_ms",
  "coverage_mean", "first_leg_rate", "glide_accuracy", "jump_accuracy", "stray_taps", "highest_level", "best_streak",
] as const;

const mean = (v: number[]): number | null => (v.length ? v.reduce((s, x) => s + x, 0) / v.length : null);
const share = (part: number, whole: number): number | null => (whole ? part / whole : null);
const round = (v: number | null, digits = 0): number | null => (v === null ? null : Math.round(v * 10 ** digits) / 10 ** digits);

export function computeMetrics(records: RoundRecord[]): Record<(typeof METRIC_KEYS)[number], number | null> {
  const n = records.length;
  const count = (cls: StopClass) => records.filter((r) => r.cls === cls).length;
  const onTime = records.filter((r) => r.cls === "on_time");
  const errors = records.filter((r) => r.errorMs !== null).map((r) => r.errorMs!);
  const bias = mean(errors);
  const spread = errors.length >= 2 ? Math.sqrt(errors.reduce((s, e) => s + (e - bias!) ** 2, 0) / (errors.length - 1)) : null;
  const byKind = (kind: LegKind) => {
    const of = records.filter((r) => r.kind === kind);
    return share(of.filter((r) => r.cls === "on_time").length, of.length);
  };
  let streak = 0;
  let best = 0;
  for (const r of records) {
    streak = r.cls === "on_time" ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return {
    accuracy: round(share(onTime.length, n), 3),
    early_rate: round(share(count("early"), n), 3),
    late_rate: round(share(count("late"), n), 3),
    no_stop_rate: round(share(count("no_stop"), n), 3),
    timing_error_ms: round(mean(errors.map(Math.abs))),
    timing_bias_ms: round(bias),
    timing_spread_ms: round(spread),
    coverage_mean: round(mean(records.filter((r) => r.coverage !== null).map((r) => r.coverage!)), 3),
    first_leg_rate: round(share(onTime.filter((r) => r.leg === 1).length, onTime.length), 3),
    glide_accuracy: round(byKind("glide"), 3),
    jump_accuracy: round(byKind("jump"), 3),
    stray_taps: n ? records.reduce((s, r) => s + r.strayTaps, 0) : null,
    highest_level: n ? Math.max(...records.map((r) => r.level)) : null,
    best_streak: n ? best : null,
  };
}

/** The "how much of the outline was covered" view: counts of stops at 100%, at least 80%, at least 50%, at least 20%, and less. */
export function coverageBands(records: RoundRecord[]): Record<"full" | "c80" | "c50" | "c20" | "less", number> {
  const out = { full: 0, c80: 0, c50: 0, c20: 0, less: 0 };
  for (const r of records) {
    if (r.coverage === null) continue;
    if (r.coverage >= 0.995) out.full++;
    else if (r.coverage >= 0.8) out.c80++;
    else if (r.coverage >= 0.5) out.c50++;
    else if (r.coverage >= 0.2) out.c20++;
    else out.less++;
  }
  return out;
}
