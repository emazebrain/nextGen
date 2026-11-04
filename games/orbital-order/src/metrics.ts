/**
 * Orbital Order measures (design doc §8.4 "Game metrics"), ported from v1
 * `metrics.js`. Pure: built only from the trial records.
 *
 * Fixed from v1 (ADR 0013):
 * - `max_chain` counts the longest run of correct taps in any trial, including
 *   chains that broke (v1 only counted finished chains, so a child who always
 *   slipped on the last sphere scored 0).
 * - Latencies keep genuine zero-free values only where they're timing a tap;
 *   the motor baseline and probe now actually run (see engine.ts).
 */
import type { Difficulty } from "./config.ts";
import type { ErrorClass } from "./rules.ts";

export interface TrialRecord {
  segment: "practice" | "probe" | "rules";
  index: number;
  block: number;
  switchTrial: boolean;
  difficulty: Difficulty;
  chainLength: number;
  correctTaps: number;
  longestRun: number;
  outcome: "correct" | "incorrect";
  error: ErrorClass | null;
  /** From the end of the rule reveal to the first tap. */
  firstTapMs: number | null;
  /** Between consecutive taps. */
  gapsMs: number[];
  totalMs: number;
  rechecks: number;
  recheckMs: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));

export class OrbitalMetrics {
  readonly trials: TrialRecord[] = [];
  readonly motorMs: number[] = [];

  addTrial(t: TrialRecord) {
    this.trials.push(t);
  }

  motorTap(ms: number) {
    this.motorMs.push(ms);
  }

  summary() {
    const scored = this.trials.filter((t) => t.segment === "probe" || t.segment === "rules");
    const right = scored.filter((t) => t.outcome === "correct");
    const firsts = scored.map((t) => t.firstTapMs).filter((v): v is number => v !== null && v > 0);
    const gaps = scored.flatMap((t) => t.gapsMs).filter((v) => v > 0);
    const switches = scored.filter((t) => t.segment === "rules" && t.switchTrial && t.firstTapMs);
    const steady = scored.filter((t) => t.segment === "rules" && !t.switchTrial && t.firstTapMs);
    const errors = scored.filter((t) => t.error);
    const share = (c: ErrorClass) => (errors.length ? errors.filter((t) => t.error === c).length / errors.length : null);
    const probe = this.trials.filter((t) => t.segment === "probe");
    const practice = this.trials.filter((t) => t.segment === "practice");
    let fatigue: number | null = null;
    if (scored.length >= 4) {
      const half = Math.floor(scored.length / 2);
      const acc = (a: TrialRecord[]) => a.filter((t) => t.outcome === "correct").length / Math.max(1, a.length);
      fatigue = acc(scored.slice(half)) - acc(scored.slice(0, half));
    }
    const mf = mean(firsts);
    const mg = mean(gaps);
    const chains = right.map((t) => t.chainLength);
    return {
      trials_offered: scored.length,
      chain_completion_rate: scored.length ? r3(right.length / scored.length) : null,
      probe_accuracy: probe.length ? r3(probe.filter((t) => t.outcome === "correct").length / probe.length) : null,
      max_chain: scored.reduce((m, t) => Math.max(m, t.longestRun), 0),
      mean_chain_length: r3(mean(chains)),
      first_tap_latency_ms: r0(mf),
      inter_tap_latency_ms: r0(mg),
      planning_ratio: mf !== null && mg ? r3(mf / mg) : null,
      rule_switch_cost_ms: switches.length && steady.length ? r0(mean(switches.map((t) => t.firstTapMs!))! - mean(steady.map((t) => t.firstTapMs!))!) : null,
      inhibition_index: r3(share("inhibition")),
      order_error_share: r3(share("order")),
      timeout_share: r3(share("timeout")),
      fatigue_slope: r3(fatigue),
      rule_recheck_rate: scored.length ? r3(scored.reduce((a, t) => a + t.rechecks, 0) / scored.length) : null,
      baseline_tap_latency_ms: r0(median(this.motorMs)),
      motor_baseline_trials: this.motorMs.length,
      probe_first_tap_latency_ms: r0(mean(probe.map((t) => t.firstTapMs).filter((v): v is number => v !== null && v > 0))),
      comprehension_gate: practice.length === 0 ? "skipped" : practice.filter((t) => t.outcome === "correct").length >= 2 ? "passed" : "failed",
      best_streak: bestStreak(scored),
    };
  }
}

/** Finished chains in a row. */
function bestStreak(trials: TrialRecord[]): number {
  let best = 0;
  let cur = 0;
  for (const t of trials) {
    cur = t.outcome === "correct" ? cur + 1 : 0;
    best = Math.max(best, cur);
  }
  return best;
}
