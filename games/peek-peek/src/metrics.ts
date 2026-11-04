/**
 * Peek Peek measures (design doc §8.4 "Game metrics"), ported from v1
 * `metrics.js`. Pure: every call takes `now` (ms, pause-adjusted), nothing
 * reads a clock.
 *
 * Fixed from v1 (ADR 0012):
 * - A wrong tap is classed before it's marked as shown, so "within",
 *   "between" and "novel" errors are told apart (v1 classed every miss as
 *   "within", so the perseveration rate was always 100%).
 * - `learning_slope` compares each round's misses with what chance would give
 *   for that round's pool, then fits a slope over rounds (v1 spread misses
 *   evenly, so the slope was always flat). Negative = getting better.
 */
import { expectedMisses } from "./config.ts";

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
function slope(points: Array<{ x: number; y: number }>): number | null {
  if (points.length < 2) return null;
  const mx = mean(points.map((p) => p.x))!;
  const my = mean(points.map((p) => p.y))!;
  let num = 0;
  let den = 0;
  for (const p of points) {
    num += (p.x - mx) * (p.y - my);
    den += (p.x - mx) ** 2;
  }
  return den === 0 ? null : num / den;
}
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));

export type ErrorClass = "within" | "between" | "novel";

export interface Tap {
  hex: string;
  correct: boolean;
  dtMs: number;
  side: -1 | 0 | 1;
  cls?: ErrorClass;
}

export interface RoundRecord {
  slot: number;
  copies: number;
  /** Hidden tiles when the round began (for the chance baseline). */
  pool: number;
  misses: number;
  within: number;
  between: number;
  novel: number;
  firstTapCorrect: boolean | null;
  firstTapLatencyMs: number | null;
  firstTapX: number | null;
  leftRanks: number[];
  rightRanks: number[];
  leftWithin: number;
  rightWithin: number;
  leftNovel: number;
  rightNovel: number;
  leftFirstLat: number | null;
  rightFirstLat: number | null;
  taps: Tap[];
}

export interface LevelMeta {
  level: number;
  boardId: string;
  T: number;
  K: number;
  partition: number[];
  realisedAdjacency: number;
  studySeconds: number;
  heartBudget: number;
  isProbe: boolean;
  pack: string;
  attempt: number;
}

export interface LevelRecord extends LevelMeta {
  heartsLost: number;
  completed: boolean;
  failReason: string | null;
  durationMs: number;
  score: number;
  adjPairs: number;
  totalPairs: number;
  rounds: RoundRecord[];
}

interface OpenRound extends RoundRecord {
  start: number;
  last: number;
  started: boolean;
  shownWrong: Set<string>;
}
interface OpenLevel extends LevelMeta {
  heartsLost: number;
  start: number;
  rounds: RoundRecord[];
  revealed: Set<string>;
  nmap: Record<string, string[]>;
  adjPairs: number;
  totalPairs: number;
}

interface ControlRound {
  copies: number;
  start: number;
  last: number;
  firstTapX: number | null;
  firstTapLatencyMs: number | null;
  correctSoFar: number;
  leftRanks: number[];
  rightRanks: number[];
}

export class PeekPeekMetrics {
  readonly levels: LevelRecord[] = [];
  private level: OpenLevel | null = null;
  private round: OpenRound | null = null;
  private control: { rounds: ControlRound[]; cur: ControlRound | null; completed: boolean } | null = null;
  private streak = 0;
  longestStreak = 0;
  accidentalTaps = 0;
  private packs = new Set<string>();

  // ---------------------------------------------------------------- control trial (face up: no memory load)

  startControl(copies: number, now: number) {
    this.control = { rounds: [], cur: null, completed: false };
    this.control.cur = { copies, start: now, last: now, firstTapX: null, firstTapLatencyMs: null, correctSoFar: 0, leftRanks: [], rightRanks: [] };
  }

  controlTap(correct: boolean, x: number, now: number) {
    const r = this.control?.cur;
    if (!r) return;
    const side = sideOf(x);
    if (r.firstTapX === null) {
      r.firstTapX = x;
      r.firstTapLatencyMs = now - r.start;
    }
    if (correct) {
      r.correctSoFar += 1;
      if (side < 0) r.leftRanks.push(r.correctSoFar);
      else if (side > 0) r.rightRanks.push(r.correctSoFar);
    }
    r.last = now;
  }

  endControl() {
    if (!this.control) return;
    if (this.control.cur) this.control.rounds.push(this.control.cur);
    this.control.cur = null;
    this.control.completed = true;
  }

  // ---------------------------------------------------------------- levels and rounds

  startLevel(meta: LevelMeta, nmap: Record<string, string[]>, now: number) {
    this.level = { ...meta, heartsLost: 0, start: now, rounds: [], revealed: new Set(), nmap, adjPairs: 0, totalPairs: 0 };
    this.packs.add(meta.pack);
  }

  startRound(slot: number, copies: number, pool: number, now: number) {
    this.round = {
      slot, copies, pool, misses: 0, within: 0, between: 0, novel: 0,
      firstTapCorrect: null, firstTapLatencyMs: null, firstTapX: null,
      leftRanks: [], rightRanks: [], leftWithin: 0, rightWithin: 0, leftNovel: 0, rightNovel: 0,
      leftFirstLat: null, rightFirstLat: null, taps: [],
      start: now, last: now, started: false, shownWrong: new Set(),
    };
  }

  /** One tap in a memory round. `x` is the tile's centre in −1…1 (board centre = 0). */
  tap(hex: string, correct: boolean, x: number, accidental: boolean, now: number) {
    const r = this.round;
    const L = this.level;
    if (!r || !L) return;
    const side = sideOf(x);
    const dt = now - (r.started ? r.last : r.start);
    if (accidental) {
      // Too fast after the previous tap to be deliberate: kept in the tap list, left out of the error measures.
      this.accidentalTaps += 1;
      r.taps.push({ hex, correct, dtMs: dt, side });
      r.last = now;
      return;
    }
    const prev = r.taps[r.taps.length - 1];
    if (prev) {
      L.totalPairs += 1;
      if (L.nmap[prev.hex]?.includes(hex)) L.adjPairs += 1;
    }
    if (!r.started) {
      r.started = true;
      r.firstTapCorrect = correct;
      r.firstTapLatencyMs = dt;
      r.firstTapX = x;
      if (side < 0) r.leftFirstLat = dt;
      else if (side > 0) r.rightFirstLat = dt;
    }
    if (correct) {
      L.revealed.add(hex);
      r.taps.push({ hex, correct: true, dtMs: dt, side });
      const rank = r.taps.filter((t) => t.correct).length;
      if (side < 0) r.leftRanks.push(rank);
      else if (side > 0) r.rightRanks.push(rank);
      this.streak += 1;
      this.longestStreak = Math.max(this.longestStreak, this.streak);
    } else {
      r.misses += 1;
      L.heartsLost += 1;
      // Class first, then mark as shown: within = already shown wrong for this picture; between = shown earlier in
      // the level for another picture; novel = never shown.
      const cls: ErrorClass = r.shownWrong.has(hex) ? "within" : L.revealed.has(hex) ? "between" : "novel";
      r.shownWrong.add(hex);
      L.revealed.add(hex);
      r[cls] += 1;
      if (cls === "within" && side < 0) r.leftWithin += 1;
      if (cls === "within" && side > 0) r.rightWithin += 1;
      if (cls === "novel" && side < 0) r.leftNovel += 1;
      if (cls === "novel" && side > 0) r.rightNovel += 1;
      r.taps.push({ hex, correct: false, dtMs: dt, side, cls });
      this.streak = 0;
    }
    r.last = now;
  }

  endRound() {
    if (this.round && this.level) {
      const { start: _s, last: _l, started: _st, shownWrong: _w, ...rec } = this.round;
      this.level.rounds.push(rec);
    }
    this.round = null;
  }

  /** Closes the level: cleared, failed (out of board hearts) or cut short (time up, quit). */
  endLevel(completed: boolean, failReason: string | null, score: number, now: number): LevelRecord | null {
    if (this.round) this.endRound();
    const L = this.level;
    if (!L) return null;
    const { start, revealed: _r, nmap: _n, ...meta } = L;
    const rec: LevelRecord = { ...meta, completed, failReason, durationMs: Math.max(0, now - start), score };
    this.levels.push(rec);
    this.level = null;
    return rec;
  }

  get inLevel() {
    return this.level !== null;
  }

  // ---------------------------------------------------------------- results

  summary(o: { maxLevel: number; highestLevel: number; hemisphere: string; pack: string; hiddenCount: boolean; studyOverrideS: number | null }) {
    const levels = this.levels;
    const done = levels.filter((l) => l.completed);
    const rounds = levels.flatMap((l) => l.rounds);
    const sum = (f: (r: RoundRecord) => number) => rounds.reduce((a, r) => a + f(r), 0);
    const totalErrors = sum((r) => r.misses);
    const within = sum((r) => r.within);
    const between = sum((r) => r.between);
    const novel = sum((r) => r.novel);

    const firstRoundMisses = levels.filter((l) => l.rounds.length).map((l) => l.rounds[0]!.misses);
    const frm = mean(firstRoundMisses) ?? 0;

    const fa = rounds.filter((r) => r.firstTapCorrect !== null);
    const exFinal = levels.filter((l) => l.rounds.length >= 2).flatMap((l) => l.rounds.slice(0, -1)).filter((r) => r.firstTapCorrect !== null);

    // Learning: misses relative to chance for each round's pool, sloped over the rounds of each level.
    const pts: Array<{ x: number; y: number }> = [];
    let slopeLevels = 0;
    for (const l of levels) {
      const usable = l.rounds.map((r, i) => ({ i, r, chance: expectedMisses([r.copies, r.pool - r.copies], 0) })).filter((x) => x.chance > 0);
      if (usable.length < 2) continue;
      slopeLevels += 1;
      for (const u of usable) pts.push({ x: u.i, y: u.r.misses / u.chance });
    }

    const firstLats = rounds.map((r) => r.firstTapLatencyMs).filter((v): v is number => v !== null);
    const gaps: number[] = [];
    const gapPts: Array<{ x: number; y: number }> = [];
    for (const r of rounds) r.taps.slice(1).forEach((t, i) => {
      gaps.push(t.dtMs);
      gapPts.push({ x: i, y: t.dtMs });
    });

    const adj = levels.reduce((a, l) => a + l.adjPairs, 0);
    const pairs = levels.reduce((a, l) => a + l.totalPairs, 0);
    const adjacency = pairs ? adj / pairs : null;
    const xs = rounds.map((r) => r.firstTapX).filter((v): v is number => v !== null);
    const xm = mean(xs) ?? 0;
    const consistency = xs.length ? Math.max(0, 1 - Math.sqrt(mean(xs.map((v) => (v - xm) ** 2))!) / 2) : null;
    const errs = within + between + novel;
    const perseveration = errs ? within / errs : null;
    const parts = [adjacency, consistency, perseveration === null ? null : 1 - perseveration].filter((v): v is number => v !== null);

    const probes = levels.filter((l) => l.isProbe);
    const lat = laterality(probes.flatMap((l) => l.rounds));
    const ctl = this.control?.completed ? controlLaterality(this.control.rounds) : null;
    const capacity = done.filter((l) => l.rounds.reduce((a, r) => a + r.misses, 0) <= 1).reduce((m, l) => Math.max(m, l.level), 0);

    return {
      levels_completed: done.length,
      highest_level: o.highestLevel,
      best_streak: this.longestStreak,
      pack: o.pack,
      packs_used: [...this.packs],
      hemisphere: o.hemisphere,
      hidden_count: o.hiddenCount ? 1 : 0,
      study_time_override_s: o.studyOverrideS,

      first_round_misses_mean: r3(frm),
      total_errors: totalErrors,
      total_errors_adjusted: r3(totalErrors + frm * Math.max(0, o.maxLevel - o.highestLevel)),
      first_attempt_accuracy: fa.length ? r3(fa.filter((r) => r.firstTapCorrect).length / fa.length) : null,
      first_attempt_accuracy_ex_final: exFinal.length ? r3(exFinal.filter((r) => r.firstTapCorrect).length / exFinal.length) : null,
      learning_slope: r3(slope(pts)),
      learning_slope_levels: slopeLevels,
      capacity_estimate: capacity,

      within_search_errors: within,
      between_search_errors: between,
      novel_hex_errors: novel,
      perseveration_rate: r3(perseveration),

      avg_first_tap_latency_ms: r0(mean(firstLats)),
      median_first_tap_latency_ms: r0(median(firstLats)),
      avg_inter_tap_interval_ms: r0(mean(gaps)),
      inter_tap_slope_ms: r0(slope(gapPts)),

      adjacency_ratio: r3(adjacency),
      scan_start_consistency: r3(consistency),
      search_organisation: r3(mean(parts)),

      find_order_index: lat.findOrderIndex,
      mean_first_tap_x: lat.meanFirstTapX,
      first_tap_latency_asymmetry_ms: lat.firstTapLatencyAsym,
      perseveration_asymmetry: lat.perseverationAsym,
      novel_error_asymmetry: lat.novelErrorAsym,
      probe_levels_used: probes.map((l) => l.level),
      probe_count: probes.length,

      control_trial_completed: this.control?.completed ? 1 : 0,
      control_find_order_index: ctl?.findOrderIndex ?? null,
      control_mean_first_tap_x: ctl?.meanFirstTapX ?? null,
      control_first_tap_latency_asymmetry_ms: ctl?.firstTapLatencyAsym ?? null,

      suspected_accidental_taps: this.accidentalTaps,
      floor_flag: levels.some((l) => !l.completed && l.failReason === "hearts" && l.level <= 2) ? 1 : 0,
      ceiling_flag: o.highestLevel >= o.maxLevel && totalErrors === 0 && levels.length > 0 ? 1 : 0,
      budget_model: "lambda2.5_expected_miss (not pilot-fitted)",
      art_status: "placeholder (drawn in code; commissioned art pending)",
    };
  }
}

const sideOf = (x: number): -1 | 0 | 1 => (x < 0 ? -1 : x > 0 ? 1 : 0);

/** Positive = copies on the right were found earlier (a rightward lean). */
function findOrder(left: number[], right: number[]): number | null {
  if (!left.length && !right.length) return null;
  return ((mean(left) ?? 0) - (mean(right) ?? 0)) / (left.length + right.length);
}

function laterality(rounds: RoundRecord[]) {
  if (!rounds.length) return { findOrderIndex: null, meanFirstTapX: null, firstTapLatencyAsym: null, perseverationAsym: null, novelErrorAsym: null };
  const foi = rounds.map((r) => findOrder(r.leftRanks, r.rightRanks)).filter((v): v is number => v !== null);
  const xs = rounds.map((r) => r.firstTapX).filter((v): v is number => v !== null);
  const lLat = rounds.filter((r) => (r.firstTapX ?? 0) < 0 && r.leftFirstLat !== null).map((r) => r.leftFirstLat!);
  const rLat = rounds.filter((r) => (r.firstTapX ?? 0) > 0 && r.rightFirstLat !== null).map((r) => r.rightFirstLat!);
  const lw = rounds.reduce((a, r) => a + r.leftWithin, 0);
  const rw = rounds.reduce((a, r) => a + r.rightWithin, 0);
  const ln = rounds.reduce((a, r) => a + r.leftNovel, 0);
  const rn = rounds.reduce((a, r) => a + r.rightNovel, 0);
  return {
    findOrderIndex: r3(mean(foi)),
    meanFirstTapX: r3(mean(xs)),
    firstTapLatencyAsym: lLat.length && rLat.length ? r0(mean(lLat)! - mean(rLat)!) : null,
    perseverationAsym: r3((lw - rw) / (lw + rw || 1)),
    novelErrorAsym: r3((ln - rn) / (ln + rn || 1)),
  };
}

function controlLaterality(rounds: ControlRound[]) {
  if (!rounds.length) return null;
  const foi = rounds.map((r) => findOrder(r.leftRanks, r.rightRanks)).filter((v): v is number => v !== null);
  const xs = rounds.map((r) => r.firstTapX).filter((v): v is number => v !== null);
  const lLat = rounds.filter((r) => (r.firstTapX ?? 0) < 0).map((r) => r.firstTapLatencyMs!);
  const rLat = rounds.filter((r) => (r.firstTapX ?? 0) > 0).map((r) => r.firstTapLatencyMs!);
  return {
    findOrderIndex: r3(mean(foi)),
    meanFirstTapX: r3(mean(xs)),
    firstTapLatencyAsym: lLat.length && rLat.length ? r0(mean(lLat)! - mean(rLat)!) : null,
  };
}
