/** Picture Trail: session metrics from the completed rounds (spec 2026-11-10). Pure. */
import type { RoundOutcome } from "./engine.ts";

export interface RoundRecord {
  level: number;
  n: number;
  outcome: RoundOutcome;
  /** From the match's appearance to the tap; null when not found. */
  rt: number | null;
  wrongTaps: number;
  /** Pictures shown in the answer run before the round ended. */
  answerShown: number;
}

const median = (xs: number[]) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

export function computeMetrics(rounds: RoundRecord[]): Record<string, number> {
  const n = rounds.length;
  const correct = rounds.filter((r) => r.outcome === "correct");
  const shown = rounds.reduce((s, r) => s + r.answerShown, 0);
  const byN = new Map<number, number>();
  for (const r of correct) byN.set(r.n, (byN.get(r.n) ?? 0) + 1);
  let streak = 0;
  let best = 0;
  for (const r of rounds) {
    streak = r.outcome === "correct" ? streak + 1 : 0;
    best = Math.max(best, streak);
  }
  return {
    rounds: n,
    accuracy: n ? correct.length / n : 0,
    miss_rate: n ? rounds.filter((r) => r.outcome === "omission").length / n : 0,
    wrong_tap_rate: shown ? rounds.reduce((s, r) => s + r.wrongTaps, 0) / shown : 0,
    rt_correct_ms: median(correct.map((r) => r.rt ?? 0)),
    span: Math.max(0, ...[...byN].filter(([, c]) => c >= 2).map(([k]) => k)),
    best_streak: best,
    highest_level: Math.max(0, ...rounds.map((r) => r.level)),
  };
}
