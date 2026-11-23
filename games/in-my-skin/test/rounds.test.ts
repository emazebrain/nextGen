import { describe, expect, it } from "vitest";
import { TOLERANCE, levelSettings } from "../src/config.ts";
import { spotShare } from "../src/engine.ts";
import { pointAt } from "../src/motion.ts";
import { PICTURES } from "../src/pictures.ts";
import { planRound, type RoundContext } from "../src/rounds.ts";

const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const field = { x: 0, y: 92, w: 1024, h: 676 };
const base = (over: Partial<RoundContext> = {}): RoundContext => ({ level: 1, picture: PICTURES[0]!, field, rng: seeded(1), ...over });

describe("planRound", () => {
  it("sizes the picture from the level and the field's short side", () => {
    expect(planRound(base()).size).toBeCloseTo(0.44 * 676);
    expect(planRound(base({ level: 30 })).size).toBeLessThan(0.25 * 676);
  });

  it("gives exactly the level's time inside the right zone, whatever the direction", () => {
    for (const d of ["ltr", "ttb", "tldbr"] as const) {
      for (const level of [1, 12, 30]) {
        const s = planRound(base({ level, motion: [{ movement_types: [0], directions: [d] }] }));
        const zoneMs = 2 * TOLERANCE * s.plan.sizeShare * s.plan.glideMs;
        expect(zoneMs).toBeCloseTo(levelSettings(level).windowMs, 5);
      }
    }
  });

  it("slows down with the platform's speed scale", () => {
    const full = planRound(base({ rng: seeded(3) }));
    const half = planRound(base({ rng: seeded(3), speedScale: 0.5 }));
    expect(half.plan.glideMs).toBeCloseTo(full.plan.glideMs * 2);
    expect(half.plan.dwellMs).toBe(full.plan.dwellMs * 2);
  });

  it("takes direction and movement type from the brain region's pairs", () => {
    const rng = seeded(11);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const s = planRound(base({ rng, motion: [{ movement_types: [1, 3], directions: ["ttb"] }, { movement_types: [5], directions: ["rtl", "brdtl"] }] }));
      seen.add(`${s.movementType}:${s.direction}`);
    }
    expect([...seen].sort()).toEqual(["1:ttb", "3:ttb", "5:brdtl", "5:rtl"]);
  });

  it("glides left or right when the step has no brain region", () => {
    const rng = seeded(5);
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = planRound(base({ rng }));
      seen.add(s.direction);
      expect(s.movementType).toBe(0);
    }
    expect([...seen].sort()).toEqual(["ltr", "rtl"]);
  });

  it("lets the therapist fix the movement type", () => {
    const s = planRound(base({ movementType: 4, motion: [{ movement_types: [0], directions: ["ltr"] }] }));
    expect(s.movementType).toBe(4);
    expect(s.plan.legs.map((l) => l.kind)).toEqual(["jump", "glide", "jump"]);
  });

  it("places the outline fully on screen, at a place that changes from round to round", () => {
    const rng = seeded(21);
    const places = new Set<number>();
    for (let i = 0; i < 100; i++) {
      const s = planRound(base({ rng, level: 1 + (i % 30), motion: [{ movement_types: [0], directions: ["ltr", "btt", "trdbl"] }] }));
      const [f0, f1] = s.path.onScreen;
      expect(s.plan.target).toBeGreaterThanOrEqual(f0);
      expect(s.plan.target).toBeLessThanOrEqual(f1);
      const half = s.size / 2;
      expect(s.target.x - half).toBeGreaterThanOrEqual(-0.01);
      expect(s.target.x + half).toBeLessThanOrEqual(field.w + 0.01);
      expect(s.target.y - half).toBeGreaterThanOrEqual(field.y - 0.01);
      expect(s.target.y + half).toBeLessThanOrEqual(field.y + field.h + 0.01);
      places.add(Math.round(s.plan.target * 100));
    }
    expect(places.size).toBeGreaterThan(10);
  });

  it("leans the outline toward the brain region's target location", () => {
    const mean = (loc: "E" | "W") => {
      const rng = seeded(9);
      let sum = 0;
      for (let i = 0; i < 100; i++) sum += planRound(base({ rng, targetLocations: [loc], motion: [{ movement_types: [0], directions: ["ltr"] }] })).target.x;
      return sum / 100;
    };
    expect(mean("E")).toBeGreaterThan(mean("W") + 50);
  });

  it("keeps every jump spot on screen with one exactly on the outline", () => {
    const rng = seeded(4);
    for (let i = 0; i < 100; i++) {
      const s = planRound(base({ rng, level: 1 + (i % 30), movementType: 1, motion: [{ movement_types: [1], directions: ["rtl", "ttb", "bldtr"] }] }));
      expect(spotShare(s.plan, s.plan.targetSpot)).toBe(s.plan.target);
      const half = s.size / 2;
      for (let k = 0; k < s.plan.spots; k++) {
        const p = pointAt(s.path, spotShare(s.plan, k));
        expect(p.x - half).toBeGreaterThanOrEqual(-s.size * 0.3);
        expect(p.x + half).toBeLessThanOrEqual(field.w + s.size * 0.3);
        expect(p.y + half).toBeLessThanOrEqual(field.y + field.h + s.size * 0.3);
      }
      expect(s.plan.targetSpot).toBeGreaterThanOrEqual(1);
      expect(s.plan.targetSpot).toBeLessThanOrEqual(s.plan.spots - 2);
    }
  });

  it("keeps the outline clear of the Stop button", () => {
    const rng = seeded(8);
    const avoid = { x: 78, y: 690, r: 62 };
    for (let i = 0; i < 100; i++) {
      const s = planRound(base({ rng, level: 20, avoid, targetLocations: ["SW"], motion: [{ movement_types: [0], directions: ["trdbl", "bldtr"] }] }));
      expect(Math.hypot(s.target.x - avoid.x, s.target.y - avoid.y)).toBeGreaterThanOrEqual(avoid.r + s.size * 0.6);
    }
  });

  it("is the same round for the same seed", () => {
    const a = planRound(base({ rng: seeded(42), motion: [{ movement_types: [0, 1, 2], directions: ["ltr", "rtl", "ttb"] }] }));
    const b = planRound(base({ rng: seeded(42), motion: [{ movement_types: [0, 1, 2], directions: ["ltr", "rtl", "ttb"] }] }));
    expect(a).toEqual(b);
  });
});
