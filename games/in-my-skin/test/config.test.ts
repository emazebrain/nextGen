import { describe, expect, it } from "vitest";
import { MAX_LEVEL, TOLERANCE, glideSpeed, levelSettings, nextLevel, startLevel } from "../src/config.ts";

describe("difficulty", () => {
  it("gives less time and a smaller picture as the level rises, never the other way", () => {
    for (let l = 2; l <= MAX_LEVEL; l++) {
      const a = levelSettings(l - 1);
      const b = levelSettings(l);
      expect(b.windowMs).toBeLessThanOrEqual(a.windowMs);
      expect(b.size).toBeLessThanOrEqual(a.size);
      expect(b.dwellMs).toBeLessThanOrEqual(a.dwellMs);
      expect(b.spots).toBeGreaterThanOrEqual(a.spots);
    }
    expect(levelSettings(1)).toEqual({ size: 0.44, windowMs: 420, spots: 8, dwellMs: 650 });
    expect(levelSettings(30).windowMs).toBeLessThan(120);
  });

  it("keeps a jump leg to 8–12 spots", () => {
    for (let l = 1; l <= MAX_LEVEL; l++) {
      expect(levelSettings(l).spots).toBeGreaterThanOrEqual(8);
      expect(levelSettings(l).spots).toBeLessThanOrEqual(12);
    }
  });

  it("derives the glide speed from the time in the right zone", () => {
    // The zone is 2 × 15% of the picture long; crossing it takes the level's window.
    expect((2 * TOLERANCE) / glideSpeed(1)).toBeCloseTo(420);
    expect(glideSpeed(1, 0.5)).toBeCloseTo(glideSpeed(1) / 2);
    expect(glideSpeed(1, 3)).toBeCloseTo(glideSpeed(1)); // never faster than designed
  });

  it("starts from the assignment's difficulty", () => {
    expect([1, 2, 3, 4, 5].map(startLevel)).toEqual([1, 6, 11, 16, 21]);
  });

  it("moves up after two on-time stops in a row and down after two wrong", () => {
    expect(nextLevel(5, [true])).toBe(5);
    expect(nextLevel(5, [false, true, true])).toBe(6);
    expect(nextLevel(5, [true, false, false])).toBe(4);
    expect(nextLevel(5, [true, false])).toBe(5);
    expect(nextLevel(1, [false, false])).toBe(1);
    expect(nextLevel(MAX_LEVEL, [true, true])).toBe(MAX_LEVEL);
  });
});
