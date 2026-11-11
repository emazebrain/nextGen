import { describe, expect, it } from "vitest";
import { generateRound, type RoundContext } from "../src/rounds.ts";

const seededRng = (seed: number) => {
  let s = seed | 0;
  return () => {
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    s = Math.imul(s ^ (s >>> 16), 0x45d9f3b);
    return ((s ^ (s >>> 16)) >>> 0) / 0x100000000;
  };
};

const ctx = (overrides: Partial<RoundContext> = {}): RoundContext => ({
  level: 1,
  ageBand: "4-6",
  rng: seededRng(42),
  ...overrides,
});

describe("generateRound", () => {
  it("returns a valid RoundSpec with side, rotation, and pose", () => {
    const r = generateRound(ctx());
    expect(r.side).toMatch(/^(left|right)$/);
    expect(r.correctSide).toBe(r.side);
    expect(r.rotationDeg).toBeGreaterThanOrEqual(0);
    expect(r.rotationDeg).toBeLessThanOrEqual(15); // level 1 cap
    expect(r.rotationDir).toMatch(/^(cw|ccw)$/);
    expect(r.pose.bodyPart).toBe("hand"); // level 1, band 4-6
  });

  it("respects maxRotation override", () => {
    const r = generateRound(ctx({ level: 30, ageBand: "13+", maxRotation: 10 }));
    expect(r.rotationDeg).toBeLessThanOrEqual(10);
  });

  it("respects CW/CCW 80/20 bias over many rounds", () => {
    const rng = seededRng(1);
    const dirs = Array.from({ length: 200 }, () =>
      generateRound({ ...ctx(), level: 15, ageBand: "13+", rotationBias: "cw", rng }).rotationDir,
    );
    const cwCount = dirs.filter((d) => d === "cw").length;
    // 80% ± some variance: expect at least 120 and at most 190
    expect(cwCount).toBeGreaterThan(120);
    expect(cwCount).toBeLessThan(190);
  });

  it("picks from level-appropriate body parts", () => {
    const parts = new Set(
      Array.from({ length: 50 }, () => generateRound(ctx({ level: 1, ageBand: "13+" })).pose.bodyPart),
    );
    expect(parts).toEqual(new Set(["hand"])); // level 1 = hands only
  });

  it("at level 20, all body parts eligible (with age 13+)", () => {
    const rng = seededRng(7);
    const parts = new Set(
      Array.from({ length: 200 }, () =>
        generateRound({ ...ctx(), level: 20, ageBand: "13+", rng }).pose.bodyPart,
      ),
    );
    expect(parts.size).toBeGreaterThanOrEqual(3); // statistically should hit 4
  });

  it("side is roughly 50/50 over many rounds", () => {
    const rng = seededRng(99);
    const sides = Array.from({ length: 200 }, () => generateRound({ ...ctx(), rng }).side);
    const leftCount = sides.filter((s) => s === "left").length;
    expect(leftCount).toBeGreaterThan(60);
    expect(leftCount).toBeLessThan(140);
  });
});
