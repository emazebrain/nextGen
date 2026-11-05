import { describe, expect, it } from "vitest";
import { apply, bestMove, blockersToExit, isGoal, moves, slideRange, solve, distance, type Board } from "../src/board.ts";
import { BeepEngine, type EngineConfig } from "../src/engine.ts";
import { awardFor, boardFor, bucket, budgetFor, decodePack, DEPTH_RANGE, gridFor, MAX_LEVEL, PACK_CAP, START_LEVEL, targetDepth, type Difficulty } from "../src/levels.ts";
import raw from "../src/pack.json";

const pack = decodePack(raw as never);

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A tiny hand-made board: hero at the left of row 1, one upright car in the way. */
const tiny: Board = {
  id: "tiny",
  n: 4,
  exitRow: 1,
  pieces: [
    { fixed: 1, len: 2, horiz: true },
    { fixed: 3, len: 2, horiz: false },
  ],
  walls: [],
  start: [0, 0],
  optimal: 2,
};

describe("board solver", () => {
  it("slides pieces along their own axis up to the first obstacle", () => {
    expect(slideRange(tiny, tiny.start, 0)).toEqual({ min: 0, max: 1 }); // blocked by the car at column 3
    expect(slideRange(tiny, tiny.start, 1)).toEqual({ min: 0, max: 2 });
    expect(moves(tiny, tiny.start)).toHaveLength(3);
  });

  it("finds the exact shortest solution and the first move of one", () => {
    const sol = solve(tiny)!;
    expect(distance(sol, tiny.start)).toBe(2);
    const m = bestMove(tiny, sol, tiny.start)!;
    expect(m.idx).toBe(1);
    expect(m.to).toBe(2); // the car drops below the exit row
    expect(isGoal(tiny, apply(apply(tiny.start, m), { idx: 0, from: 0, to: 2 }))).toBe(true);
    expect([...blockersToExit(tiny, tiny.start)]).toEqual([1]);
  });
});

describe("the generated pack", () => {
  it("is well formed: the hero is the only horizontal piece on the exit row and nothing overlaps", () => {
    const ids = new Set<string>();
    for (const b of pack) {
      expect(ids.has(b.id)).toBe(false);
      ids.add(b.id);
      expect(b.pieces[0]).toMatchObject({ fixed: b.exitRow, len: 2, horiz: true });
      expect(b.pieces.slice(1).some((p) => p.horiz && p.fixed === b.exitRow)).toBe(false);
      const occ = new Set<number>();
      for (const [r, c] of b.walls) occ.add(r * b.n + c);
      b.pieces.forEach((p, i) => {
        for (let k = 0; k < p.len; k++) {
          const cell = p.horiz ? p.fixed * b.n + b.start[i]! + k : (b.start[i]! + k) * b.n + p.fixed;
          expect(occ.has(cell)).toBe(false);
          occ.add(cell);
        }
      });
    }
  });

  it("states every board's shortest solution exactly, within the size the game solves on a tablet", () => {
    for (const b of pack) {
      const sol = solve(b, PACK_CAP);
      expect(sol, b.id).not.toBeNull();
      expect(distance(sol, b.start), b.id).toBe(b.optimal);
    }
  }, 120_000);

  it("has at least 3 boards for every level's target at every difficulty, so a failure always gets a fresh board", () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      for (const d of [1, 2, 3, 4, 5] as Difficulty[]) {
        const n = gridFor(level);
        const t = targetDepth(level, d);
        const [lo, hi] = DEPTH_RANGE[n]!;
        expect(t).toBeGreaterThanOrEqual(lo);
        expect(t).toBeLessThanOrEqual(hi);
        const list = bucket(pack, n, t);
        expect(list.every((b) => b.optimal === t && b.n === n)).toBe(true);
        expect(list.length).toBeGreaterThanOrEqual(3);
      }
    }
  });

  it("gets no easier as the levels go up within a grid size", () => {
    for (const d of [1, 3, 5] as Difficulty[]) {
      for (let level = 2; level <= MAX_LEVEL; level++) {
        if (gridFor(level) !== gridFor(level - 1)) continue;
        expect(targetDepth(level, d)).toBeGreaterThanOrEqual(targetDepth(level - 1, d));
      }
    }
  });
});

describe("levels, budget and score (v1 formulas)", () => {
  it("sets the move budget to max(optimal + 2, ⌈optimal × factor⌉)", () => {
    expect(budgetFor(2, 1)).toBe(6);
    expect(budgetFor(10, 3)).toBe(25);
    expect(budgetFor(1, 5)).toBe(3);
    expect(budgetFor(12, 5)).toBe(24);
  });

  it("scores like v1", () => {
    expect(awardFor(4, 3, 10, 0, 3, 3)).toBe(Math.round(100 * (16 / 12) * 1.4 * (1.8 - 10 / 45) * 1 * 1));
    expect(awardFor(7, 5, 120, 20, 10, 20)).toBe(Math.round(100 * (49 / 12) * 2.0 * 1.0 * 1.5 * (0.45 + 0.55 * 0.5)));
  });

  it("starts each difficulty where §8.4 says, and uses 4×4 to 7×7 grids by level", () => {
    expect(START_LEVEL).toEqual({ 1: 1, 2: 6, 3: 11, 4: 23, 5: 39 });
    expect([1, 10, 11, 22, 23, 38, 39, 50].map(gridFor)).toEqual([4, 4, 5, 5, 6, 6, 7, 7]);
  });
});

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({ pack, difficulty: 3, startLevel: 1, maxLevel: 50, enforceBudget: true, rng: mulberry32(3), ...extra });

/** Plays the current board perfectly with the solver's moves. */
function solveBoard(e: BeepEngine, now = 0) {
  let guard = 0;
  while (!e.solved && guard++ < 100) {
    const m = e.bestMove()!;
    e.move(m.idx, m.to, (now += 500));
  }
  return now;
}

describe("engine", () => {
  it("clears a board in exactly its optimal number of moves, scores it and moves to the next level", () => {
    const e = new BeepEngine(cfg());
    const b = e.startLevel(0);
    solveBoard(e);
    expect(e.solved).toBe(true);
    expect(e.moveCount).toBe(b.optimal);
    expect(e.score).toBeGreaterThan(0);
    expect(e.metrics.boards.at(-1)).toMatchObject({ completed: true, movesUsed: b.optimal });
    expect(e.nextLevel(10_000)).not.toBeNull();
    expect(e.level).toBe(2);
  });

  it("fails a board at the move budget in lives modes and replaces it with a fresh board of the same size and depth", () => {
    const e = new BeepEngine(cfg({ startLevel: 15 }));
    const b = e.startLevel(0);
    let r;
    for (let i = 0; i < 200 && !e.failed; i++) {
      // Shuffle one piece back and forth: never solves.
      const m = e.range(1);
      const to = e.state[1] === m.min ? m.max : m.min;
      r = to === e.state[1] ? null : e.move(1, to, i * 100);
      if (!r) {
        const any = [...Array(b.pieces.length).keys()].find((i2) => i2 > 0 && e.range(i2).max !== e.range(i2).min)!;
        const rr = e.range(any);
        e.move(any, e.state[any] === rr.min ? rr.max : rr.min, i * 100);
      }
    }
    expect(e.failed).toBe(true);
    expect(e.moveCount).toBe(e.budget);
    expect(e.metrics.boards.at(-1)).toMatchObject({ completed: false, failReason: "budget" });
    const rep = e.replacement(30_000);
    expect(rep.id).not.toBe(b.id);
    expect(rep.n).toBe(b.n);
    expect(rep.optimal).toBe(b.optimal);
    expect(e.metrics.current).toMatchObject({ replacement: true, optimal: rep.optimal });
  });

  it("never fails on the budget in timed mode", () => {
    const e = new BeepEngine(cfg({ enforceBudget: false }));
    e.startLevel(0);
    for (let i = 0; i < 60; i++) {
      const idx = [...Array(e.board.pieces.length).keys()].find((k) => k > 0 && e.range(k).max !== e.range(k).min);
      if (idx === undefined) break;
      const rr = e.range(idx);
      e.move(idx, e.state[idx] === rr.min ? rr.max : rr.min, i);
    }
    expect(e.failed).toBe(false);
  });

  it("undoes, redoes and resets; a reset keeps the moves made in the move-quality measures", () => {
    const e = new BeepEngine(cfg());
    e.startLevel(0);
    const m = e.bestMove()!;
    e.move(m.idx, m.to, 100);
    expect(e.undo(200)).toBe(true);
    expect(e.state).toEqual(e.board.start);
    expect(e.redo(300).kind).toBe("moved");
    expect(e.state[m.idx]).toBe(m.to);
    expect(e.reset(400)).toBe(true);
    expect(e.moveCount).toBe(0);
    expect(e.metrics.current!.moves.length).toBe(2);
    expect(e.metrics.current!.resets).toBe(1);
  });

  it("climbs the hint ladder and makes the move on the fourth step", () => {
    const e = new BeepEngine(cfg());
    e.startLevel(0);
    const best = e.bestMove()!;
    expect(e.hint(0).rung).toBe(1);
    expect(e.hint(0).move).toEqual(best);
    expect(e.hint(0).rung).toBe(3);
    const h4 = e.hint(0);
    expect(h4.rung).toBe(4);
    expect(e.state[best.idx]).toBe(best.to);
    expect(e.metrics.current!.hints).toBe(4);
    // Hint moves don't count as the child's own planning.
    expect(e.metrics.summary().total_moves).toBe(0);
  });

  it("is deterministic for a seed", () => {
    const pick = () => {
      const e = new BeepEngine(cfg({ rng: mulberry32(42), startLevel: 30 }));
      return e.startLevel(0).id;
    };
    expect(pick()).toBe(pick());
    expect(boardFor(pack, 30, 3, mulberry32(42), new Set()).n).toBe(6);
  });
});

describe("metrics", () => {
  it("summarises planning efficiency, move quality and streaks", () => {
    const e = new BeepEngine(cfg());
    e.startLevel(0);
    let t = solveBoard(e, 0);
    e.nextLevel(t);
    t = solveBoard(e, t + 1000);
    const s = e.metrics.summary();
    expect(s.boards_cleared).toBe(2);
    expect(s.planning_efficiency).toBe(1);
    expect(s.optimal_move_rate).toBe(1);
    expect(s.regressive_move_rate).toBe(0);
    expect(s.best_streak).toBe(2);
    expect(s.longest_plan_run).toBeGreaterThan(0);
  });
});
