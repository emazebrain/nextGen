/**
 * Block Crasher engine (design doc §8.4, ADR 0017): paddle, balls, bricks and the eight special bricks on
 * v1's 800 × 600 board. Pure and deterministic: time comes in through update(dt), randomness from the seeded
 * rng. Session Rules owns time and lives; the engine only says when the last ball left the board.
 */
import { BlockMetrics, type Side } from "./metrics.ts";
import {
  clamp,
  DIFFICULTY,
  LAYOUTS,
  MAX_LEVEL,
  PRACTICE_LAYOUT,
  specialKinds,
  tuning,
  type Difficulty,
  type Layout,
  type SpecialKind,
} from "./levels.ts";

export const BOARD_W = 800;
export const BOARD_H = 600;
export const COLS = 10;
export const BRICK_W = 72;
export const BRICK_H = 22;
export const BRICK_GAP = 4;
export const BRICK_X0 = (BOARD_W - (COLS * (BRICK_W + BRICK_GAP) - BRICK_GAP)) / 2;
export const BRICK_Y0 = 50;
export const PADDLE_Y = 558;
export const PADDLE_H = 14;
export const BALL_R = 8;
/** v1 speeds are px per 60 Hz frame. */
const FPS = 60;
const STEP = 1 / 240;
const MAX_BALLS = 10;
/** Specials sit on the half of the board the hemisphere sees this share of the time (ADR 0017). */
export const SPECIAL_LEAN = 0.75;
export const EFFECT_S = 10;
export const GRAVITY_S = 5;
/** After a lost ball in timed mode (and in practice) the ball serves itself; a new board serves itself after a pause. */
export const AUTO_SERVE_AFTER_LOSS_S = 1;
export const AUTO_SERVE_NEW_BOARD_S = 3;
export const TIMED_LOSS_POINTS = 50;
/** Magnet assist: a caught ball lets go by itself after this long; level 2 draws a falling ball over the last stretch. */
export const HOLD_S = 2;
export const MAGNET_RANGE = 140;

export interface Brick {
  id: number;
  col: number;
  row: number;
  x: number;
  y: number;
  hp: number;
  maxHp: number;
  tough: boolean;
  special: SpecialKind | null;
  visible: boolean;
  dead: boolean;
}

export interface Ball {
  id: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** When the ball last started coming down (for the interception time). */
  descentAt: number | null;
  /** Magnet assist: caught on the paddle at this offset from its centre, until released. */
  held?: { offset: number; until: number } | null;
}

export interface EngineConfig {
  difficulty: Difficulty;
  /** 1–10; defaults to the difficulty's start level. */
  startLevel?: number;
  /** The board half most specials sit on: the half the hemisphere sees. */
  lean: Side | null;
  rng: () => number;
  practice?: boolean;
  /** Timed mode: a lost ball costs points and serves itself again. */
  timed?: boolean;
  /** Platform speed_scale (0.5–1). */
  speedScale?: number;
  /** block_crasher.specials = false: no special bricks. */
  specials?: boolean;
  /** block_crasher.special_rate: share of special bricks (0–0.25); absent = by difficulty. */
  specialRate?: number | null;
  /** block_crasher.paddle_assist: 0 off, 1 the paddle catches the ball, 2 also draws a falling ball towards it. */
  assist?: 0 | 1 | 2;
}

export interface TrialOut {
  ballId: number;
  outcome: "hit" | "miss";
  x: number;
  side: Side;
  descentAt: number | null;
  interceptMs: number | null;
}

export interface LevelOut {
  level: number;
  durationS: number;
  scoreDelta: number;
  bricks: number;
  ballsLost: number;
  livesLost: number;
  paddleHits: number;
  specials: number;
}

export interface UpdateOut {
  trials: TrialOut[];
  bricksHit: Brick[];
  specials: { kind: SpecialKind; kills: number; at: Brick }[];
  lifeLost: { side: Side } | null;
  served: boolean;
  levelCleared: LevelOut | null;
  done: boolean;
}

export type Phase = "serving" | "playing" | "done";

export class BlockEngine {
  readonly difficulty: Difficulty;
  readonly startLevel: number;
  readonly practice: boolean;
  readonly timed: boolean;
  readonly metrics: BlockMetrics;
  level: number;
  layout!: Layout;
  bricks: Brick[] = [];
  balls: Ball[] = [];
  paddleX = BOARD_W / 2;
  basePaddle = 130;
  baseSpeed = 3.5;
  phase: Phase = "serving";
  score = 0;
  time = 0;
  /** Effects: until when (engine seconds); 0 = off. */
  slowUntil = 0;
  paddleMult = 1;
  paddleUntil = 0;
  gravityUntil = 0;
  /** When the ball serves itself, or null to wait for the child. */
  autoServeAt: number | null = null;
  private cfg: EngineConfig;
  private nextId = 1;
  private idleFor = 0;
  private lvl = { start: 0, score: 0, bricks: 0, ballsLost: 0, livesLost: 0, paddleHits: 0, specials: 0 };

  constructor(cfg: EngineConfig) {
    this.cfg = cfg;
    this.difficulty = cfg.difficulty;
    this.practice = !!cfg.practice;
    this.timed = !!cfg.timed;
    this.startLevel = clamp(Math.round(cfg.startLevel ?? DIFFICULTY[cfg.difficulty].startLevel), 1, MAX_LEVEL);
    this.level = this.practice ? 1 : this.startLevel;
    this.metrics = new BlockMetrics(this.level);
    this.load();
  }

  get paddleW() {
    return clamp(this.basePaddle * this.paddleMult, 50, 240);
  }

  /** Current ball speed in px per second. */
  get speed() {
    const scale = clamp(this.cfg.speedScale ?? 1, 0.5, 1);
    return this.baseSpeed * FPS * scale * (this.time < this.slowUntil ? 0.6 : 1);
  }

  get bricksLeft() {
    return this.bricks.filter((b) => !b.dead).length;
  }

  // ------------------------------------------------------------ boards

  private load() {
    if (this.practice) {
      this.layout = PRACTICE_LAYOUT;
      this.baseSpeed = PRACTICE_LAYOUT.speed;
      this.basePaddle = PRACTICE_LAYOUT.paddle;
    } else {
      this.layout = LAYOUTS[this.level - 1]!;
      const t = tuning(this.difficulty, this.level, this.startLevel);
      this.baseSpeed = t.speed;
      this.basePaddle = t.paddle;
    }
    this.bricks = [];
    this.layout.pattern.forEach((row, r) =>
      row.forEach((cell, c) => {
        if (!cell) return;
        const tough = cell === 2;
        this.bricks.push({
          id: this.nextId++,
          col: c,
          row: r,
          x: BRICK_X0 + c * (BRICK_W + BRICK_GAP),
          y: BRICK_Y0 + r * (BRICK_H + BRICK_GAP),
          hp: tough ? 2 : 1,
          maxHp: tough ? 2 : 1,
          tough,
          special: null,
          visible: true,
          dead: false,
        });
      }),
    );
    if (!this.practice) this.assignSpecials();
    this.resetEffects();
    this.balls = [this.restingBall()];
    this.phase = "serving";
    this.lvl = { start: this.time, score: 0, bricks: 0, ballsLost: 0, livesLost: 0, paddleHits: 0, specials: 0 };
  }

  /** v1's share and pairs, scaled by difficulty; three in four on the hemisphere's half (ADR 0017). */
  private assignSpecials() {
    if (this.cfg.specials === false) return;
    let kinds = specialKinds(this.difficulty, this.level, this.cfg.rng);
    const own = this.cfg.specialRate;
    const rate = typeof own === "number" && own >= 0 ? clamp(own, 0, 0.25) : DIFFICULTY[this.difficulty].specialRate;
    // A rate set by the therapist at difficulty 1 still needs kinds: v1's pair for the level.
    if (!kinds.length && rate > 0) kinds = specialKinds(2, this.level, this.cfg.rng);
    if (!kinds.length || rate <= 0) return;
    const count = Math.min(this.bricks.length, Math.max(1, Math.round(this.bricks.length * rate)));
    const rng = this.cfg.rng;
    for (let i = 0; i < count; i++) {
      const free = this.bricks.filter((b) => !b.special);
      let half: Side | null = null;
      if (this.cfg.lean) half = rng() < SPECIAL_LEAN ? this.cfg.lean : this.cfg.lean === "L" ? "R" : "L";
      else half = rng() < 0.5 ? "L" : "R";
      const inHalf = free.filter((b) => (b.col < COLS / 2 ? "L" : "R") === half);
      const pool = inHalf.length ? inHalf : free;
      const b = pool[Math.floor(rng() * pool.length)]!;
      b.special = kinds[Math.floor(rng() * kinds.length)]!;
      if (b.special === "invisible") b.visible = false;
    }
  }

  private resetEffects() {
    this.slowUntil = 0;
    this.paddleMult = 1;
    this.paddleUntil = 0;
    this.gravityUntil = 0;
  }

  private restingBall(): Ball {
    return { id: this.nextId++, x: this.paddleX, y: PADDLE_Y - BALL_R - 1, dx: 0, dy: 0, descentAt: null };
  }

  // ------------------------------------------------------------ input

  /** Moves the paddle centre to x (board px). */
  movePaddle(x: number) {
    const w = this.paddleW;
    const nx = clamp(x, w / 2, BOARD_W - w / 2);
    const dx = nx - this.paddleX;
    if (Math.abs(dx) > 0.01) {
      if (!this.practice) this.metrics.paddleMove(dx);
      this.idleFor = 0;
    }
    this.paddleX = nx;
  }

  /** Launches the resting ball, or lets go of caught balls. Returns false when there is nothing to launch. */
  serve(): boolean {
    if (this.phase === "playing") return this.release();
    if (this.phase !== "serving") return false;
    const b = this.balls[0] ?? this.restingBall();
    this.balls = [b];
    const a = (this.cfg.rng() - 0.5) * 0.6;
    const sp = this.speed;
    b.dx = sp * Math.sin(a);
    b.dy = -sp * Math.cos(a);
    b.descentAt = null;
    this.phase = "playing";
    this.autoServeAt = null;
    this.idleFor = 0;
    return true;
  }

  /** Lets go of every caught ball, aimed by where it sits on the paddle (like a bounce). */
  release(): boolean {
    let any = false;
    for (const b of this.balls) if (b.held) any = this.letGo(b) || any;
    if (any) this.idleFor = 0;
    return any;
  }

  private letGo(b: Ball): boolean {
    if (!b.held) return false;
    const sp = this.speed;
    const pos = clamp(b.held.offset / this.paddleW + 0.5, 0, 1);
    const a = (pos - 0.5) * Math.PI * 0.7;
    b.dx = sp * Math.sin(a);
    b.dy = -Math.abs(sp * Math.cos(a));
    b.held = null;
    return true;
  }

  get holding() {
    return this.balls.some((b) => b.held);
  }

  // ------------------------------------------------------------ time

  update(dt: number): UpdateOut {
    const out: UpdateOut = { trials: [], bricksHit: [], specials: [], lifeLost: null, served: false, levelCleared: null, done: false };
    if (this.phase === "done") return out;
    let left = Math.min(0.25, Math.max(0, dt));
    while (left > 1e-9) {
      const h = Math.min(STEP, left);
      left -= h;
      this.step(h, out);
      if (out.levelCleared || out.done) break;
    }
    return out;
  }

  private step(h: number, out: UpdateOut) {
    const wasSlow = this.time < this.slowUntil;
    this.time += h;
    if (this.paddleUntil && this.time >= this.paddleUntil) {
      this.paddleMult = 1;
      this.paddleUntil = 0;
    }
    if (wasSlow && this.time >= this.slowUntil) this.renormalise();
    // Keep the paddle inside the board when its width changes.
    this.paddleX = clamp(this.paddleX, this.paddleW / 2, BOARD_W - this.paddleW / 2);

    if (this.phase === "serving") {
      const b = this.balls[0];
      if (b) {
        b.x = this.paddleX;
        b.y = PADDLE_Y - BALL_R - 1;
      }
      if (this.autoServeAt !== null && this.time >= this.autoServeAt) out.served = this.serve() || out.served;
      return;
    }

    if (!this.practice) {
      this.metrics.playS += h;
      this.idleFor += h;
      // Inactivity counts once the paddle has been still for over a second (v1 idle_seconds).
      if (this.idleFor > 1) this.metrics.idleS += h;
    }
    const sp = this.speed;
    const gravity = this.time < this.gravityUntil;
    const assist = this.cfg.assist ?? 0;
    for (let i = this.balls.length - 1; i >= 0; i--) {
      const b = this.balls[i]!;
      if (b.held) {
        b.x = clamp(this.paddleX + b.held.offset, BALL_R, BOARD_W - BALL_R);
        b.y = PADDLE_Y - BALL_R - 1;
        if (this.time >= b.held.until) this.letGo(b);
        continue;
      }
      const wasDown = b.dy > 0;
      if (assist >= 2 && b.dy > 0 && PADDLE_Y - b.y < MAGNET_RANGE) {
        // A gentle pull towards the paddle over the last stretch (paddle_assist 2).
        b.x += (this.paddleX - b.x) * Math.min(1, 1.2 * h);
      }
      if (gravity && b.dy > 0) b.dy += 0.02 * FPS * FPS * h; // v1: +0.02 px/frame² while falling
      b.x += b.dx * h;
      b.y += b.dy * h;
      if (b.x - BALL_R <= 0) {
        b.x = BALL_R;
        b.dx = Math.abs(b.dx);
      } else if (b.x + BALL_R >= BOARD_W) {
        b.x = BOARD_W - BALL_R;
        b.dx = -Math.abs(b.dx);
      }
      if (b.y - BALL_R <= 0) {
        b.y = BALL_R;
        b.dy = Math.abs(b.dy);
      }
      // Paddle.
      const w = this.paddleW;
      const px = this.paddleX - w / 2;
      if (b.dy > 0 && b.y + BALL_R >= PADDLE_Y && b.y + BALL_R <= PADDLE_Y + PADDLE_H + 8 && b.x >= px - BALL_R && b.x <= px + w + BALL_R) {
        b.y = PADDLE_Y - BALL_R;
        const pos = clamp((b.x - px) / w, 0, 1);
        const a = (pos - 0.5) * Math.PI * 0.7;
        b.dx = sp * Math.sin(a);
        b.dy = -Math.abs(sp * Math.cos(a));
        const side: Side = b.x < BOARD_W / 2 ? "L" : "R";
        const interceptMs = b.descentAt === null ? null : Math.round((this.time - b.descentAt) * 1000);
        if (!this.practice) {
          this.metrics.paddleHit(b.x - this.paddleX, side, interceptMs);
          this.lvl.paddleHits += 1;
        }
        out.trials.push({ ballId: b.id, outcome: "hit", x: b.x, side, descentAt: b.descentAt, interceptMs });
        b.descentAt = null;
        if (assist >= 1) {
          b.held = { offset: clamp(b.x - this.paddleX, -w / 2, w / 2), until: this.time + HOLD_S };
          b.dx = 0;
          b.dy = 0;
          if (!this.practice) this.metrics.catches += 1;
          continue;
        }
      }
      // Bricks: the first one touched this step.
      for (const br of this.bricks) {
        if (br.dead) continue;
        if (b.x + BALL_R > br.x && b.x - BALL_R < br.x + BRICK_W && b.y + BALL_R > br.y && b.y - BALL_R < br.y + BRICK_H) {
          const oL = b.x + BALL_R - br.x;
          const oR = br.x + BRICK_W - (b.x - BALL_R);
          const oT = b.y + BALL_R - br.y;
          const oB = br.y + BRICK_H - (b.y - BALL_R);
          const m = Math.min(oL, oR, oT, oB);
          if (m === oL) {
            b.dx = -Math.abs(b.dx);
            b.x -= oL;
          } else if (m === oR) {
            b.dx = Math.abs(b.dx);
            b.x += oR;
          } else if (m === oT) {
            b.dy = -Math.abs(b.dy);
            b.y -= oT;
          } else {
            b.dy = Math.abs(b.dy);
            b.y += oB;
          }
          this.hitBrick(br, b, out);
          break;
        }
      }
      this.keepSteep(b);
      if (!wasDown && b.dy > 0) b.descentAt = this.time;
      if (b.y - BALL_R > BOARD_H) {
        this.balls.splice(i, 1);
        const side: Side = b.x < BOARD_W / 2 ? "L" : "R";
        if (!this.practice) {
          this.metrics.ballLost(side);
          this.lvl.ballsLost += 1;
        }
        out.trials.push({ ballId: b.id, outcome: "miss", x: b.x, side, descentAt: b.descentAt, interceptMs: null });
        if (this.balls.length === 0) {
          out.lifeLost = { side };
          this.onLastBallLost();
        }
      }
    }
    if (this.bricksLeft === 0) this.onBoardCleared(out);
  }

  /** v1 renormalises the speed when the slow-down ends. */
  private renormalise() {
    const sp = this.speed;
    for (const b of this.balls) {
      const cs = Math.hypot(b.dx, b.dy);
      if (cs > 0) {
        b.dx = (b.dx / cs) * sp;
        b.dy = (b.dy / cs) * sp;
      }
    }
  }

  /** Never let a ball run almost flat (it would bounce between the walls for ever). */
  private keepSteep(b: Ball) {
    const s = Math.hypot(b.dx, b.dy);
    if (s === 0) return;
    const minDy = s * 0.25;
    if (Math.abs(b.dy) < minDy) {
      b.dy = (b.dy < 0 ? -1 : 1) * minDy;
      b.dx = Math.sign(b.dx || 1) * Math.sqrt(Math.max(0, s * s - minDy * minDy));
    }
  }

  private kill(br: Brick, out: UpdateOut) {
    br.dead = true;
    br.hp = 0;
    this.addScore(10);
    if (!this.practice) {
      this.metrics.brick(br.tough);
      this.lvl.bricks += 1;
    }
    out.bricksHit.push(br);
  }

  private hitBrick(br: Brick, ball: Ball, out: UpdateOut) {
    if (br.special === "invisible" && !br.visible) {
      br.visible = true; // the first hit reveals it (v1)
      this.addScore(5);
      this.trigger("invisible", 0, br, out);
      return;
    }
    br.hp -= 1;
    if (br.hp > 0) {
      this.addScore(5);
      out.bricksHit.push(br);
      return;
    }
    this.kill(br, out);
    const sp = this.speed;
    switch (br.special) {
      case "exploding": {
        const cx = br.x + BRICK_W / 2;
        const cy = br.y + BRICK_H / 2;
        const r = (BRICK_W + BRICK_GAP) * 1.5;
        let kills = 0;
        for (const o of this.bricks) {
          if (o.dead || Math.hypot(o.x + BRICK_W / 2 - cx, o.y + BRICK_H / 2 - cy) > r) continue;
          this.kill(o, out);
          kills += 1;
        }
        this.trigger("exploding", kills, br, out);
        break;
      }
      case "rocket": {
        let kills = 0;
        for (const o of this.bricks) {
          if (o.dead || o.col !== br.col) continue;
          this.kill(o, out);
          kills += 1;
        }
        this.trigger("rocket", kills, br, out);
        break;
      }
      case "slow_down":
        this.slowUntil = this.time + EFFECT_S;
        this.renormalise();
        this.trigger("slow_down", 0, br, out);
        break;
      case "paddle_thin":
        this.paddleMult = 0.7;
        this.paddleUntil = this.time + EFFECT_S;
        this.trigger("paddle_thin", 0, br, out);
        break;
      case "paddle_wide":
        this.paddleMult = 1.5;
        this.paddleUntil = this.time + EFFECT_S;
        this.trigger("paddle_wide", 0, br, out);
        break;
      case "multi_ball": {
        for (let j = 0; j < 2 && this.balls.length < MAX_BALLS; j++) {
          const a = -Math.PI / 2 + (this.cfg.rng() - 0.5) * Math.PI * 0.7;
          this.balls.push({ id: this.nextId++, x: ball.x, y: ball.y, dx: sp * Math.cos(a), dy: sp * Math.sin(a), descentAt: null });
        }
        this.trigger("multi_ball", 0, br, out);
        break;
      }
      case "gravity":
        this.gravityUntil = this.time + GRAVITY_S;
        this.trigger("gravity", 0, br, out);
        break;
      default:
        break;
    }
  }

  private trigger(kind: SpecialKind, kills: number, at: Brick, out: UpdateOut) {
    if (!this.practice) {
      this.metrics.special(kind, kills);
      this.lvl.specials += 1;
    }
    out.specials.push({ kind, kills, at });
  }

  private addScore(n: number) {
    if (this.practice) return;
    this.score += n;
    this.lvl.score += n;
  }

  private onLastBallLost() {
    this.resetEffects();
    this.balls = [this.restingBall()];
    this.phase = "serving";
    if (this.practice) {
      this.autoServeAt = this.time + AUTO_SERVE_AFTER_LOSS_S;
      return;
    }
    this.metrics.livesLost += 1;
    this.lvl.livesLost += 1;
    if (this.timed) {
      // §8.4: in timed mode a lost ball costs 50 points and serves itself again.
      const loss = Math.min(this.score, TIMED_LOSS_POINTS);
      this.score -= loss;
      this.lvl.score -= loss;
      this.autoServeAt = this.time + AUTO_SERVE_AFTER_LOSS_S;
    } else {
      this.autoServeAt = null;
    }
  }

  private onBoardCleared(out: UpdateOut) {
    if (this.practice) {
      // Practice refills its one row until the 30 s are up.
      this.load();
      this.autoServeAt = this.time + AUTO_SERVE_AFTER_LOSS_S;
      return;
    }
    this.addScore(50);
    const l = this.lvl;
    out.levelCleared = {
      level: this.level,
      durationS: this.time - l.start,
      scoreDelta: l.score,
      bricks: l.bricks,
      ballsLost: l.ballsLost,
      livesLost: l.livesLost,
      paddleHits: l.paddleHits,
      specials: l.specials,
    };
    this.metrics.levelsCompleted += 1;
    if (this.level >= MAX_LEVEL) {
      this.phase = "done";
      this.balls = [];
      out.done = true;
      return;
    }
    this.level += 1;
    this.metrics.highestLevel = Math.max(this.metrics.highestLevel, this.level);
    this.load();
    this.autoServeAt = this.time + AUTO_SERVE_NEW_BOARD_S;
  }

  /** The level in progress, for the history row when the session ends mid-board. */
  levelSoFar(): LevelOut {
    const l = this.lvl;
    return {
      level: this.level,
      durationS: this.time - l.start,
      scoreDelta: l.score,
      bricks: l.bricks,
      ballsLost: l.ballsLost,
      livesLost: l.livesLost,
      paddleHits: l.paddleHits,
      specials: l.specials,
    };
  }
}
