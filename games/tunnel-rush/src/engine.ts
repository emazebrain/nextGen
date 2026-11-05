/**
 * Tunnel Rush logic (ported from v1 `engine.js`), pure: no clock, no DOM, no
 * Math.random. The renderer calls `update(dt)` with pause-adjusted seconds.
 *
 * Single-lane objects ride the inside of the tunnel towards the ship. An object
 * hits only when the lane facing the ship on arrival is its lane; every other
 * lane is open. Steering rolls the tunnel one lane (or, in move mode, slides the
 * ship); `rotation` adds an ambient spin the child has to correct for. Speed
 * adapts inside the difficulty band: clean dodges creep it up, a bump eases it
 * down and slows the run for half a second.
 *
 * Lanes and sides: lane offsets are counted from the ship's lane, positive to
 * the ship's left (anticlockwise on screen), negative to its right.
 */
import { clamp, DIFFICULTY, HIT_SLOW_S, LEVEL_SPEED_BONUS, MAX_LEVEL, OBSTACLES_PER_LEVEL, VIEW_DEPTH, type Difficulty, type Glyph } from "./config.ts";

export type Spin = "none" | "cw" | "ccw" | "alternate";
export type Side = "L" | "R" | "C";

export interface EngineConfig {
  lanes: number;
  difficulty: Difficulty;
  startLevel: number;
  progressive: boolean;
  spin: Spin;
  spinDegPerS: number;
  /**
   * Hemisphere lean (ADR 0014): the screen side, relative to the ship, that most new objects appear on
   * (p = 0.75), or null for even placement (practice).
   */
  lean: "L" | "R" | null;
  pool: Glyph[];
  rng: () => number;
}

export interface Obstacle {
  id: number;
  z: number;
  lane: number;
  glyph: Glyph;
  resolved: boolean;
  /** Engine seconds when it came into view. */
  spawnedAt: number;
  lastSteerAt: number | null;
  /** Side of the ship it appeared on, and whether it was in the ship's lane then. */
  spawnSide: Side;
  threat: boolean;
  /** Already on screen before the run started: no reaction time (the child saw it while waiting). */
  preview: boolean;
}

export interface Pass {
  obstacle: Obstacle;
  hit: boolean;
  /** Last steer before arrival, from when the object came into view. Null if the child never steered for it. */
  reactionMs: number | null;
  speed: number;
  level: number;
}

const randInt = (lo: number, hi: number, rng: () => number) => lo + Math.floor(rng() * (hi - lo + 1));

export class TunnelEngine {
  readonly arc: number;
  readonly band: (typeof DIFFICULTY)[Difficulty];
  time = 0;
  scroll = 0;
  /** Logical tunnel angle (radians): steering moves it by whole lanes, spin moves it smoothly. */
  angle = 0;
  speed: number;
  level: number;
  steers = 0;
  obstacles: Obstacle[] = [];
  passedCount = 0;
  private spinSign: 1 | -1;
  private altTimer = 0;
  private hitSlow = 0;
  private nextZ = 4; // a grace gap before the first object
  private lastLane: number;
  private spawned = 0;

  constructor(private readonly cfg: EngineConfig) {
    this.arc = (Math.PI * 2) / cfg.lanes;
    this.band = DIFFICULTY[cfg.difficulty];
    this.level = clamp(cfg.startLevel, 1, MAX_LEVEL);
    this.speed = this.band.speedMin;
    this.spinSign = cfg.spin === "ccw" ? -1 : 1;
    this.lastLane = randInt(0, cfg.lanes - 1, cfg.rng);
    // The first objects are already in view on the start screen; they wait for the first steer.
    while (this.nextZ < VIEW_DEPTH) {
      this.obstacles.push(this.makeObstacle(this.nextZ));
      this.nextZ += this.spacing();
    }
  }

  get lanes() {
    return this.cfg.lanes;
  }

  bandMin() {
    return this.band.speedMin;
  }
  bandMax() {
    return this.band.speedMax * (1 + LEVEL_SPEED_BONUS * (this.level - 1));
  }
  spacing() {
    return Math.max(2.2, this.band.spacing - (this.level - 1) * 0.06);
  }
  private speedStep() {
    return (this.bandMax() - this.bandMin()) / 10;
  }
  /** 0…1 position of the current speed inside the band (for the exhaust flame). */
  speedRatio() {
    return clamp((this.speed - this.bandMin()) / Math.max(0.01, this.bandMax() - this.bandMin()), 0, 1);
  }

  /** The lane in front of the ship. */
  facing(): number {
    const f = Math.round(-this.angle / this.arc);
    return ((f % this.lanes) + this.lanes) % this.lanes;
  }

  /** Signed lane offset of `lane` from the ship's lane, in (−lanes/2, lanes/2]. */
  offsetOf(lane: number): number {
    const L = this.lanes;
    let d = (((lane - this.facing()) % L) + L) % L;
    if (d > L / 2) d -= L;
    return d;
  }

  sideOf(lane: number): Side {
    const d = this.offsetOf(lane);
    return d === 0 || d === this.lanes / 2 ? "C" : d > 0 ? "L" : "R";
  }

  /** dir −1 = steer left, +1 = steer right. The ship ends up one lane over in that direction. */
  steer(dir: -1 | 1) {
    // A lane to the ship's right has a negative offset, so steering right means facing a lower lane index.
    this.angle += dir * this.arc;
    this.steers += 1;
    const next = this.obstacles.find((o) => !o.resolved);
    if (next) next.lastSteerAt = this.time;
  }

  private makeObstacle(z: number): Obstacle {
    const L = this.lanes;
    const jump = randInt(1, this.band.maxJump, this.cfg.rng);
    const a = (((this.lastLane + jump) % L) + L) % L;
    const b = (((this.lastLane - jump) % L) + L) % L;
    let lane: number;
    const lean = this.cfg.lean;
    const onLean = (l: number) => lean !== null && this.sideOf(l) === lean;
    if (lean !== null && onLean(a) !== onLean(b)) {
      // One candidate is on the lean side: take it three times in four.
      const preferred = onLean(a) ? a : b;
      lane = this.cfg.rng() < 0.75 ? preferred : preferred === a ? b : a;
    } else if (lean !== null && !onLean(a) && !onLean(b)) {
      // Neither is: half the time, jump to a reachable lane on the lean side instead. Overall about 3 in 4 side
      // objects land on the lean side (77–85 % for 6–12 lanes in simulation).
      lane = this.cfg.rng() < 0.5 ? a : b;
      if (this.cfg.rng() < 0.5) {
        const reach = Array.from({ length: L }, (_, i) => i).filter((l) => onLean(l) && Math.abs(this.offsetOf(l)) <= this.band.maxJump);
        if (reach.length) lane = reach[Math.floor(this.cfg.rng() * reach.length)]!;
      }
    } else {
      lane = this.cfg.rng() < 0.5 ? a : b;
    }
    // Grace: the very first object never starts in the ship's lane.
    if (this.spawned === 0 && lane === this.facing()) lane = (lane + 1) % L;
    this.lastLane = lane;
    const glyph = this.cfg.pool.length ? this.cfg.pool[Math.floor(this.cfg.rng() * this.cfg.pool.length)]! : { kind: "shape" as const, label: "square" };
    this.spawned += 1;
    return { id: this.spawned, z, lane, glyph, resolved: false, spawnedAt: this.time, lastSteerAt: null, spawnSide: this.sideOf(lane), threat: lane === this.facing(), preview: this.time === 0 };
  }

  /** Advances the run by `dt` seconds. Returns the objects that reached the ship and a level-up, if any. */
  update(dt: number): { passed: Pass[]; levelUp: number | null } {
    this.time += dt;
    const slow = this.hitSlow > 0 ? 0.5 : 1;
    this.hitSlow = Math.max(0, this.hitSlow - dt);
    this.scroll += this.speed * slow * dt;
    if (this.cfg.spin !== "none") {
      if (this.cfg.spin === "alternate") {
        this.altTimer += dt;
        if (this.altTimer >= 6) {
          this.spinSign = this.spinSign === 1 ? -1 : 1;
          this.altTimer = 0;
        }
      }
      this.angle += ((this.cfg.spinDegPerS * Math.PI) / 180) * dt * this.spinSign;
    }
    while (this.nextZ < this.scroll + VIEW_DEPTH) {
      this.obstacles.push(this.makeObstacle(this.nextZ));
      this.nextZ += this.spacing();
    }
    const passed: Pass[] = [];
    let levelUp: number | null = null;
    for (const o of this.obstacles) {
      if (o.resolved || o.z - this.scroll > 0) continue;
      o.resolved = true;
      const hit = this.facing() === o.lane;
      const reactionMs = o.lastSteerAt !== null && !o.preview ? Math.max(0, Math.round((o.lastSteerAt - o.spawnedAt) * 1000)) : null;
      if (hit) {
        this.hitSlow = HIT_SLOW_S;
        this.speed = Math.max(this.bandMin(), this.speed - this.speedStep() * 2.5);
      } else {
        this.speed = Math.min(this.bandMax(), this.speed + this.speedStep());
      }
      passed.push({ obstacle: o, hit, reactionMs, speed: Math.round(this.speed * 1000) / 1000, level: this.level });
      this.passedCount += 1;
      if (this.cfg.progressive && this.passedCount % OBSTACLES_PER_LEVEL === 0 && this.level < MAX_LEVEL) {
        this.level += 1;
        levelUp = this.level;
      }
    }
    this.obstacles = this.obstacles.filter((o) => o.z - this.scroll > -0.5);
    return { passed, levelUp };
  }
}
