import { describe, expect, it } from "vitest";
import { DIFFICULTY, glyphPool, MAX_LEVEL, OBSTACLES_PER_LEVEL, VIEW_DEPTH, type Difficulty } from "../src/config.ts";
import { TunnelEngine, type EngineConfig } from "../src/engine.ts";
import { TunnelMetrics } from "../src/metrics.ts";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({
  lanes: 8,
  difficulty: 3,
  startLevel: 1,
  progressive: true,
  spin: "none",
  spinDegPerS: 14,
  lean: null,
  pool: glyphPool("shapes"),
  rng: mulberry32(1),
  ...extra,
});

/** Runs the engine for `seconds`, steering away from any object about to arrive in the ship's lane when `dodge`. */
function run(e: TunnelEngine, seconds: number, dodge: boolean) {
  const passes = [];
  for (let t = 0; t < seconds; t += 1 / 60) {
    if (dodge) {
      const next = e.obstacles.filter((o) => !o.resolved).sort((a, b) => a.z - b.z)[0];
      if (next && next.z - e.scroll < 0.6 && next.lane === e.facing()) e.steer(1);
    }
    passes.push(...e.update(1 / 60).passed);
  }
  return passes;
}

describe("glyph pools", () => {
  it("gives faces for the face types (v1 fell back to the mixed set)", () => {
    expect(glyphPool("cartoon_faces").every((g) => g.kind === "cartoon_face")).toBe(true);
    expect(glyphPool("real_faces").every((g) => g.kind === "real_face")).toBe(true);
    expect(glyphPool("letters")).toHaveLength(22);
    expect(new Set(glyphPool("mixed").map((g) => g.kind)).size).toBe(4);
  });
});

describe("engine", () => {
  it("fills the view ahead at the start and keeps the first object out of the ship's lane", () => {
    for (let seed = 1; seed < 40; seed++) {
      const e = new TunnelEngine(cfg({ rng: mulberry32(seed) }));
      expect(e.obstacles.length).toBeGreaterThan(0);
      expect(e.obstacles.every((o) => o.z < VIEW_DEPTH)).toBe(true);
      expect(e.obstacles[0]!.lane).not.toBe(e.facing());
    }
  });

  it("steers one lane at a time: right brings the lane on the ship's right in front", () => {
    const e = new TunnelEngine(cfg());
    const f = e.facing();
    const right = (f - 1 + 8) % 8;
    expect(e.sideOf(right)).toBe("R");
    e.steer(1);
    expect(e.facing()).toBe(right);
    e.steer(-1);
    e.steer(-1);
    expect(e.facing()).toBe((f + 1) % 8);
    expect(e.steers).toBe(3);
  });

  it("never places two objects in a row in the same lane, and keeps jumps within reach", () => {
    for (const d of [1, 3, 5] as Difficulty[]) {
      const e = new TunnelEngine(cfg({ difficulty: d, rng: mulberry32(d) }));
      const passes = run(e, 120, false);
      for (let i = 1; i < passes.length; i++) {
        const a = passes[i - 1]!.obstacle.lane;
        const b = passes[i]!.obstacle.lane;
        expect(a).not.toBe(b);
        const jump = Math.min((a - b + 8) % 8, (b - a + 8) % 8);
        expect(jump).toBeLessThanOrEqual(DIFFICULTY[d].maxJump);
      }
    }
  });

  it("hits only when the object's lane faces the ship on arrival", () => {
    const e = new TunnelEngine(cfg());
    const passes = run(e, 60, false);
    expect(passes.length).toBeGreaterThan(20);
    for (const p of passes) if (p.hit) expect(p.obstacle.threat || p.obstacle.lane === e.facing()).toBeTruthy();
    // Never steering: only objects that appeared in the ship's lane can hit (no spin).
    expect(passes.filter((p) => p.hit).every((p) => p.obstacle.threat)).toBe(true);
  });

  it("speeds up on clean dodges inside the band and slows down after a bump", () => {
    const e = new TunnelEngine(cfg());
    run(e, 90, true);
    expect(e.speed).toBeGreaterThan(e.bandMin());
    expect(e.speed).toBeLessThanOrEqual(e.bandMax() + 1e-9);
    const f = new TunnelEngine(cfg({ rng: mulberry32(9) }));
    const passes = run(f, 120, false);
    const hit = passes.findIndex((p) => p.hit);
    expect(hit).toBeGreaterThan(-1);
    if (hit > 0) expect(passes[hit]!.speed).toBeLessThan(passes[hit - 1]!.speed + 1e-9);
  });

  it("levels up every 8 objects in progressive mode, up to level 10, and not otherwise", () => {
    const e = new TunnelEngine(cfg({ difficulty: 5 }));
    const ups: number[] = [];
    for (let t = 0; t < 400; t += 1 / 30) {
      const r = e.update(1 / 30);
      if (r.levelUp) ups.push(r.levelUp);
    }
    expect(ups.slice(0, 3)).toEqual([2, 3, 4]);
    expect(Math.max(...ups)).toBe(MAX_LEVEL);
    expect(e.passedCount).toBeGreaterThanOrEqual(OBSTACLES_PER_LEVEL * (MAX_LEVEL - 1));
    const f = new TunnelEngine(cfg({ progressive: false }));
    for (let t = 0; t < 60; t += 1 / 30) expect(f.update(1 / 30).levelUp).toBeNull();
    expect(f.level).toBe(1);
  });

  it("spins the tunnel on its own when rotation is on, and alternates every 6 s", () => {
    const e = new TunnelEngine(cfg({ spin: "cw", spinDegPerS: 30 }));
    e.update(1);
    expect(e.angle).toBeCloseTo(Math.PI / 6);
    const f = new TunnelEngine(cfg({ spin: "alternate", spinDegPerS: 30 }));
    for (let i = 0; i < 12; i++) f.update(1);
    expect(f.angle).toBeCloseTo(0, 5);
  });

  it("measures reaction from when the object came into view to the last steer before it arrived", () => {
    const e = new TunnelEngine(cfg());
    // Objects on screen before the start have no reaction time; wait until the nearest object is a later one.
    expect(e.obstacles[0]!.preview).toBe(true);
    const nearest = () => e.obstacles.filter((o) => !o.resolved).sort((a, b) => a.z - b.z)[0]!;
    while (nearest().preview) e.update(1 / 60);
    const target = nearest();
    e.update(target.spawnedAt + 0.5 - e.time);
    e.steer(1);
    let p;
    for (let i = 0; i < 600 && !p; i++) p = e.update(1 / 60).passed.find((x) => x.obstacle.id === target.id);
    expect(p!.reactionMs).toBe(500);
  });

  it("leans new objects towards the hemisphere's side and stays even without a lean", () => {
    const share = (lean: "L" | "R" | null) => {
      let l = 0;
      let r = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const e = new TunnelEngine(cfg({ lean, rng: mulberry32(seed) }));
        for (const p of run(e, 120, true)) {
          if (p.obstacle.spawnSide === "L") l++;
          if (p.obstacle.spawnSide === "R") r++;
        }
      }
      return r / (l + r);
    };
    expect(share("R")).toBeGreaterThan(0.65);
    expect(share("L")).toBeLessThan(0.35);
    const even = share(null);
    expect(even).toBeGreaterThan(0.4);
    expect(even).toBeLessThan(0.6);
  });

  it("is deterministic for a seed", () => {
    const go = () => {
      const e = new TunnelEngine(cfg({ rng: mulberry32(77), lean: "R" }));
      return JSON.stringify(run(e, 30, true).map((p) => [p.obstacle.lane, p.hit, p.obstacle.glyph.label]));
    };
    expect(go()).toBe(go());
  });
});

describe("metrics", () => {
  it("scores distance, dodges with a capped streak bonus, bumps and level-ups like v1", () => {
    const m = new TunnelMetrics(1);
    const pass = (hit: boolean, side: "L" | "R" = "L", threat = false) => ({
      obstacle: { id: 1, z: 0, lane: 2, glyph: { kind: "shape" as const, label: "star" }, resolved: true, spawnedAt: 0, lastSteerAt: null, spawnSide: side, threat, preview: false },
      hit,
      reactionMs: hit ? null : 400,
      speed: 3,
      level: 1,
    });
    m.addDistance(10);
    expect(m.score).toBe(5);
    expect(m.record(pass(false), 1)).toBe(12);
    expect(m.record(pass(false), 2)).toBe(14);
    expect(m.record(pass(true, "R", true), 3)).toBe(-5);
    m.levelUp(2);
    expect(m.score).toBe(5 + 12 + 14 - 5 + 20);
    for (let i = 0; i < 15; i++) m.record(pass(false), 4);
    expect(m.objects.at(-1)).toBeTruthy();
    expect(m.bestStreak).toBe(15);
    const s = m.summary();
    expect(s.obstacles).toBe(18);
    expect(s.hits).toBe(1);
    expect(s.hit_rate_right).toBe(1);
    expect(s.hit_rate_left).toBe(0);
    expect(s.side_hit_asymmetry).toBe(1);
    expect(s.threat_dodge_rate).toBe(0);
    expect(s.no_move_rate).toBe(0.056);
    expect(s.median_reaction_ms).toBe(400);
    expect(s.level_reached).toBe(2);
  });

  it("never lets a bump take the score below zero", () => {
    const m = new TunnelMetrics(1);
    m.record({ obstacle: { id: 1, z: 0, lane: 0, glyph: { kind: "shape", label: "x" }, resolved: true, spawnedAt: 0, lastSteerAt: null, spawnSide: "C", threat: true, preview: false }, hit: true, reactionMs: null, speed: 3, level: 1 }, 0);
    expect(m.score).toBe(0);
  });
});
