import { describe, expect, it } from "vitest";
import { DIRECTION_LIST, MOVEMENT_TYPES, legsFor, locationBias, mirrored, pathFor, pointAt } from "../src/motion.ts";

const field = { x: 0, y: 92, w: 1000, h: 600 };

describe("legs", () => {
  const show = (t: number) => legsFor(t).map((l) => `${l.kind}${l.reverse ? "<" : ">"}`);
  it("names the six movement types in the product owner's order", () => {
    expect(MOVEMENT_TYPES).toEqual(["continuous", "intervals", "continuous-continuous", "continuous-intervals", "intervals-continuous", "intervals-intervals"]);
  });
  it("re-enters at A for one-word types and comes back for two-word types", () => {
    expect(show(0)).toEqual(["glide>", "glide>", "glide>"]);
    expect(show(1)).toEqual(["jump>", "jump>", "jump>"]);
    expect(show(2)).toEqual(["glide>", "glide<", "glide>"]);
    expect(show(3)).toEqual(["glide>", "jump<", "glide>"]);
    expect(show(4)).toEqual(["jump>", "glide<", "jump>"]);
    expect(show(5)).toEqual(["jump>", "jump<", "jump>"]);
    expect(show(99)).toEqual(show(0));
  });
});

describe("paths", () => {
  it("runs each of the eight directions through the middle of the field, starting and ending out of sight", () => {
    for (const d of DIRECTION_LIST) {
      const p = pathFor(d, field, 200);
      const mid = pointAt(p, 0.5);
      expect(mid.x).toBeCloseTo(500);
      expect(mid.y).toBeCloseTo(392);
      for (const end of [p.a, p.b]) {
        const outside = end.x <= -100 || end.x >= 1100 || end.y <= 92 - 100 || end.y >= 692 + 100;
        expect(outside, `${d} end ${JSON.stringify(end)}`).toBe(true);
      }
      expect(Math.hypot(p.dir.x, p.dir.y)).toBeCloseTo(1);
    }
  });

  it("points the way its name says", () => {
    const sign = (d: Parameters<typeof pathFor>[0]) => {
      const p = pathFor(d, field, 100);
      return [Math.sign(Math.round(p.b.x - p.a.x)), Math.sign(Math.round(p.b.y - p.a.y))];
    };
    expect(sign("ltr")).toEqual([1, 0]);
    expect(sign("rtl")).toEqual([-1, 0]);
    expect(sign("ttb")).toEqual([0, 1]);
    expect(sign("btt")).toEqual([0, -1]);
    expect(sign("tldbr")).toEqual([1, 1]);
    expect(sign("trdbl")).toEqual([-1, 1]);
    expect(sign("bldtr")).toEqual([1, -1]);
    expect(sign("brdtl")).toEqual([-1, -1]);
  });

  it("keeps the whole picture inside the field across the on-screen share", () => {
    for (const d of DIRECTION_LIST) {
      const p = pathFor(d, field, 200);
      for (const share of p.onScreen) {
        const c = pointAt(p, share);
        expect(c.x - 100).toBeGreaterThanOrEqual(-0.01);
        expect(c.x + 100).toBeLessThanOrEqual(1000.01);
        expect(c.y - 100).toBeGreaterThanOrEqual(91.99);
        expect(c.y + 100).toBeLessThanOrEqual(692.01);
      }
      expect(p.onScreen[1]).toBeGreaterThan(p.onScreen[0]);
    }
  });
});

describe("facing", () => {
  it("mirrors a picture so it faces its travel, and flips again on the way back", () => {
    expect(mirrored("left", "rtl", false)).toBe(false);
    expect(mirrored("left", "ltr", false)).toBe(true);
    expect(mirrored("left", "ltr", true)).toBe(false);
    expect(mirrored("right", "ltr", false)).toBe(false);
    expect(mirrored("right", "trdbl", false)).toBe(true);
    expect(mirrored("left", "bldtr", false)).toBe(true);
  });
  it("never mirrors vertical travel or pictures that must not be mirrored", () => {
    expect(mirrored("left", "ttb", false)).toBe(false);
    expect(mirrored("right", "btt", true)).toBe(false);
    for (const d of DIRECTION_LIST) expect(mirrored(null, d, false)).toBe(false);
  });
});

describe("target location", () => {
  it("says whether the location lies ahead of or behind the travel", () => {
    expect(locationBias("ltr", "E")).toBe(1);
    expect(locationBias("ltr", "NW")).toBe(-1);
    expect(locationBias("ltr", "N")).toBe(0);
    expect(locationBias("ttb", "S")).toBe(1);
    expect(locationBias("ttb", undefined)).toBe(0);
  });
});
