/**
 * Block Crasher layouts and difficulty (design doc §8.4, ADR 0017). Pure: no clock, no I/O.
 *
 * The ten layouts are v1's (`src/lib/blockCrasherLevels.js`): 0 = empty, 1 = normal brick, 2 = tough brick.
 * v1 stored a ball speed and paddle width per level but never applied them; v2 does. The difficulty sets the
 * start level and the speed and paddle at that level (§8.4 table); each later level adds v1's own step.
 */

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type Cell = 0 | 1 | 2;

export interface Layout {
  id: string;
  /** v1's ball speed (px per 60 Hz frame on the 800 × 600 board) and paddle width (px). */
  speed: number;
  paddle: number;
  pattern: Cell[][];
}

export const LAYOUTS: Layout[] = [
  { id: "sunrise", speed: 3.5, paddle: 130, pattern: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1], [1, 1, 1, 1, 1, 1, 1, 1, 1, 1]] },
  {
    id: "stepping_stones",
    speed: 4.0,
    paddle: 120,
    pattern: [
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: "pyramid",
    speed: 4.5,
    paddle: 120,
    pattern: [
      [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 1, 1, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    ],
  },
  {
    id: "diamond",
    speed: 4.5,
    paddle: 110,
    pattern: [
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 1, 1, 1, 1, 1, 1, 0, 0],
      [0, 0, 0, 1, 1, 1, 1, 0, 0, 0],
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
    ],
  },
  {
    id: "butterfly",
    speed: 5.0,
    paddle: 110,
    pattern: [
      [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
      [1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
      [0, 1, 1, 2, 0, 0, 2, 1, 1, 0],
      [0, 0, 1, 2, 2, 2, 2, 1, 0, 0],
      [0, 0, 0, 1, 2, 2, 1, 0, 0, 0],
      [0, 0, 1, 2, 2, 2, 2, 1, 0, 0],
      [0, 1, 1, 2, 0, 0, 2, 1, 1, 0],
      [1, 1, 1, 0, 0, 0, 0, 1, 1, 1],
      [1, 1, 0, 0, 0, 0, 0, 0, 1, 1],
    ],
  },
  {
    id: "checkerboard",
    speed: 5.0,
    paddle: 100,
    pattern: [
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [0, 1, 0, 1, 0, 1, 0, 1, 0, 1],
    ],
  },
  {
    id: "pillars",
    speed: 5.5,
    paddle: 100,
    pattern: [
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
      [1, 0, 1, 0, 1, 0, 1, 0, 1, 0],
    ],
  },
  {
    id: "crossroads",
    speed: 5.5,
    paddle: 90,
    pattern: [
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
      [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [0, 0, 0, 0, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 0, 2, 2, 0, 0, 0, 0],
    ],
  },
  {
    id: "castle",
    speed: 6.0,
    paddle: 90,
    pattern: [
      [2, 0, 2, 0, 2, 0, 2, 0, 2, 0],
      [2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [2, 1, 2, 1, 2, 1, 2, 1, 2, 1],
    ],
  },
  {
    id: "ultimate_maze",
    speed: 6.5,
    paddle: 80,
    pattern: [
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
      [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [2, 1, 1, 1, 1, 1, 1, 1, 1, 2],
      [2, 2, 2, 2, 2, 2, 2, 2, 2, 2],
    ],
  },
];

export const MAX_LEVEL = LAYOUTS.length;

/** Practice: one row, difficulty-1 speed and paddle, no specials, unlimited balls (§8.4). */
export const PRACTICE_LAYOUT: Layout = { id: "practice", speed: 3.5, paddle: 130, pattern: [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1]] };
export const PRACTICE_S = 30;

export type SpecialKind = "exploding" | "slow_down" | "rocket" | "paddle_thin" | "paddle_wide" | "multi_ball" | "invisible" | "gravity";
export const SPECIALS: SpecialKind[] = ["exploding", "slow_down", "rocket", "paddle_thin", "paddle_wide", "multi_ball", "invisible", "gravity"];
/** v1's pairs, one per level in a cycle of five; the fifth level of each cycle draws two at random. */
const PAIRS: [SpecialKind, SpecialKind][] = [
  ["exploding", "slow_down"],
  ["rocket", "paddle_thin"],
  ["paddle_wide", "multi_ball"],
  ["invisible", "gravity"],
];

export interface DifficultyRow {
  startLevel: number;
  speed: number;
  paddle: number;
  /** Share of bricks that are special, and whether they come in v1's pairs or from all eight. */
  specialRate: number;
  specialSet: "none" | "pairs" | "all";
}

/** The §8.4 table. */
export const DIFFICULTY: Record<Difficulty, DifficultyRow> = {
  1: { startLevel: 1, speed: 3.5, paddle: 130, specialRate: 0, specialSet: "none" },
  2: { startLevel: 4, speed: 4.0, paddle: 120, specialRate: 0.08, specialSet: "pairs" },
  3: { startLevel: 6, speed: 4.5, paddle: 110, specialRate: 0.12, specialSet: "pairs" },
  4: { startLevel: 8, speed: 5.25, paddle: 100, specialRate: 0.15, specialSet: "all" },
  5: { startLevel: 10, speed: 6.0, paddle: 90, specialRate: 0.2, specialSet: "all" },
};

export const MIN_PADDLE = 70;
export const MAX_SPEED = 7.5;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Ball speed (px per 60 Hz frame) and paddle width for a level, from the difficulty's start values plus v1's per-level steps. */
export function tuning(d: Difficulty, level: number, startLevel: number) {
  const row = DIFFICULTY[d];
  const at = LAYOUTS[clamp(level, 1, MAX_LEVEL) - 1]!;
  const base = LAYOUTS[clamp(startLevel, 1, MAX_LEVEL) - 1]!;
  return {
    speed: clamp(row.speed + (at.speed - base.speed), 2, MAX_SPEED),
    paddle: clamp(row.paddle + (at.paddle - base.paddle), MIN_PADDLE, 160),
  };
}

/** Which specials a level may use (v1's cycle), drawn with the session's seeded rng for the fifth level. */
export function specialKinds(d: Difficulty, level: number, rng: () => number): SpecialKind[] {
  const set = DIFFICULTY[d].specialSet;
  if (set === "none") return [];
  if (set === "all" || level >= MAX_LEVEL) return [...SPECIALS];
  const cycle = (level - 1) % 5;
  if (cycle < 4) return [...PAIRS[cycle]!];
  const pool = [...SPECIALS];
  const a = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
  const b = pool.splice(Math.floor(rng() * pool.length), 1)[0]!;
  return [a, b];
}
