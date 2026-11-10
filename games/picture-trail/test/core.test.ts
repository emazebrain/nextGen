/** Picture Trail: levels, pace and the line (spec 2026-11-10). */
import { describe, expect, it } from "vitest";
import { countForLevel, MAX_LEVEL, nextLevel, showMs, startLevel } from "../src/config.ts";
import { alongSide, linePoints } from "../src/geometry.ts";

describe("levels and pace", () => {
  it("shows 3, 4, 5, 6 and 8 pictures in bands of six levels", () => {
    expect(MAX_LEVEL).toBe(30);
    expect([1, 6, 7, 12, 13, 18, 19, 24, 25, 30].map(countForLevel)).toEqual([3, 3, 4, 4, 5, 5, 6, 6, 8, 8]);
  });

  it("starts at 1, 4, 8, 14 or 20 by difficulty", () => {
    expect([1, 2, 3, 4, 5].map((d) => startLevel(d as 1 | 2 | 3 | 4 | 5))).toEqual([1, 4, 8, 14, 20]);
  });

  it("paces pictures by age band, 4% faster per level within a band, slower with speed_scale", () => {
    expect(showMs(1, "4-6", 1)).toBe(1300);
    expect(showMs(1, "7-9", 1)).toBe(1100);
    expect(showMs(1, "10-12", 1)).toBe(950);
    expect(showMs(1, "13+", 1)).toBe(850);
    expect(showMs(3, "10-12", 1)).toBe(Math.round(950 * 0.96 ** 2));
    expect(showMs(7, "10-12", 1)).toBe(950); // a new band of N starts at the base again
    expect(showMs(1, "10-12", 0.5)).toBe(1900);
    expect(showMs(5, "10-12", 1, 1200)).toBe(1200); // a therapist's fixed time wins
    expect(showMs(5, "10-12", 1, 0)).toBe(Math.round(950 * 0.96 ** 4));
  });

  it("moves up after two correct rounds and down after two misses, within 1..30", () => {
    expect(nextLevel(5, [true, true])).toBe(6);
    expect(nextLevel(5, [false, false])).toBe(4);
    expect(nextLevel(5, [true, false])).toBe(5);
    expect(nextLevel(5, [true])).toBe(5);
    expect(nextLevel(1, [false, false])).toBe(1);
    expect(nextLevel(30, [true, true])).toBe(30);
  });
});

describe("the line", () => {
  it("spreads the pictures evenly from edge to edge", () => {
    const l = linePoints("ltr", 4, 1200, 700);
    expect(l.n).toBe(4);
    expect(l.capped).toBe(false);
    expect(l.points[0]!.x).toBeCloseTo(24 + l.size / 2);
    expect(l.points[3]!.x).toBeCloseTo(1200 - 24 - l.size / 2);
    const gaps = l.points.slice(1).map((p, i) => p.x - l.points[i]!.x);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]!);
    for (const p of l.points) expect(p.y).toBeCloseTo(350);
    expect(l.size).toBe(160);
  });

  it("runs right to left, bottom to top and corner to corner", () => {
    expect(linePoints("rtl", 3, 1000, 600).points[0]!.x).toBeGreaterThan(500);
    const btt = linePoints("btt", 3, 1000, 600).points;
    expect(btt[0]!.y).toBeGreaterThan(btt[2]!.y);
    expect(btt[0]!.x).toBeCloseTo(500);
    const d = linePoints("trdbl", 3, 1000, 600).points;
    expect(d[0]!.x).toBeGreaterThan(d[2]!.x);
    expect(d[0]!.y).toBeLessThan(d[2]!.y);
  });

  it("caps N on a small diagonal so pictures stay at least 64 px", () => {
    const l = linePoints("tldbr", 8, 375, 560);
    expect(l.capped).toBe(true);
    expect(l.n).toBeLessThan(8);
    expect(l.size).toBeGreaterThanOrEqual(64);
    expect(l.points).toHaveLength(l.n);
    const h = linePoints("ltr", 8, 375, 560);
    expect(h.capped).toBe(true);
    expect(h.size).toBeGreaterThanOrEqual(64);
  });

  it("moves the line toward the target location, across its direction only", () => {
    expect(linePoints("ltr", 3, 1000, 600, "N").points[0]!.y).toBeCloseTo(300 - 0.22 * 600);
    expect(linePoints("rtl", 3, 1000, 600, "SW").points[0]!.y).toBeCloseTo(300 + 0.22 * 600);
    expect(linePoints("ltr", 3, 1000, 600, "W").points[0]!.y).toBeCloseTo(300); // no north/south part: centred
    expect(linePoints("ttb", 3, 1000, 600, "E").points[0]!.x).toBeCloseTo(500 + 0.22 * 1000);
    const d = linePoints("tldbr", 3, 1000, 600, "NE").points;
    const c = linePoints("tldbr", 3, 1000, 600).points;
    expect(d[1]!.x - c[1]!.x).toBeGreaterThan(0); // the middle moves toward the north-east side
    expect(d[1]!.y - c[1]!.y).toBeLessThan(0);
    for (const p of d) {
      expect(p.x).toBeGreaterThanOrEqual(24);
      expect(p.y).toBeGreaterThanOrEqual(24);
    }
  });

  it("says which half of the line the target lies in", () => {
    expect(alongSide("ltr", "W")).toBe(-1);
    expect(alongSide("ltr", "NE")).toBe(1);
    expect(alongSide("ltr", "N")).toBe(0);
    expect(alongSide("rtl", "W")).toBe(1);
    expect(alongSide("ttb", "N")).toBe(-1);
    expect(alongSide("tldbr", "NW")).toBe(-1); // the start corner
    expect(alongSide("tldbr", "NE")).toBe(0); // across the line
    expect(alongSide("tldbr", "W")).toBe(-1);
    expect(alongSide("trdbl", "S")).toBe(1);
  });
});
