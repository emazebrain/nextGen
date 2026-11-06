import { describe, expect, it } from "vitest";
import { BALL_R, BlockEngine, BOARD_W, BRICK_H, BRICK_W, EFFECT_S, PADDLE_Y, type EngineConfig } from "../src/engine.ts";
import { DIFFICULTY, LAYOUTS, specialKinds, SPECIALS, tuning } from "../src/levels.ts";

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

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({ difficulty: 1, lean: null, rng: mulberry32(1), ...extra });

/** A steady player: keeps the paddle under the lowest falling ball, slightly off-centre so the angle varies. */
function bot(e: BlockEngine, seconds: number, dt = 1 / 60, stopOn?: (out: ReturnType<BlockEngine["update"]>) => boolean) {
  let k = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (e.phase === "serving") e.serve();
    const falling = e.balls.filter((b) => b.dy > 0).sort((a, b) => b.y - a.y)[0] ?? e.balls[0];
    if (falling) e.movePaddle(falling.x + Math.sin(k++ * 0.37) * e.paddleW * 0.3);
    const out = e.update(dt);
    if (stopOn?.(out)) return out;
    if (e.phase === "done") return out;
  }
  return null;
}

describe("levels", () => {
  it("applies v1's per-level speed and paddle on top of the difficulty's start values", () => {
    expect(tuning(1, 1, 1)).toEqual({ speed: 3.5, paddle: 130 });
    // Difficulty 1 climbing to level 10 reaches v1's own level-10 values (v1 never applied them).
    expect(tuning(1, 10, 1)).toEqual({ speed: 6.5, paddle: 80 });
    expect(tuning(2, 4, 4)).toEqual({ speed: 4.0, paddle: 120 });
    expect(tuning(2, 5, 4)).toEqual({ speed: 4.5, paddle: 120 });
    expect(tuning(5, 10, 10)).toEqual({ speed: 6.0, paddle: 90 });
    expect(LAYOUTS).toHaveLength(10);
    for (const l of LAYOUTS) for (const row of l.pattern) expect(row).toHaveLength(10);
  });

  it("uses v1's special pairs at difficulties 2–3 and all eight at 4–5; none at 1", () => {
    const rng = mulberry32(3);
    expect(specialKinds(1, 4, rng)).toEqual([]);
    expect(specialKinds(2, 1, rng)).toEqual(["exploding", "slow_down"]);
    expect(specialKinds(3, 4, rng)).toEqual(["invisible", "gravity"]);
    expect(specialKinds(3, 5, rng)).toHaveLength(2);
    expect(specialKinds(4, 2, rng)).toEqual(SPECIALS);
  });
});

describe("engine", () => {
  it("starts at the difficulty's level and waits for the serve, the ball riding on the paddle", () => {
    const e = new BlockEngine(cfg({ difficulty: 3 }));
    expect(e.level).toBe(DIFFICULTY[3].startLevel);
    for (let i = 0; i < 50; i++) e.update(0.1);
    expect(e.phase).toBe("serving");
    e.movePaddle(200);
    e.update(0.02);
    expect(e.balls[0]!.x).toBe(200);
    expect(e.balls[0]!.y).toBeLessThan(PADDLE_Y);
    expect(e.serve()).toBe(true);
    expect(e.phase).toBe("playing");
    expect(e.balls[0]!.dy).toBeLessThan(0);
    expect(e.serve()).toBe(false);
  });

  it("places the special share on the board, three in four on the hemisphere's half", () => {
    let lean = 0;
    let all = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const e = new BlockEngine(cfg({ difficulty: 5, lean: "R", rng: mulberry32(seed) }));
      const sp = e.bricks.filter((b) => b.special);
      expect(sp.length).toBe(Math.round(e.bricks.length * 0.2));
      all += sp.length;
      lean += sp.filter((b) => b.col >= 5).length;
    }
    expect(lean / all).toBeGreaterThan(0.68);
    expect(lean / all).toBeLessThan(0.82);
    expect(new BlockEngine(cfg({ difficulty: 1 })).bricks.some((b) => b.special)).toBe(false);
  });

  it("a steady player clears the board, scores, and the next board serves itself", () => {
    const e = new BlockEngine(cfg());
    const out = bot(e, 900, 1 / 60, (o) => !!o.levelCleared);
    expect(out?.levelCleared).toMatchObject({ level: 1, bricks: 20 });
    expect(e.level).toBe(2);
    expect(e.phase).toBe("serving");
    expect(e.autoServeAt).not.toBeNull();
    expect(e.score).toBeGreaterThanOrEqual(20 * 10 + 50);
    for (let i = 0; i < 31; i++) e.update(0.1);
    expect(e.phase).toBe("playing");
    const s = e.metrics.summary();
    expect(s.paddle_hits).toBeGreaterThan(5);
    expect(s.avg_intercept_gap_px).not.toBeNull();
    expect(s.avg_intercept_gap_px!).toBeLessThan(BRICK_W);
    expect(s.intercept_ms_median).toBeGreaterThan(100);
  });

  it("losing the last ball loses a life; in lives mode the child serves again", () => {
    const e = new BlockEngine(cfg());
    e.movePaddle(60);
    e.serve();
    e.balls[0]!.x = 700;
    e.balls[0]!.dx = 0;
    e.balls[0]!.dy = 300;
    let lost = null;
    for (let i = 0; i < 300 && !lost; i++) lost = e.update(1 / 60).lifeLost;
    expect(lost).toEqual({ side: "R" });
    expect(e.phase).toBe("serving");
    expect(e.autoServeAt).toBeNull();
    const s = e.metrics.summary();
    expect(s).toMatchObject({ balls_lost: 1, lives_lost: 1, misses_right: 1, misses_left: 0, side_miss_asymmetry: 1, paddle_miss_rate: 1 });
  });

  it("in timed mode a lost ball costs 50 points (never below 0) and serves itself after 1 s", () => {
    const e = new BlockEngine(cfg({ timed: true }));
    e.score = 70;
    e.movePaddle(60);
    e.serve();
    Object.assign(e.balls[0]!, { x: 700, dx: 0, dy: 300 });
    while (!e.update(1 / 60).lifeLost);
    expect(e.score).toBe(20);
    expect(e.phase).toBe("serving");
    for (let i = 0; i < 11; i++) e.update(0.1);
    expect(e.phase).toBe("playing");
  });

  it("with several balls, a life goes only when the last one leaves", () => {
    const e = new BlockEngine(cfg());
    e.movePaddle(60);
    e.serve();
    const b = e.balls[0]!;
    Object.assign(b, { x: 700, dx: 0, dy: 300 });
    e.balls.push({ ...b, id: 999, x: 500, y: b.y - 200 });
    let losses = 0;
    let lives = 0;
    for (let i = 0; i < 400; i++) {
      const o = e.update(1 / 60);
      losses += o.trials.filter((t) => t.outcome === "miss").length;
      if (o.lifeLost) lives += 1;
      if (e.phase === "serving") break;
    }
    expect(losses).toBe(2);
    expect(lives).toBe(1);
  });

  it("an exploding brick clears its neighbours and a rocket its column; both count towards power-up efficiency", () => {
    const e = new BlockEngine(cfg());
    e.serve();
    const target = e.bricks.find((b) => b.row === 1 && b.col === 4)!;
    target.special = "exploding";
    const rocket = e.bricks.find((b) => b.row === 1 && b.col === 8)!;
    rocket.special = "rocket";
    const hit = (br: typeof target) => {
      Object.assign(e.balls[0]!, { x: br.x + BRICK_W / 2, y: br.y + BRICK_H + BALL_R + 2, dx: 0, dy: -300 });
      for (let i = 0; i < 10 && !br.dead; i++) e.update(1 / 60);
    };
    const before = e.bricksLeft;
    hit(target);
    // Radius 1.5 brick pitches: the brick, its row neighbours ±1 and the bricks above and diagonally.
    expect(before - e.bricksLeft).toBe(6);
    const b2 = e.bricksLeft;
    hit(rocket);
    expect(b2 - e.bricksLeft).toBe(2);
    const s = e.metrics.summary();
    expect(s.special_bricks_triggered).toEqual({ exploding: 1, rocket: 1 });
    expect(s.powerup_efficiency).toBe((5 + 1) / 2);
  });

  it("an invisible brick shows on the first hit; paddle effects wear off after 10 s", () => {
    const e = new BlockEngine(cfg());
    e.serve();
    const br = e.bricks.find((b) => b.row === 1 && b.col === 2)!;
    br.special = "invisible";
    br.visible = false;
    Object.assign(e.balls[0]!, { x: br.x + BRICK_W / 2, y: br.y + BRICK_H + BALL_R + 2, dx: 0, dy: -300 });
    for (let i = 0; i < 10 && !br.visible; i++) e.update(1 / 60);
    expect(br.visible).toBe(true);
    expect(br.dead).toBe(false);
    const wide = e.bricks.find((b) => b.row === 1 && b.col === 6)!;
    wide.special = "paddle_wide";
    const w0 = e.paddleW;
    Object.assign(e.balls[0]!, { x: wide.x + BRICK_W / 2, y: wide.y + BRICK_H + BALL_R + 2, dx: 0, dy: -300 });
    for (let i = 0; i < 10 && !wide.dead; i++) e.update(1 / 60);
    expect(e.paddleW).toBeCloseTo(w0 * 1.5);
    // Keep the ball out of the way while the effect runs out.
    for (let t = 0; t < EFFECT_S + 0.5; t += 0.05) {
      Object.assign(e.balls[0]!, { x: 20, y: 400, dx: 0, dy: -1 });
      e.update(0.05);
    }
    expect(e.paddleW).toBeCloseTo(w0);
  });

  it("counts paddle reversals and ignores jitter", () => {
    const e = new BlockEngine(cfg());
    for (const x of [400, 420, 440, 430, 410, 410.5, 450, 460]) e.movePaddle(x);
    expect(e.metrics.summary().movement_reversals).toBe(2);
  });

  it("practice: one row, no score, no life events, refills and serves itself", () => {
    const e = new BlockEngine(cfg({ practice: true, difficulty: 5 }));
    expect(e.bricks).toHaveLength(10);
    expect(e.bricks.some((b) => b.special)).toBe(false);
    e.serve();
    Object.assign(e.balls[0]!, { x: BOARD_W - 30, dx: 0, dy: 300 });
    e.movePaddle(60);
    let o;
    do o = e.update(1 / 60);
    while (!o.lifeLost);
    expect(e.autoServeAt).not.toBeNull();
    expect(e.metrics.summary().lives_lost).toBe(0);
    bot(e, 120);
    expect(e.score).toBe(0);
    expect(e.phase).not.toBe("done");
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const e = new BlockEngine(cfg({ difficulty: 4, lean: "L", rng: mulberry32(42) }));
      bot(e, 60);
      return JSON.stringify([e.score, e.time.toFixed(3), e.bricks.map((b) => `${b.special ?? "-"}${b.dead ? 1 : 0}`), e.metrics.summary()]);
    };
    expect(run()).toBe(run());
  });
});

describe("settings", () => {
  it("specials off, or a fixed special rate", () => {
    expect(new BlockEngine(cfg({ difficulty: 5, specials: false })).bricks.some((b) => b.special)).toBe(false);
    const e = new BlockEngine(cfg({ difficulty: 1, specialRate: 0.25 }));
    expect(e.bricks.filter((b) => b.special)).toHaveLength(5);
  });

  it("paddle assist 1 catches the ball; a tap or 2 s lets it go", () => {
    const e = new BlockEngine(cfg({ assist: 1 }));
    e.serve();
    Object.assign(e.balls[0]!, { x: 420, y: 450, dx: 0, dy: 300 });
    e.movePaddle(400);
    for (let i = 0; i < 60 && !e.holding; i++) e.update(1 / 60);
    expect(e.holding).toBe(true);
    e.movePaddle(300);
    e.update(1 / 60);
    expect(e.balls[0]!.x).toBeCloseTo(320, 0);
    expect(e.serve()).toBe(true);
    expect(e.balls[0]!.dy).toBeLessThan(0);
    Object.assign(e.balls[0]!, { x: 300, y: 450, dx: 0, dy: 300 });
    for (let i = 0; i < 60 && !e.holding; i++) e.update(1 / 60);
    expect(e.holding).toBe(true);
    for (let i = 0; i < 21; i++) e.update(0.1);
    expect(e.holding).toBe(false);
    expect(e.metrics.summary().magnet_catches).toBe(2);
  });

  it("paddle assist 2 draws a falling ball towards the paddle", () => {
    const run = (assist: 0 | 2) => {
      const e = new BlockEngine(cfg({ assist }));
      e.serve();
      e.movePaddle(400);
      Object.assign(e.balls[0]!, { x: 400 + 95, y: 300, dx: 0, dy: 300 });
      let hit = false;
      for (let i = 0; i < 120 && e.phase === "playing"; i++) if (e.update(1 / 60).trials.some((t) => t.outcome === "hit")) hit = true;
      return hit;
    };
    expect(run(0)).toBe(false);
    expect(run(2)).toBe(true);
  });
});
