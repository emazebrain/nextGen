/**
 * Peek Peek: progression, budgets and scoring (design doc §8.4), ported from
 * v1 `src/lib/peekPeek/config.js`. Pure: no clock, no I/O, no randomness.
 *
 * Heart budgets come from the λ = 2.5 expected-miss model in closed form, not
 * from pilot data. The results flag this (`budget_model`) until the model is
 * re-fitted, so no normative claim rests on it.
 */

export const MAX_LEVEL = 50;
export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const DIFFICULTY_MULT: Record<Difficulty, number> = { 1: 1.0, 2: 1.2, 3: 1.4, 4: 1.7, 5: 2.0 };
/** Picture multiplier G(d): how many distinct pictures a board uses. */
export const G: Record<Difficulty, number> = { 1: 0.78, 2: 0.89, 3: 1.0, 4: 1.13, 5: 1.28 };
/** How much the copy counts are skewed from small to large groups. */
export const SKEW: Record<Difficulty, number> = { 1: 0.0, 2: 0.05, 3: 0.18, 4: 0.38, 5: 0.6 };
export const SLACK: Record<Difficulty, number> = { 1: 4.0, 2: 3.25, 3: 2.5, 4: 2.0, 5: 1.5 };
/** Pictures with a single copy, on boards of 20 tiles or more. */
export const SINGLETONS: Record<Difficulty, number> = { 1: 0, 2: 0, 3: 0, 4: 1, 5: 2 };
/** Clustering ρ: 0.8 keeps copies of a picture together, 0 spreads them apart. */
export const RHO: Record<Difficulty, number> = { 1: 0.8, 2: 0.55, 3: 0.32, 4: 0.12, 5: 0.0 };
/** Relief levels: one fewer picture and half a second more to study. */
export const RELIEF = new Set([6, 10, 14, 18, 22, 26, 30, 34, 38, 42, 47]);
/** Probe levels: mirror-symmetric boards with even placement, used for the left/right measures. */
export const PROBE_LEVELS = new Set([4, 13, 17, 21, 25, 33, 41, 45]);

export type BoardFamily = "interlock" | "brick";
export interface BoardShape {
  T: number;
  rows: number[];
  family: BoardFamily;
}

/** The 12 board shapes. Tiles grow 7 → 35 across 50 levels, 4 levels per shape (the last shape takes the rest). */
export const BOARDS: BoardShape[] = [
  { T: 7, rows: [2, 3, 2], family: "interlock" },
  { T: 9, rows: [3, 3, 3], family: "brick" },
  { T: 12, rows: [3, 3, 3, 3], family: "brick" },
  { T: 14, rows: [2, 3, 4, 3, 2], family: "interlock" },
  { T: 17, rows: [3, 4, 3, 4, 3], family: "interlock" },
  { T: 19, rows: [3, 4, 5, 4, 3], family: "interlock" },
  { T: 22, rows: [4, 5, 4, 5, 4], family: "interlock" },
  { T: 25, rows: [5, 5, 5, 5, 5], family: "brick" },
  { T: 27, rows: [4, 5, 4, 5, 4, 5], family: "interlock" },
  { T: 30, rows: [5, 5, 5, 5, 5, 5], family: "brick" },
  { T: 32, rows: [5, 4, 5, 4, 5, 4, 5], family: "interlock" },
  { T: 35, rows: [5, 5, 5, 5, 5, 5, 5], family: "brick" },
];

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const roundHalf = (n: number) => Math.round(n * 2) / 2;
export const isRelief = (level: number) => RELIEF.has(level);

export function boardForLevel(level: number): BoardShape {
  return BOARDS[clamp(Math.floor((level - 1) / 4), 0, BOARDS.length - 1)]!;
}

export function singletonsFor(d: Difficulty, T: number): number {
  return T >= 20 ? SINGLETONS[d] : 0;
}

/**
 * Study seconds: max(3.0, round½(1.6 + 0.225·T)), plus 0.5 on relief levels.
 * (v1 computed this but then always used 3 s; v2 uses the formula, ADR 0012.)
 */
export function studySeconds(level: number): number {
  const b = boardForLevel(level);
  let s = Math.max(3.0, roundHalf(1.6 + 0.225 * b.T));
  if (isRelief(level)) s += 0.5;
  return s;
}

/** Distinct pictures K for a level and difficulty, capped by the pack size and the board. */
export function kForLevel(level: number, d: Difficulty, packSize: number): number {
  const b = boardForLevel(level);
  const sing = singletonsFor(d, b.T);
  const cap = Math.min(packSize, Math.floor(b.T / 2) + sing);
  let k = clamp(Math.round((2.0 + 8.6 * Math.pow((level - 1) / 49, 0.9)) * G[d]), 2, cap);
  if (isRelief(level) && level > 1) {
    const prev = kForLevel(level - 1, d, packSize);
    k = Math.max(2, Math.min(k - 1, prev - 1));
  }
  return k;
}

/**
 * How many copies of each picture: every picture starts at 2 (1 for singletons), the rest go round-robin,
 * then the skew moves copies from small groups to large ones, capped at max(4, ⌊T/K⌋ + 2).
 */
export function copyPartition(T: number, K: number, level: number, d: Difficulty): number[] {
  const sing = singletonsFor(d, T);
  const minCopies = d <= 3 ? 2 : 1;
  const counts = new Array<number>(K).fill(2);
  for (let i = 0; i < sing && i < K; i++) counts[i] = 1;
  let remaining = T - counts.reduce((a, b) => a + b, 0);
  let i = sing % K;
  while (remaining > 0) {
    counts[i]! += 1;
    remaining--;
    i = (i + 1) % K;
  }
  const skew = Math.min(0.75, SKEW[d] + (0.22 * (level - 1)) / 49);
  const cap = Math.max(4, Math.floor(T / K) + 2);
  applySkew(counts, skew, cap, minCopies, sing);
  return counts;
}

function applySkew(counts: number[], skew: number, cap: number, minCopies: number, sing: number) {
  const floorOf = (idx: number) => (idx < sing ? 1 : minCopies);
  const movable = counts.reduce((a, c, idx) => a + Math.max(0, c - floorOf(idx)), 0);
  let moves = Math.round(skew * movable);
  while (moves-- > 0) {
    let small = -1;
    let smallVal = Infinity;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i]! > floorOf(i) && counts[i]! < smallVal) {
        smallVal = counts[i]!;
        small = i;
      }
    }
    let big = -1;
    let bigVal = -1;
    for (let i = 0; i < counts.length; i++) {
      if (counts[i]! < cap && counts[i]! > bigVal) {
        bigVal = counts[i]!;
        big = i;
      }
    }
    if (small < 0 || big < 0 || small === big) break;
    counts[small]! -= 1;
    counts[big]! += 1;
  }
}

/**
 * Expected wrong taps of a reference child with memory fidelity p: W(c,H) = c·(H−c)/(c+1) per round against a
 * shrinking pool H, scaled by (1−p). The last round (one picture left) costs nothing by construction.
 */
export function expectedMisses(partition: number[], p: number): number {
  let total = 0;
  for (let r = 0; r < partition.length; r++) {
    let H = 0;
    for (let j = r; j < partition.length; j++) H += partition[j]!;
    const c = partition[r]!;
    total += (c * (H - c)) / (c + 1);
  }
  return (1 - p) * total;
}

/** Hearts per board with lives = auto: max(3, round(M₀.₈₅ + SLACK[d])). Model-derived, not pilot-fitted. */
export function heartBudgetFor(d: Difficulty, partition: number[]): number {
  return Math.max(3, Math.round(expectedMisses(partition, 0.85) + SLACK[d]));
}

// ---------------------------------------------------------------- scoring

export const tileFactor = (T: number) => T / 12;
export const speedBonus = (levelSeconds: number) => clamp(1.8 - levelSeconds / 60, 1.0, 1.8);
export const streakMult = (streak: number) => 1 + Math.min(streak, 10) * 0.05;
export const accuracyMult = (heartsLeft: number, budget: number) => 0.45 + 0.55 * (budget > 0 ? heartsLeft / budget : 1);

/** Points for clearing a board: 100 × tiles × difficulty × speed × streak × accuracy. */
export function computeAward(T: number, d: Difficulty, levelSeconds: number, streak: number, heartsLeft: number, budget: number): number {
  return Math.round(100 * tileFactor(T) * DIFFICULTY_MULT[d] * speedBonus(levelSeconds) * streakMult(streak) * accuracyMult(heartsLeft, budget));
}

