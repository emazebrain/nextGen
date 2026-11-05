/**
 * Tunnel Rush: difficulty, glyphs, scoring and looks (design doc §8.4), ported
 * from v1 `src/lib/tunnelRush/config.js`. Pure data.
 */

export type Difficulty = 1 | 2 | 3 | 4 | 5;

export const MAX_LEVEL = 10;
/** World units of tunnel visible ahead of the ship. */
export const VIEW_DEPTH = 7;
/** Progressive mode: one level up every 8 objects. */
export const OBSTACLES_PER_LEVEL = 8;
/** The speed band's ceiling rises 8 % per level. */
export const LEVEL_SPEED_BONUS = 0.08;
export const LANES_ALLOWED = [6, 8, 10, 12] as const;
/** Practice: 20 s at difficulty 1 (§8.4). */
export const PRACTICE_S = 20;
/** A collision slows the run to half speed for this long (v1). */
export const HIT_SLOW_S = 0.5;
/** No second life lost within 1 s of a collision (§8.1, continuous games). */
export const LIFE_LOSS_GRACE_MS = 1000;

/**
 * Speed band (world units/s), object spacing, how far the next object may sit from the last, and the bend of
 * the corridor (viewBox units at the far ring). v1 had three presets; 2 and 4 are interpolated (§8.4).
 */
export const DIFFICULTY: Record<Difficulty, { speedMin: number; speedMax: number; spacing: number; maxJump: number; bend: number }> = {
  1: { speedMin: 2.4, speedMax: 3.6, spacing: 5.0, maxJump: 2, bend: 90 },
  2: { speedMin: 2.7, speedMax: 4.1, spacing: 4.6, maxJump: 2, bend: 140 },
  3: { speedMin: 3.0, speedMax: 4.6, spacing: 4.2, maxJump: 3, bend: 200 },
  4: { speedMin: 3.4, speedMax: 5.2, spacing: 3.8, maxJump: 3, bend: 260 },
  5: { speedMin: 3.8, speedMax: 5.8, spacing: 3.4, maxJump: 4, bend: 320 },
};

export type ObjectType = "shapes" | "letters" | "numbers" | "cartoon_faces" | "real_faces" | "mixed";
export type GlyphKind = "shape" | "letter" | "number" | "cartoon_face" | "real_face";
export interface Glyph {
  kind: GlyphKind;
  label: string;
}

export const SHAPES = ["circle", "square", "triangle", "cross", "star", "hexagon"] as const;
export const LETTERS = ["A", "B", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "T", "U", "V", "W", "X", "Y", "Z"];
export const NUMBERS = ["2", "3", "4", "5", "6", "7", "8", "9"];
/** Faces are drawn in code from a seed: no photos and no real people (§8.4, invariant 1). */
export const FACE_MOODS = ["calm", "happy", "surprised", "serious"];

/**
 * The objects that can appear for an object type. v1 lower-cased the parameter but matched camel-case names,
 * so "cartoon faces" and "realistic faces" silently fell back to the mixed set (ADR 0014).
 */
export function glyphPool(type: ObjectType): Glyph[] {
  const of = (kind: GlyphKind, labels: readonly string[]) => labels.map((label) => ({ kind, label }));
  switch (type) {
    case "shapes":
      return of("shape", SHAPES);
    case "letters":
      return of("letter", LETTERS);
    case "numbers":
      return of("number", NUMBERS);
    case "cartoon_faces":
      return of("cartoon_face", FACE_MOODS);
    case "real_faces":
      return of("real_face", FACE_MOODS);
    case "mixed":
      return [...of("shape", SHAPES), ...of("letter", LETTERS.slice(0, 6)), ...of("number", NUMBERS.slice(0, 4)), ...of("cartoon_face", FACE_MOODS)];
  }
}

/** Hybrid score (v1): points per distance unit, a dodge bonus that grows with the streak (capped), a small bump cost. */
export const DISTANCE_POINTS = 0.5;
export const DODGE_POINTS = 10;
export const STREAK_POINTS = 2;
export const STREAK_CAP = 10;
export const HIT_PENALTY = 5;
export const LEVEL_BONUS = OBSTACLES_PER_LEVEL * 2.5;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
