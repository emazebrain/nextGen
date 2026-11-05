/**
 * Beep Beep progression, budget and scoring (design doc §8.4), ported from v1 `config.js`. Pure data and
 * formulas; the boards themselves are in pack.json (scripts/generate-pack.ts).
 */
import type { Board } from "./board.ts";

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export const MAX_LEVEL = 50;
/** Largest reachable state space a shipped board may have, so the game can solve it on a tablet in a blink. */
export const PACK_CAP = 30_000;

/** Grid size by level (v1): 4×4 for levels 1–10, 5×5 for 11–22, 6×6 for 23–38, 7×7 for 39–50. */
export function gridFor(level: number): number {
  return level <= 10 ? 4 : level <= 22 ? 5 : level <= 38 ? 6 : 7;
}

/** Shortest-solution range the pack covers for each grid size. */
export const DEPTH_RANGE: Record<number, [number, number]> = { 4: [2, 5], 5: [3, 11], 6: [6, 15], 7: [9, 18] };

/**
 * Target shortest solution for each level (v1's pack was hand-graded; v2 states it). It rises through each
 * grid band; a new, larger grid steps back a little so the bigger board is the new challenge.
 */
const TARGET: Record<number, number[]> = {
  4: [2, 2, 3, 3, 3, 4, 4, 4, 5, 5],
  5: [4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10],
  6: [7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13, 14, 15],
  7: [10, 11, 11, 12, 12, 13, 14, 14, 15, 16, 17, 18],
};
const FIRST_LEVEL: Record<number, number> = { 4: 1, 5: 11, 6: 23, 7: 39 };
/** Difficulty nudges the target: easier boards at 1, harder at 4 and 5. */
const DEPTH_OFFSET: Record<Difficulty, number> = { 1: -1, 2: 0, 3: 0, 4: 1, 5: 1 };

export function targetDepth(level: number, difficulty: Difficulty): number {
  const n = gridFor(level);
  const [lo, hi] = DEPTH_RANGE[n]!;
  const t = TARGET[n]![level - FIRST_LEVEL[n]!]! + DEPTH_OFFSET[difficulty];
  return Math.max(lo, Math.min(hi, t));
}

/** Start level when the step doesn't set one (§8.4 [Assumption]). */
export const START_LEVEL: Record<Difficulty, number> = { 1: 1, 2: 6, 3: 11, 4: 23, 5: 39 };
/** Seconds without a move before the hint highlights the blockers; 0 = off (§8.4). */
export const IDLE_HINT_S: Record<Difficulty, number> = { 1: 20, 2: 30, 3: 45, 4: 0, 5: 0 };

export const BUDGET_FACTOR: Record<Difficulty, number> = { 1: 3.0, 2: 2.75, 3: 2.5, 4: 2.25, 5: 2.0 };
export const SCORE_MULT: Record<Difficulty, number> = { 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.7, 5: 2.0 };

/** Moves allowed on a board: max(optimal + 2, ⌈optimal × factor⌉) (§8.4). */
export function budgetFor(optimal: number, d: Difficulty): number {
  return Math.max(optimal + 2, Math.ceil(optimal * BUDGET_FACTOR[d]));
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Points for a cleared board (v1): grid size × difficulty × speed × streak × efficiency. */
export function awardFor(n: number, d: Difficulty, seconds: number, streak: number, optimal: number, moves: number): number {
  const tile = (n * n) / 12;
  const speed = clamp(1.8 - seconds / 45, 1.0, 1.8);
  const streakM = 1 + Math.min(streak, 10) * 0.05;
  const eff = 0.45 + 0.55 * (optimal / Math.max(optimal, moves));
  return Math.round(100 * tile * SCORE_MULT[d] * speed * streakM * eff);
}

// ---------------------------------------------------------------- the pack

type RawBoard = Omit<Board, "pieces"> & { pieces: Array<[number, number, number]> };

export function decodePack(raw: RawBoard[]): Board[] {
  return raw.map((b) => ({ ...b, pieces: b.pieces.map(([fixed, len, h]) => ({ fixed, len, horiz: h === 1 })) }));
}

/** Boards of one grid size and depth, nearest depth if that bucket is empty. */
export function bucket(pack: Board[], n: number, depth: number): Board[] {
  for (let off = 0; off <= 6; off++) {
    for (const d of off === 0 ? [depth] : [depth - off, depth + off]) {
      const list = pack.filter((b) => b.n === n && b.optimal === d);
      if (list.length) return list;
    }
  }
  return pack.filter((b) => b.n === n);
}

/** The board for a level: chosen from its bucket by the session's seed, skipping boards already seen. */
export function boardFor(pack: Board[], level: number, d: Difficulty, rng: () => number, seen: Set<string>): Board {
  const list = bucket(pack, gridFor(level), targetDepth(level, d));
  const fresh = list.filter((b) => !seen.has(b.id));
  const from = fresh.length ? fresh : list;
  return from[Math.floor(rng() * from.length)]!;
}
