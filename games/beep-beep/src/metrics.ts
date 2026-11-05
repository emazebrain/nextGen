/**
 * Beep Beep measures (design doc §8.4 "Game metrics"), ported from v1 `metrics.js`. Pure: one record per board
 * attempt, the summary built from the records.
 *
 * Fixed from v1 (ADR 0015):
 * - Each attempt (including a replacement board after a failure) is its own record with its own shortest
 *   solution and budget.
 * - Move quality (optimal / regressive rates) counts every move made, on failed boards too and before a reset;
 *   v1 counted only cleared boards and forgot moves made before a reset.
 * - First-move latency is from when the board appeared, not from the last reset.
 */
import type { Board, MoveClass } from "./board.ts";

export interface MoveRecord {
  idx: number;
  from: number;
  to: number;
  cls: MoveClass;
  t: number;
  /** Time since the previous move (or since the board appeared). */
  gap: number;
  reversal: boolean;
  viaHint: boolean;
}

export interface BoardRecord {
  level: number;
  boardId: string;
  grid: number;
  optimal: number;
  budget: number;
  replacement: boolean;
  start: number;
  end: number;
  completed: boolean;
  failReason: "budget" | "time" | "ended" | null;
  score: number;
  /** Moves on the board when it ended (what the budget counts). */
  movesUsed: number;
  moves: MoveRecord[];
  firstMoveMs: number | null;
  undos: number;
  redos: number;
  resets: number;
  hints: number;
  maxHintRung: number;
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

export class BeepMetrics {
  readonly boards: BoardRecord[] = [];
  blockedDrags = 0;
  wrongAxisDrags = 0;
  heroTouches = 0;
  touches = 0;
  private cur: BoardRecord | null = null;

  get current() {
    return this.cur;
  }

  startBoard(o: { level: number; board: Board; budget: number; replacement: boolean; now: number }) {
    if (this.cur) this.endBoard({ completed: false, failReason: "ended", score: 0, movesUsed: this.cur.movesUsed, now: o.now });
    this.cur = {
      level: o.level, boardId: o.board.id, grid: o.board.n, optimal: o.board.optimal, budget: o.budget, replacement: o.replacement,
      start: o.now, end: o.now, completed: false, failReason: null, score: 0, movesUsed: 0, moves: [], firstMoveMs: null,
      undos: 0, redos: 0, resets: 0, hints: 0, maxHintRung: 0,
    };
  }

  move(m: { idx: number; from: number; to: number; cls: MoveClass; now: number; viaHint: boolean }) {
    const c = this.cur;
    if (!c) return;
    const prev = c.moves[c.moves.length - 1];
    if (c.firstMoveMs === null) c.firstMoveMs = m.now - c.start;
    const reversal = !!prev && prev.idx === m.idx && prev.from === m.to && prev.to === m.from;
    c.moves.push({ idx: m.idx, from: m.from, to: m.to, cls: m.cls, t: m.now, gap: m.now - (prev?.t ?? c.start), reversal, viaHint: m.viaHint });
    c.movesUsed += 1;
  }

  undo(_now: number) {
    if (!this.cur) return;
    this.cur.undos += 1;
    this.cur.movesUsed = Math.max(0, this.cur.movesUsed - 1);
  }
  redo() {
    if (this.cur) this.cur.redos += 1;
  }
  reset(_now: number) {
    if (!this.cur) return;
    this.cur.resets += 1;
    this.cur.movesUsed = 0;
  }
  hint(rung: number) {
    if (!this.cur) return;
    this.cur.hints += 1;
    this.cur.maxHintRung = Math.max(this.cur.maxHintRung, rung);
  }
  touch(hero: boolean) {
    this.touches += 1;
    if (hero) this.heroTouches += 1;
  }

  endBoard(o: { completed: boolean; failReason: BoardRecord["failReason"]; score: number; movesUsed: number; now: number }): BoardRecord | null {
    const c = this.cur;
    if (!c) return null;
    c.completed = o.completed;
    c.failReason = o.completed ? null : o.failReason;
    c.score = o.score;
    c.movesUsed = o.movesUsed;
    c.end = o.now;
    this.boards.push(c);
    this.cur = null;
    return c;
  }

  summary() {
    const all = this.boards;
    const done = all.filter((b) => b.completed);
    const moves = all.flatMap((b) => b.moves.filter((m) => !m.viaHint));
    const classified = moves.filter((m) => m.cls !== "unknown");
    const share = (c: MoveClass) => (classified.length ? classified.filter((m) => m.cls === c).length / classified.length : null);
    const eff = done.map((b) => b.optimal / Math.max(b.optimal, b.movesUsed));
    let longest = 0;
    for (const b of all) {
      let run = 0;
      for (const m of b.moves) {
        run = m.cls === "progressive" && !m.viaHint ? run + 1 : 0;
        longest = Math.max(longest, run);
      }
    }
    const byGrid: Record<string, number> = {};
    for (const n of [4, 5, 6, 7]) {
      const e = done.filter((b) => b.grid === n).map((b) => b.optimal / Math.max(b.optimal, b.movesUsed));
      if (e.length) byGrid[`${n}x${n}`] = r3(mean(e))!;
    }
    const firsts = all.map((b) => b.firstMoveMs).filter((v): v is number => v !== null);
    const gaps = moves.map((m) => m.gap);
    const doneSecs = done.map((b) => (b.end - b.start) / 1000);
    let best = 0;
    let cur = 0;
    for (const b of all) {
      cur = b.completed ? cur + 1 : 0;
      best = Math.max(best, cur);
    }
    return {
      boards_attempted: all.length,
      boards_cleared: done.length,
      level_accuracy: all.length ? r3(done.length / all.length) : null,
      planning_efficiency: r3(mean(eff)),
      best_planning_efficiency: eff.length ? r3(Math.max(...eff)) : null,
      planning_efficiency_by_grid: byGrid,
      optimal_move_rate: r3(share("progressive")),
      neutral_move_rate: r3(share("neutral")),
      regressive_move_rate: r3(share("regressive")),
      longest_plan_run: longest,
      first_move_latency_ms: r0(median(firsts)),
      avg_seconds_per_move: gaps.length ? Math.round((mean(gaps)! / 1000) * 10) / 10 : null,
      avg_board_seconds: doneSecs.length ? Math.round(mean(doneSecs)! * 10) / 10 : null,
      reversal_rate: moves.length ? r3(moves.filter((m) => m.reversal).length / moves.length) : null,
      total_moves: moves.length,
      hints_used: all.reduce((a, b) => a + b.hints, 0),
      undos: all.reduce((a, b) => a + b.undos, 0),
      resets: all.reduce((a, b) => a + b.resets, 0),
      budget_failures: all.filter((b) => b.failReason === "budget").length,
      time_failures: all.filter((b) => b.failReason === "time").length,
      deepest_solved: done.length ? Math.max(...done.map((b) => b.optimal)) : null,
      highest_grid: all.length ? Math.max(...all.map((b) => b.grid)) : null,
      blocked_drags: this.blockedDrags,
      wrong_axis_drags: this.wrongAxisDrags,
      hero_touch_rate: this.touches ? r3(this.heroTouches / this.touches) : null,
      best_streak: best,
    };
  }
}
