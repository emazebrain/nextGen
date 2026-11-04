/**
 * Orbital Order: difficulty, colours, glyphs, segments and scoring (design doc
 * §8.4), ported from v1 `src/lib/orbitalOrder/config.js`. Pure data.
 */

export type Difficulty = 1 | 2 | 3 | 4 | 5;

/** Spheres per trial, how long the rule shows first, and the response window per target (3000 ms × multiplier). */
export const DIFFICULTY: Record<Difficulty, { spheres: number; revealMs: number; windowMs: number }> = {
  1: { spheres: 4, revealMs: 2000, windowMs: 5400 },
  2: { spheres: 5, revealMs: 1700, windowMs: 4800 },
  3: { spheres: 6, revealMs: 1400, windowMs: 4200 },
  4: { spheres: 7, revealMs: 1200, windowMs: 3600 },
  5: { spheres: 8, revealMs: 1000, windowMs: 3000 },
};

export const PRACTICE_TRIALS = 3;
export const MOTOR_TRIALS = 5;
export const PROBE_TRIALS = 5;
/** The probe block always runs at difficulty 3, so sessions compare like for like. */
export const PROBE_DIFFICULTY: Difficulty = 3;
/** Rule trials in lives mode before the session completes (`trial_cap`). Timed modes have no cap. */
export const DEFAULT_MAX_RULE_TRIALS = 24;
export const SCORE_PER_TAP = 10;
export const CHAIN_BONUS = 25;
/** A rule lasts 5–8 trials, then switches. */
export const BLOCK_MIN = 5;
export const BLOCK_MAX = 8;
/** Practice: fewer than 2 of 3 trials right → rule blocks run at difficulty 1 (v1 comprehension gate). */
export const COMPREHENSION_PASS = 2;

export const GLYPHS = {
  digits: ["2", "3", "4", "5", "6", "7", "8", "9"],
  letters: ["A", "B", "D", "E", "F", "G", "H", "J", "K", "L", "M", "N", "P", "Q", "R", "T", "U", "V", "W", "X", "Y", "Z"],
} as const;
export type GlyphType = keyof typeof GLYPHS;

/** Glyph order: digits by value, letters by alphabet. Glyphs in a trial are unique, so there are no ties. */
export const glyphOrdinal = (g: string, type: GlyphType) => (type === "letters" ? g.charCodeAt(0) : Number(g));

/**
 * Rim patterns: every colour also carries a pattern, so a child with a colour-vision difference can still tell
 * the skip colour apart (v1). Same 8 patterns in both palettes.
 */
export type RingPattern = "solid" | "double" | "notched" | "dashed" | "thick" | "dotted" | "quadrant" | "inner";
export const RINGS: RingPattern[] = ["solid", "double", "notched", "dashed", "thick", "dotted", "quadrant", "inner"];

export interface Token {
  id: number;
  fill: string;
  ring: RingPattern;
  /** Glyph colour with enough contrast on this fill (design doc §8.4 asset table). */
  ink: string;
}

/** Warm "Sun Orchard" and cold "Star Ocean" sphere colours (design doc §8.4), each with its rim pattern. */
export const TOKENS: Record<"warm" | "cold", Token[]> = {
  warm: ["#FF8F3D", "#F26A2E", "#FFB547", "#F5C431", "#FF7A8A", "#B8322B", "#FFD08A", "#FFA27A"].map((fill, id) => ({
    id, fill, ring: RINGS[id]!, ink: fill === "#B8322B" ? "#FFFFFF" : "#3D1410",
  })),
  cold: ["#2A8FD8", "#2FB3C8", "#4FD8B8", "#3D63D6", "#5B47C9", "#B39BFF", "#6CC4E8", "#A8D8F5"].map((fill, id) => ({
    id, fill, ring: RINGS[id]!, ink: fill === "#3D63D6" || fill === "#5B47C9" ? "#FFFFFF" : "#0E1530",
  })),
};

export const POOL_SIZE = 5;
