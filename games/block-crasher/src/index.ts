/**
 * Block Crasher (design doc §8.4) on the eMazeBrain Game SDK. The engine (engine.ts) owns the physics on v1's
 * 800 × 600 board; this file draws it in Pixi, takes input and reports to Session Rules, which owns time and
 * lives. The last ball leaving the board is reported as `ball_lost`; Session Rules ignores a second one inside
 * the manifest's 1 s grace.
 *
 * Look by hemisphere: left → warm "Canyon Fort", right → cold "Glacier Castle". Three in four special bricks sit
 * on the half of the board that hemisphere sees (ADR 0017). Art and sound are made in code until the commissioned
 * assets arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, PauseReason, SessionStatus } from "@emb/game-sdk";
import { BALL_R, BlockEngine, BOARD_H, BOARD_W, BRICK_H, BRICK_W, PADDLE_H, PADDLE_Y, type Brick, type LevelOut, type UpdateOut } from "./engine.ts";
import { clamp, PRACTICE_S, type Difficulty, type SpecialKind } from "./levels.ts";
import { Sfx } from "./sound.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const KEY_SPEED = 720; // board px per second while an arrow key is held
const TOP_INSET = 72; // the host's HUD (timer, hearts) sits above the board
const BOTTOM_INSET = 20;

interface Look {
  sky: [string, string];
  far: string;
  near: string;
  glow: string;
  panel: string;
  edge: string;
  rows: Array<[string, string]>;
  tough: [string, string];
  crack: string;
  glyph: string;
  emboss: string;
  paddle: string;
  paddleTrim: string;
  ball: [string, string];
  ballGlow: string;
  particle: string[];
  say: string;
}

/** Warm "Canyon Fort" and cold "Glacier Castle" (design doc §8.4 asset table). */
const LOOKS: Record<"warm" | "cold" | "mono", Look> = {
  warm: {
    sky: ["#FFB547", "#B8322B"],
    far: "#C2502F",
    near: "#7A2420",
    glow: "#FFE2B0",
    panel: "#3D1410",
    edge: "#FFB547",
    rows: [["#FF8F3D", "#E0702A"], ["#E0483A", "#B8322B"], ["#F2A65A", "#D6823A"], ["#C9573A", "#9E3A26"]],
    tough: ["#8A4B32", "#5E2E1E"],
    crack: "#2A0C08",
    glyph: "#FFF4D0",
    emboss: "#FFD36B",
    paddle: "#7A2420",
    paddleTrim: "#FFB547",
    ball: ["#FFF4D0", "#FFB547"],
    ballGlow: "#FFD36B",
    particle: ["#FFB547", "#E0702A", "#FFE2B0"],
    say: "#FFB547",
  },
  cold: {
    sky: ["#6CC4E8", "#232C6B"],
    far: "#3D63D6",
    near: "#1B2A5A",
    glow: "#F0F7FF",
    panel: "#0E1530",
    edge: "#9FE3F5",
    rows: [["#2FB3C8", "#1F8FA3"], ["#3D63D6", "#2C49A8"], ["#6CC4E8", "#3E9CC4"], ["#5470E0", "#3A52B8"]],
    tough: ["#DDF4FF", "#9CCBE6"],
    crack: "#232C6B",
    glyph: "#FFFFFF",
    emboss: "#F0F7FF",
    paddle: "#F0F7FF",
    paddleTrim: "#6CC4E8",
    ball: ["#FFFFFF", "#CFEFFF"],
    ballGlow: "#9FE3F5",
    particle: ["#F0F7FF", "#9FE3F5", "#6CC4E8"],
    say: "#9FE3F5",
  },
  mono: {
    sky: ["#BDBDBD", "#3A3A3A"],
    far: "#7A7A7A",
    near: "#2E2E2E",
    glow: "#F5F5F5",
    panel: "#1A1A1A",
    edge: "#E0E0E0",
    rows: [["#E6E6E6", "#BDBDBD"], ["#9E9E9E", "#7A7A7A"], ["#CFCFCF", "#A8A8A8"], ["#8A8A8A", "#666666"]],
    tough: ["#5A5A5A", "#3A3A3A"],
    crack: "#111111",
    glyph: "#FFFFFF",
    emboss: "#FFFFFF",
    paddle: "#E0E0E0",
    paddleTrim: "#FFFFFF",
    ball: ["#FFFFFF", "#CCCCCC"],
    ballGlow: "#FFFFFF",
    particle: ["#FFFFFF", "#BDBDBD"],
    say: "#FFFFFF",
  },
};

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
}

interface Timer {
  left: number;
  fn: () => void;
}

class BlockCrasher implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private engine!: BlockEngine;
  private kind: "practice" | "main" | null = null;
  private difficulty: Difficulty = 3;
  private specials = true;
  private specialRate: number | null = null;
  private assist: 0 | 1 | 2 = 0;
  private sfx!: Sfx;
  private board = new Container();
  private bg = new Graphics();
  private frame = new Graphics();
  private bricksG = new Graphics();
  private fx = new Graphics();
  private paddleG = new Graphics();
  private ballsG = new Graphics();
  private particles: Particle[] = [];
  private trails = new Map<number, Array<[number, number]>>();
  private bricksDirty = true;
  private squash = 0;
  private scale = 1;
  private accepting = false;
  private paused = false;
  private ended = false;
  private qualified = false;
  private practiceLeft = 0;
  private practiceDone: (() => void) | null = null;
  private lastFrame: number | null = null;
  private timers: Timer[] = [];
  private keys = { left: false, right: false };
  private pressing = false;
  private wasHolding = false;
  private trialN = 0;
  private msg!: HTMLDivElement;
  private status!: HTMLDivElement;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`block_crasher.${k}`];
    this.look = LOOKS[ctx.monochrome ? "mono" : ctx.palette];
    this.difficulty = p.difficulty;
    this.specials = own("specials") !== false;
    const rate = own("special_rate");
    this.specialRate = typeof rate === "number" && rate >= 0 ? clamp(rate, 0, 0.25) : null;
    const a = Number(own("paddle_assist"));
    this.assist = a === 1 || a === 2 ? a : 0;
    this.sfx = new Sfx(ctx.palette, p.sound !== "off");

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the game's DOM text carries meaning
    ctx.mount.appendChild(this.app.canvas);
    ctx.mount.style.touchAction = "none"; // dragging the paddle must not scroll the page
    this.board.addChild(this.frame, this.bricksG, this.fx, this.paddleG, this.ballsG);
    this.app.stage.addChild(this.bg, this.board);
    this.buildDom();
    this.layout();
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((tk) => this.tick(tk));
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup", this.onKeyUp);
    ctx.mount.addEventListener("pointerdown", this.onPointerDown);
    ctx.mount.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    ctx.session.onEnd(() => {
      this.ended = true;
    });
    // Show the first board behind the instructions.
    this.newEngine("main");
  }

  async startPractice(): Promise<{ trials: number }> {
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.newEngine("practice");
      this.practiceLeft = PRACTICE_S;
      this.accepting = true;
      this.say(this.ctx.t("practice"), 0);
    });
    return { trials: 1 };
  }

  start(): void {
    this.newEngine("main");
    this.accepting = true;
    this.say(this.ctx.t("start"), 0);
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
    this.keys = { left: false, right: false };
    this.sfx.suspend();
  }

  resume(): void {
    this.paused = false;
    this.lastFrame = null;
    this.sfx.resume();
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.accepting = false;
    if (this.kind === "main") {
      const l = this.engine.levelSoFar();
      if (l.paddleHits + l.ballsLost + l.bricks > 0) this.reportLevel(l, this.qualified ? "timeout" : "failed");
    }
    const m = this.engine.metrics.summary();
    return {
      ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)),
      score: this.engine.score,
      start_level: this.engine.startLevel,
      specials: this.specials ? 1 : 0,
      special_rate: this.specialRate ?? -1,
      paddle_assist: this.assist,
    } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("pointerup", this.onPointerUp);
    this.sfx.close();
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private newEngine(kind: "practice" | "main") {
    const practice = kind === "practice";
    const p = this.ctx.params;
    this.kind = kind;
    this.engine = new BlockEngine({
      difficulty: this.difficulty,
      ...(typeof p.start_level === "number" ? { startLevel: p.start_level } : {}),
      // Left hemisphere sees the right visual field: specials lean to the board's right half (ADR 0017).
      lean: p.hemisphere === "right" ? "L" : "R",
      rng: this.ctx.rng,
      practice,
      timed: p.session_mode === "timed",
      speedScale: typeof p.speed_scale === "number" ? p.speed_scale : 1,
      specials: this.specials,
      specialRate: this.specialRate,
      assist: this.assist,
    });
    this.particles = [];
    this.trails.clear();
    this.bricksDirty = true;
    this.updateStatus();
  }

  private serve() {
    if (!this.accepting || this.ended || this.paused || !this.kind) return;
    const e = this.engine;
    const serving = e.phase === "serving";
    if (!e.serve()) return;
    this.sfx.unlock();
    if (serving) this.msg.innerHTML = "";
    if (this.kind === "main" && !this.qualified) {
      this.qualified = true;
      this.ctx.session.qualifyingInteraction(); // the clock starts on the first serve (§8.4)
    }
  }

  private onUpdate(out: UpdateOut) {
    const main = this.kind === "main";
    for (const t of out.trials) {
      if (t.outcome === "hit") {
        this.sfx.paddle();
        this.squash = 0.15;
      }
      if (!main) continue;
      this.trialN += 1;
      const at = this.toScreen(t.x, PADDLE_Y);
      this.ctx.session.trial({
        trialId: `${this.trialN}`,
        level: this.engine.level,
        stimulusOnMs: Math.round((t.descentAt ?? this.engine.time) * 1000),
        responseMs: t.interceptMs,
        outcome: t.outcome === "hit" ? "correct" : "omission",
        target: { x: Math.round(at.x), y: Math.round(at.y), hemifield: t.side },
        tags: { ball: t.ballId, assist: this.assist },
      });
    }
    for (const b of out.bricksHit) {
      this.sfx.brick(b.row, b.dead);
      if (b.dead) this.burst(b);
      this.bricksDirty = true;
    }
    for (const s of out.specials) {
      this.sfx.special();
      this.bricksDirty = true;
      this.say(this.ctx.t(`special.${s.kind}`), 900);
    }
    if (out.lifeLost) {
      this.sfx.lost();
      this.trails.clear();
      if (main) this.ctx.session.lifeLossEvent("ball_lost", { side: out.lifeLost.side });
      if (!this.ended) this.say(this.ctx.t(this.engine.autoServeAt === null ? "serve.again" : "serve.auto"), this.engine.autoServeAt === null ? 0 : 900);
    }
    if (out.served) this.msg.innerHTML = "";
    if (out.levelCleared && main) {
      this.reportLevel(out.levelCleared, "cleared");
      this.sfx.levelUp();
      this.trails.clear();
      this.particles = [];
      this.bricksDirty = true;
      this.updateStatus();
      if (out.done) {
        this.say(this.ctx.t("all.done"), 0);
        this.accepting = false;
        this.after(1200, () => this.ctx.session.contentExhausted("max_level"));
      } else {
        this.say(this.ctx.t("cleared"), 1400);
        this.after(1400, () => {
          if (!this.ended) this.say(this.ctx.t("level", { n: this.engine.level, name: this.ctx.t(`layout.${this.engine.layout.id}`) }), 1600);
        });
      }
    }
    // The magnet assist: tell the child how to let go once a ball is caught.
    const holding = this.engine.holding;
    if (holding && !this.wasHolding) this.say(this.ctx.t("release"), 0);
    if (!holding && this.wasHolding && this.engine.phase === "playing") this.msg.innerHTML = "";
    this.wasHolding = holding;
  }

  private reportLevel(l: LevelOut, outcome: "cleared" | "failed" | "timeout") {
    this.ctx.session.levelComplete({
      level: l.level,
      durationMs: Math.round(l.durationS * 1000),
      scoreDelta: Math.round(l.scoreDelta),
      trials: l.paddleHits + l.ballsLost,
      correct: l.paddleHits,
      errors: l.ballsLost,
      livesLost: l.livesLost,
      outcome,
      detail: { layout: this.engine.layout.id, bricks: l.bricks, specials: l.specials, ball_speed: this.engine.baseSpeed, paddle: this.engine.basePaddle },
    });
  }

  private finishPractice() {
    this.accepting = false;
    this.kind = null;
    this.msg.innerHTML = "";
    const done = this.practiceDone;
    this.practiceDone = null;
    done?.();
  }

  // ---------------------------------------------------------------- frame

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  private tick(tk: Ticker) {
    const now = performance.now();
    const realMs = this.lastFrame === null ? tk.deltaMS : Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    if (this.paused || this.ended) return;
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    const due = this.timers.filter((t) => (t.left -= tk.deltaMS) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    const e = this.engine;
    if (!e) return;
    if (this.accepting && this.kind) {
      const dir = (this.keys.right ? 1 : 0) - (this.keys.left ? 1 : 0);
      if (dir) e.movePaddle(e.paddleX + dir * KEY_SPEED * dt);
      const out = e.update(dt);
      this.onUpdate(out);
      if (this.kind === "practice") {
        // Wall-clock seconds (pause-aware), so a slow frame rate never stretches the practice.
        this.practiceLeft -= realMs / 1000;
        if (this.practiceLeft <= 0) this.finishPractice();
      }
    }
    this.squash = Math.max(0, this.squash - dt);
    this.draw(dt);
  }

  private layout() {
    const { width: W, height: H } = this.app.screen;
    const s = Math.max(0.2, Math.min((W - 32) / BOARD_W, (H - TOP_INSET - BOTTOM_INSET) / BOARD_H));
    this.scale = s;
    this.board.scale.set(s);
    const top = TOP_INSET + Math.max(0, (H - TOP_INSET - BOTTOM_INSET - BOARD_H * s) / 2);
    this.board.position.set((W - BOARD_W * s) / 2, top);
    this.drawScene(W, H);
    this.drawFrame();
    // Messages go under the board when there is room (phones in portrait), otherwise over its lower middle.
    const below = top + BOARD_H * s + 16;
    this.msg.style.insetBlockStart = H - below >= 64 ? `${below}px` : `${top + BOARD_H * s * 0.55}px`;
  }

  private toScreen(x: number, y: number) {
    return { x: this.board.x + x * this.scale, y: this.board.y + y * this.scale };
  }

  private toBoardX(clientX: number) {
    const r = this.ctx.mount.getBoundingClientRect();
    return (clientX - r.left - this.board.x) / this.scale;
  }

  /** The scenery around the board: mesas and a fort at sunrise (warm), mountains and a castle by moonlight (cold). */
  private drawScene(W: number, H: number) {
    const L = this.look;
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: L.sky[0] }, { offset: 1, color: L.sky[1] }], textureSpace: "local" });
    g.rect(0, 0, W, H).fill(sky);
    const warm = this.ctx.palette === "warm" && !this.ctx.monochrome;
    if (warm) {
      g.circle(W * 0.86, H * 0.07, Math.min(W, H) * 0.09).fill({ color: L.glow, alpha: 0.45 });
      g.circle(W * 0.86, H * 0.07, Math.min(W, H) * 0.06).fill({ color: L.glow, alpha: 0.85 });
    } else {
      g.circle(W * 0.14, H * 0.07, Math.min(W, H) * 0.05).fill({ color: L.glow, alpha: 0.9 });
      for (let i = 0; i < 70; i++) g.circle((((i * 7919) % 997) / 997) * W, (((i * 104729) % 991) / 991) * H * 0.6, 0.7 + (i % 3) * 0.5).fill({ color: "#FFFFFF", alpha: 0.3 + (i % 4) * 0.12 });
    }
    // Far ridge: flat-topped mesas (warm) or peaks (cold).
    const far: number[] = [0, H];
    const n = 7;
    for (let i = 0; i <= n; i++) {
      const x = (i / n) * W;
      const h = H * (0.32 + 0.12 * Math.sin(i * 1.7));
      if (warm) far.push(x - W / n / 3, H - h, x + W / n / 3, H - h);
      else far.push(x, H - h - (i % 2 ? H * 0.08 : 0));
    }
    far.push(W, H);
    g.poly(far).fill({ color: L.far, alpha: 0.7 });
    // Near ground with a fort or castle at one end.
    const ground = H * 0.16;
    g.rect(0, H - ground, W, ground).fill({ color: L.near });
    const fx = W * 0.08;
    const fw = Math.min(W * 0.22, 260);
    const fh = ground * 1.6;
    g.rect(fx, H - ground - fh * 0.6, fw, fh * 0.6).fill({ color: L.near });
    for (let i = 0; i < 5; i++) g.rect(fx + (i * fw) / 5 + 2, H - ground - fh * 0.6 - 12, fw / 10, 12).fill({ color: L.near });
    g.rect(fx + fw * 0.4, H - ground - fh, fw * 0.2, fh * 0.4).fill({ color: L.near });
    if (!warm) g.poly([fx + fw * 0.38, H - ground - fh, fx + fw * 0.5, H - ground - fh - 30, fx + fw * 0.62, H - ground - fh]).fill({ color: L.near });
  }

  private drawFrame() {
    const L = this.look;
    const g = this.frame;
    g.clear();
    g.roundRect(-10, -10, BOARD_W + 20, BOARD_H + 20, 18).fill({ color: L.panel, alpha: 0.84 }).stroke({ width: 4, color: L.edge, alpha: 0.85 });
    // The bottom edge is open: a dashed line shows where the ball is lost.
    for (let x = 0; x < BOARD_W; x += 24) g.moveTo(x, BOARD_H + 4).lineTo(x + 12, BOARD_H + 4).stroke({ width: 2, color: L.edge, alpha: 0.35 });
  }

  private draw(dt: number) {
    if (this.bricksDirty) {
      this.drawBricks();
      this.bricksDirty = false;
    }
    this.drawPaddle();
    this.drawBalls();
    // Particles: dust and embers (warm) or ice shards (cold); none under reduced motion.
    const fx = this.fx;
    fx.clear();
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 420 * dt;
      const a = Math.max(0, p.life / p.max);
      if (this.ctx.palette === "cold") fx.poly([p.x, p.y - p.size, p.x + p.size * 0.6, p.y, p.x, p.y + p.size, p.x - p.size * 0.6, p.y]).fill({ color: p.color, alpha: a });
      else fx.circle(p.x, p.y, p.size * 0.6).fill({ color: p.color, alpha: a });
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private drawBricks() {
    const L = this.look;
    const g = this.bricksG;
    g.clear();
    for (const b of this.engine.bricks) {
      if (b.dead || !b.visible) continue;
      const [c0, c1] = b.tough ? L.tough : L.rows[b.row % L.rows.length]!;
      const grad = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: c0 }, { offset: 1, color: c1 }], textureSpace: "local" });
      g.roundRect(b.x, b.y, BRICK_W, BRICK_H, 5).fill(grad);
      g.moveTo(b.x + 5, b.y + 2).lineTo(b.x + BRICK_W - 5, b.y + 2).stroke({ width: 1.5, color: "#FFFFFF", alpha: 0.3 });
      if (b.tough) {
        g.roundRect(b.x + 1.5, b.y + 1.5, BRICK_W - 3, BRICK_H - 3, 4).stroke({ width: 2, color: L.crack, alpha: 0.5 });
        if (b.hp < b.maxHp) this.crack(g, b);
      }
      if (b.special) {
        g.roundRect(b.x + 1, b.y + 1, BRICK_W - 2, BRICK_H - 2, 4).stroke({ width: 2.5, color: L.emboss });
        this.glyph(g, b.special, b.x + BRICK_W / 2, b.y + BRICK_H / 2);
      }
    }
  }

  private crack(g: Graphics, b: Brick) {
    const x = b.x;
    const y = b.y;
    g.poly([x + 18, y + 2, x + 26, y + 9, x + 22, y + 14, x + 31, y + 20], false).stroke({ width: 1.5, color: this.look.crack, join: "round" });
    g.poly([x + 50, y + 3, x + 45, y + 10, x + 54, y + 15, x + 49, y + 20], false).stroke({ width: 1.5, color: this.look.crack, join: "round" });
  }

  /** Special bricks are told apart by an embossed shape, not colour alone. */
  private glyph(g: Graphics, kind: SpecialKind, cx: number, cy: number) {
    const c = this.look.glyph;
    const st = { width: 2.5, color: c, cap: "round" as const, join: "round" as const };
    switch (kind) {
      case "exploding": {
        const pts: number[] = [];
        for (let i = 0; i < 16; i++) {
          const r = i % 2 ? 3.5 : 8;
          const a = (i / 16) * Math.PI * 2;
          pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
        }
        g.poly(pts).fill({ color: c });
        break;
      }
      case "slow_down": {
        const pts: number[] = [];
        for (let i = 0; i <= 16; i++) pts.push(cx - 12 + i * 1.5, cy + Math.sin(i * 0.8) * 3.5);
        g.poly(pts, false).stroke(st);
        break;
      }
      case "rocket":
        g.poly([cx, cy - 8, cx + 5, cy + 4, cx - 5, cy + 4]).fill({ color: c });
        g.poly([cx - 2.5, cy + 5, cx, cy + 9, cx + 2.5, cy + 5]).fill({ color: c, alpha: 0.7 });
        break;
      case "paddle_thin":
        g.moveTo(cx - 5, cy).lineTo(cx + 5, cy).stroke({ ...st, width: 4 });
        g.poly([cx - 13, cy - 4, cx - 8, cy, cx - 13, cy + 4], false).stroke(st);
        g.poly([cx + 13, cy - 4, cx + 8, cy, cx + 13, cy + 4], false).stroke(st);
        break;
      case "paddle_wide":
        g.moveTo(cx - 12, cy).lineTo(cx + 12, cy).stroke({ ...st, width: 4 });
        g.poly([cx - 8, cy - 5, cx - 13, cy, cx - 8, cy + 5], false).stroke(st);
        g.poly([cx + 8, cy - 5, cx + 13, cy, cx + 8, cy + 5], false).stroke(st);
        break;
      case "multi_ball":
        for (const dx of [-8, 0, 8]) g.circle(cx + dx, cy, 3.2).fill({ color: c });
        break;
      case "invisible":
        g.circle(cx, cy, 6.5).stroke(st);
        g.circle(cx, cy, 2).fill({ color: c });
        break;
      case "gravity":
        g.moveTo(cx, cy - 8).lineTo(cx, cy + 6).stroke(st);
        g.poly([cx - 5, cy + 1, cx, cy + 7, cx + 5, cy + 1], false).stroke(st);
        break;
    }
  }

  private drawPaddle() {
    const L = this.look;
    const e = this.engine;
    const g = this.paddleG;
    g.clear();
    const w = e.paddleW;
    const sq = this.ctx.reducedMotion ? 0 : this.squash / 0.15;
    const h = PADDLE_H * (1 - 0.25 * sq);
    const x = e.paddleX - w / 2;
    const y = PADDLE_Y + (PADDLE_H - h);
    if (this.ctx.palette === "warm" && !this.ctx.monochrome) {
      // Wooden raft with brass caps.
      g.roundRect(x, y, w, h, 5).fill({ color: L.paddle }).stroke({ width: 2, color: "#3D1410" });
      for (let px = x + 14; px < x + w - 10; px += 14) g.moveTo(px, y + 2).lineTo(px, y + h - 2).stroke({ width: 1.5, color: "#3D1410", alpha: 0.6 });
      for (const cx of [x + 6, x + w - 6]) g.roundRect(cx - 6, y - 1, 12, h + 2, 4).fill({ color: L.paddleTrim });
    } else {
      // Ice sled with frosted runners.
      g.roundRect(x, y, w, h, h / 2).fill({ color: L.paddle }).stroke({ width: 2, color: L.paddleTrim });
      g.moveTo(x + 8, y + h + 3).lineTo(x + w - 8, y + h + 3).stroke({ width: 2.5, color: L.paddleTrim, cap: "round" });
      g.ellipse(x + w / 2, y + h / 3, w / 3.5, h / 5).fill({ color: "#FFFFFF", alpha: 0.6 });
    }
    if (e.paddleMult !== 1) g.roundRect(x - 4, y - 4, w + 8, h + 8, 8).stroke({ width: 2, color: L.ballGlow, alpha: 0.7 });
  }

  private drawBalls() {
    const L = this.look;
    const e = this.engine;
    const g = this.ballsG;
    g.clear();
    const motion = !this.ctx.reducedMotion;
    const live = new Set<number>();
    for (const b of e.balls) {
      live.add(b.id);
      if (motion && (b.dx || b.dy)) {
        const tr = this.trails.get(b.id) ?? [];
        tr.push([b.x, b.y]);
        if (tr.length > 8) tr.shift();
        this.trails.set(b.id, tr);
        tr.forEach(([tx, ty], i) => g.circle(tx, ty, BALL_R * (0.3 + (i / tr.length) * 0.6)).fill({ color: L.ballGlow, alpha: 0.06 + (i / tr.length) * 0.18 }));
      }
      g.circle(b.x, b.y, BALL_R * 2.2).fill({ color: L.ballGlow, alpha: 0.18 });
      g.circle(b.x, b.y, BALL_R).fill({ color: L.ball[1] });
      g.circle(b.x - BALL_R / 3, b.y - BALL_R / 3, BALL_R * 0.45).fill({ color: L.ball[0] });
      if (this.ctx.palette === "cold") g.star(b.x + 1, b.y + 1, 4, 3, 1.2).fill({ color: "#6CC4E8", alpha: 0.8 });
    }
    for (const id of this.trails.keys()) if (!live.has(id)) this.trails.delete(id);
  }

  private burst(b: Brick) {
    if (this.ctx.reducedMotion) return;
    const L = this.look;
    for (let i = 0; i < 8; i++) {
      const a = this.ctx.rng() * Math.PI * 2;
      const v = 60 + this.ctx.rng() * 160;
      this.particles.push({ x: b.x + BRICK_W / 2, y: b.y + BRICK_H / 2, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: 0.6, max: 0.6, size: 3 + this.ctx.rng() * 3, color: L.particle[i % L.particle.length]! });
    }
  }

  // ---------------------------------------------------------------- input

  private onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      this.keys.left = true;
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      this.keys.right = true;
    } else if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!e.repeat) this.serve();
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") this.keys.left = false;
    else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") this.keys.right = false;
  };

  private onPointerDown = (e: PointerEvent) => {
    if (!this.accepting) return;
    this.pressing = true;
    this.engine.movePaddle(this.toBoardX(e.clientX));
    this.serve();
  };

  private onPointerMove = (e: PointerEvent) => {
    if (!this.accepting || this.paused) return;
    // A mouse moves the paddle by hovering (v1); touch and pen by dragging.
    if (e.pointerType === "mouse" || this.pressing) this.engine.movePaddle(this.toBoardX(e.clientX));
  };

  private onPointerUp = () => {
    this.pressing = false;
  };

  // ---------------------------------------------------------------- DOM: messages and status

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    style.textContent = `
      .bc-msg{position:absolute;inset-inline:0;display:flex;justify-content:center;pointer-events:none;font-family:${font};padding-inline:16px}
      .bc-say{padding:8px 18px;border-radius:999px;background:rgb(0 0 0 / .6);color:#FFFFFF;border:2px solid ${L.say};font-size:clamp(15px,4.2vw,22px);font-weight:700;text-align:center;max-inline-size:min(92vw,560px)}
      .bc-status{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    `;
    this.ctx.mount.appendChild(style);
    this.msg = document.createElement("div");
    this.msg.className = "bc-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
    this.status = document.createElement("div");
    this.status.className = "bc-status";
    this.status.setAttribute("role", "status");
    this.ctx.mount.appendChild(this.status);
  }

  /** For screen readers: the level and how many bricks are left, updated when a board starts. */
  private updateStatus() {
    if (!this.status || !this.engine) return;
    this.status.textContent = this.ctx.t("status", { n: this.engine.level, left: this.engine.bricksLeft });
  }

  /** A short message over the board; ms = 0 keeps it until the next one. */
  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const d = document.createElement("div");
    d.className = "bc-say";
    d.textContent = text;
    this.msg.appendChild(d);
    if (ms > 0)
      this.after(ms, () => {
        if (this.msg.firstChild === d) this.msg.innerHTML = "";
      });
  }
}

export const blockCrasher: GameDefinition = { manifest, create: () => new BlockCrasher(), strings };
export default blockCrasher;
