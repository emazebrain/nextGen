import type { BodyPart } from "./assets.ts";

export const MAX_LEVEL = 30;

export const clamp = (v: number, lo: number, hi: number): number =>
  Math.max(lo, Math.min(hi, v));

/* ── Difficulty tables (spec §Difficulty Progression) ── */

const ROTATION: readonly number[] = [
  15, 15, 15, 15, 15,       // 1–5
  45, 45, 45, 45, 45,       // 6–10
  90, 90, 90, 90, 90,       // 11–15
  135, 135, 135, 135, 135,   // 16–20
  150, 150, 150, 150, 150,   // 21–25
  180, 180, 180, 180, 180,   // 26–30
];

const TIME: readonly number[] = [
  8000, 8000, 8000, 8000, 8000,   // 1–5
  6000, 6000, 6000, 6000, 6000,   // 6–10
  5000, 5000, 5000, 5000, 5000,   // 11–15
  4000, 4000, 4000, 4000, 4000,   // 16–20
  3500, 3500, 3500, 3500, 3500,   // 21–25
  3000, 3000, 3000, 3000, 3000,   // 26–30
];

const BODY_PARTS: readonly BodyPart[][] = [
  ["hand"],                              // 1–5
  ["hand", "foot"],                      // 6–10
  ["hand", "arm", "foot"],               // 11–15
  ["hand", "arm", "foot", "ear"],        // 16–20
  ["hand", "arm", "foot", "ear"],        // 21–25
  ["hand", "arm", "foot", "ear"],        // 26–30
];

const bandOf = (level: number): number =>
  clamp(Math.ceil(level / 5) - 1, 0, 5);

/** Max rotation in degrees for a given level. */
export function rotationRange(level: number): number {
  return ROTATION[clamp(level, 1, MAX_LEVEL) - 1]!;
}

/**
 * Per-question time limit in ms.
 * `override` of 0 means auto (use the table).
 * Non-zero override is clamped to [2000, 10000].
 */
export function timeLimit(level: number, override: number): number {
  if (override > 0) return clamp(override, 2000, 10000);
  return TIME[clamp(level, 1, MAX_LEVEL) - 1]!;
}

/** Which body parts appear at a given level. */
export function bodyPartsForLevel(level: number): BodyPart[] {
  return BODY_PARTS[bandOf(level)]!;
}

/**
 * 2-correct-up / 2-wrong-down staircase.
 * `sinceChange` is the most recent results (true = correct, false = wrong).
 * Needs at least 2 entries to trigger a change.
 */
export function nextLevel(level: number, sinceChange: boolean[]): number {
  if (sinceChange.length < 2) return level;
  const last2 = sinceChange.slice(-2);
  if (last2[0] && last2[1]) return clamp(level + 1, 1, MAX_LEVEL);
  if (!last2[0] && !last2[1]) return clamp(level - 1, 1, MAX_LEVEL);
  return level;
}
