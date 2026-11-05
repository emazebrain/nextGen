/**
 * Tunnel Rush (design doc §8.4) on the eMazeBrain Game SDK: a pseudo-3D tunnel
 * redrawn every frame in Pixi (the Phase 0 spike showed this holds 60 fps on
 * the test tablets). The game draws and reports; Session Rules owns time and
 * lives. A collision is reported as `collision`; Session Rules ignores a second
 * one inside the manifest's 1 s grace.
 *
 * Look by hemisphere: left → warm "Volcano Run", right → cold "Ice Comet Run".
 * Art is drawn in code until the commissioned illustrations arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus } from "@emb/game-sdk";
import { clamp, DIFFICULTY, glyphPool, LANES_ALLOWED, PRACTICE_S, VIEW_DEPTH, type Difficulty, type ObjectType } from "./config.ts";
import { TunnelEngine, type Obstacle, type Pass, type Spin } from "./engine.ts";
import { buildObject, type BadgeLook } from "./glyphs.ts";
import { TunnelMetrics } from "./metrics.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

/** The tunnel is drawn in a 1000 × 1000 box scaled to cover the screen (v1). */
const CX = 500;
const CY = 500;
const R = 470;
const FOCAL = 3;
const BAND = 0.55;
const PANEL = 1.1;
const SWIPE_PX = 40;

interface Look {
  sky: [string, string];
  lanes: string[];
  seam: string;
  accent: string;
  rib: string;
  fog: string;
  flash: string;
  hull: string;
  trim: string;
  flame: [string, string];
  badge: BadgeLook;
  particle: string;
}

/** Warm "Volcano Run" and cold "Ice Comet Run" (design doc §8.4 asset table). */
const LOOKS: Record<"warm" | "cold", Look> = {
  warm: {
    sky: ["#2A0C08", "#5C1A10"],
    lanes: ["#FF8F3D", "#7A2420", "#FFB547", "#B8322B", "#F26A2E", "#3D1410"],
    seam: "#1E0704",
    accent: "#FFB547",
    rib: "#4A1A10",
    fog: "#2A0C08",
    flash: "#FFE2B0",
    hull: "#7A2420",
    trim: "#FFB547",
    flame: ["#FFF4D0", "#FF7A1A"],
    badge: { kind: "lava", fill: "#3D1410", edge: "#FF8F3D", vein: "#FFB547", glyph: "#FFE2B0" },
    particle: "#FFB547",
  },
  cold: {
    sky: ["#03081A", "#0E1A3D"],
    lanes: ["#0A9396", "#04303A", "#00B4C5", "#00566B", "#0E7C8B", "#062830"],
    seam: "#002025",
    accent: "#00F0FF",
    rib: "#3A4A63",
    fog: "#03081A",
    flash: "#E3F5FC",
    hull: "#1B2A44",
    trim: "#00F0FF",
    flame: ["#FFFFFF", "#00F0FF"],
    badge: { kind: "ice", fill: "#DFF6FF", edge: "#7FD3F5", vein: "#FFFFFF", glyph: "#0E1530" },
    particle: "#E3F5FC",
  },
};

interface ObjView {
  root: Container;
  inner: Container;
}

interface Timer {
  left: number;
  fn: () => void;
}

class TunnelRush implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private engine!: TunnelEngine;
  private metrics!: TunnelMetrics;
  private kind: "practice" | "main" | null = null;
  private difficulty: Difficulty = 3;
  private lanes = 8;
  private shipMode: "fixed" | "move" = "fixed";
  private objectType: ObjectType = "shapes";
  private orientation: "upright" | "wall" = "upright";
  private spin: Spin = "none";
  private spinSpeed = 14;
  private progressive = true;
  private world = new Container();
  private bg = new Graphics();
  private tunnel = new Graphics();
  private objLayer = new Container();
  private ship = new Container();
  private shipBody = new Graphics();
  private flame = new Graphics();
  private flash = new Graphics();
  private fxLayer = new Graphics();
  private views = new Map<number, ObjView>();
  private particles: Array<{ a: number; r: number; v: number; s: number }> = [];
  private visAngle = 0;
  private tilt = 0;
  private flashLeft = 0;
  private wobble = 0;
  private moving = false;
  /** Steering is accepted only during practice and the real run, never behind the instructions. */
  private accepting = false;
  private practiceLeft = 0;
  private practiceDone: (() => void) | null = null;
  private paused = false;
  private ended = false;
  private qualified = false;
  private timers: Timer[] = [];
  private msg!: HTMLDivElement;
  private controls!: HTMLDivElement;
  private pointerX: number | null = null;
  private level = { n: 1, start: 0, objects: 0, dodges: 0, hits: 0, score: 0 };

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`tunnel_rush.${k}`];
    this.look = LOOKS[ctx.palette];
    this.difficulty = p.difficulty;
    const lanes = Number(own("lanes"));
    this.lanes = (LANES_ALLOWED as readonly number[]).includes(lanes) ? lanes : 8;
    this.shipMode = own("ship_mode") === "move" ? "move" : "fixed";
    const ot = own("object_type");
    this.objectType = typeof ot === "string" && ["shapes", "letters", "numbers", "cartoon_faces", "real_faces", "mixed"].includes(ot) ? (ot as ObjectType) : "shapes";
    this.orientation = own("object_orientation") === "wall" ? "wall" : "upright";
    const sp = own("rotation");
    this.spin = sp === "cw" || sp === "ccw" || sp === "alternate" ? sp : "none";
    const ss = own("spin_speed");
    this.spinSpeed = typeof ss === "number" ? clamp(ss, 0, 60) : 14;
    this.progressive = own("progressive") !== false;

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the game's DOM text carries meaning
    ctx.mount.appendChild(this.app.canvas);
    this.objLayer.sortableChildren = true;
    this.ship.addChild(this.flame, this.shipBody);
    this.world.addChild(this.tunnel, this.fxLayer, this.objLayer, this.ship);
    this.app.stage.addChild(this.bg, this.world, this.flash);
    this.app.stage.eventMode = "static";
    this.drawShip();
    this.buildDom();
    this.layout();
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((tk) => this.tick(tk));
    window.addEventListener("keydown", this.onKey);
    ctx.mount.addEventListener("pointerdown", this.onPointerDown);
    ctx.mount.addEventListener("pointerup", this.onPointerUp);
    for (let i = 0; i < 40; i++) this.particles.push({ a: ctx.rng() * Math.PI * 2, r: ctx.rng(), v: 0.25 + ctx.rng() * 0.5, s: 1 + ctx.rng() * 2 });
    ctx.session.onEnd(() => {
      this.ended = true;
    });
    // Show the tunnel behind the instructions.
    this.newEngine("main");
  }

  async startPractice(): Promise<{ trials: number }> {
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.newEngine("practice");
      this.practiceLeft = PRACTICE_S;
      this.accepting = true;
      this.say(this.ctx.t("practice"), 2200);
      this.showControls(true);
    });
    return { trials: 1 };
  }

  start(): void {
    this.newEngine("main");
    this.accepting = true;
    this.showControls(true);
    this.say(this.ctx.t("start"), 0);
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
    this.lastFrame = null;
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.accepting = false;
    this.showControls(false);
    if (this.kind === "main") this.flushLevel(this.qualified ? "timeout" : "failed");
    const m = this.metrics.summary();
    return {
      ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)),
      score: Math.round(this.metrics.score),
      lanes: this.lanes,
      ship_mode: this.shipMode,
      object_type: this.objectType,
      rotation: this.spin,
    } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private newEngine(kind: "practice" | "main") {
    for (const v of this.views.values()) v.root.destroy({ children: true });
    this.views.clear();
    const practice = kind === "practice";
    this.kind = kind;
    this.moving = practice; // practice runs at once; the real run waits for the first steer
    this.engine = new TunnelEngine({
      lanes: this.lanes,
      difficulty: practice ? 1 : this.difficulty,
      startLevel: practice ? 1 : typeof this.ctx.params.start_level === "number" ? this.ctx.params.start_level : 1,
      progressive: practice ? false : this.progressive,
      spin: practice ? "none" : this.spin,
      spinDegPerS: this.spinSpeed,
      // Left hemisphere sees the right visual field: objects lean to the ship's right (ADR 0014).
      lean: practice ? null : this.ctx.params.hemisphere === "right" ? "L" : "R",
      pool: glyphPool(this.objectType),
      rng: this.ctx.rng,
    });
    this.visAngle = this.engine.angle;
    if (!practice) {
      this.metrics = new TunnelMetrics(this.engine.level);
      this.level = { n: this.engine.level, start: 0, objects: 0, dodges: 0, hits: 0, score: 0 };
    } else if (!this.metrics) {
      this.metrics = new TunnelMetrics(1);
    }
  }

  private steer(dir: -1 | 1) {
    if (!this.accepting || this.ended || this.paused || !this.engine || !this.kind) return;
    if (!this.moving) {
      this.moving = true;
      this.msg.innerHTML = "";
    }
    if (this.kind === "main" && !this.qualified) {
      this.qualified = true;
      this.ctx.session.qualifyingInteraction(); // the clock starts on the first steer (§8.4)
    }
    this.engine.steer(dir);
    if (this.kind === "main") this.metrics.steers += 1;
    this.tilt = dir * 16;
  }

  private onPasses(passes: Pass[]) {
    for (const p of passes) {
      if (this.kind !== "main") {
        if (p.hit) this.bump();
        continue;
      }
      const pts = this.metrics.record(p, this.engine.time);
      this.level.objects += 1;
      this.level.score += pts;
      if (p.hit) this.level.hits += 1;
      else this.level.dodges += 1;
      const o = p.obstacle;
      const at = this.objectScreenPoint(o, 0);
      this.ctx.session.trial({
        trialId: `${o.id}`,
        level: p.level,
        stimulusOnMs: Math.round(o.spawnedAt * 1000),
        responseMs: p.reactionMs,
        outcome: p.hit ? "error" : "correct",
        target: { x: Math.round(at.x), y: Math.round(at.y), hemifield: o.spawnSide },
        tags: { lane: o.lane, threat: o.threat ? 1 : 0, kind: o.glyph.kind },
      });
      if (p.hit) {
        this.ctx.session.lifeLossEvent("collision");
        this.bump();
      } else if (this.ctx.params.show_score) {
        this.say(this.ctx.t("points", { n: pts }), 600);
      }
    }
  }

  private bump() {
    this.flashLeft = 0.45;
    this.wobble = 0.5;
    this.say(this.ctx.t("bump"), 900);
  }

  private onLevelUp(n: number) {
    this.metrics.levelUp(n);
    this.level.score += 20;
    this.flushLevel("cleared");
    this.level = { n, start: this.engine.time, objects: 0, dodges: 0, hits: 0, score: 0 };
    this.say(this.ctx.t("level", { n }), 1200);
  }

  private flushLevel(outcome: LevelHistoryRow["outcome"]) {
    const l = this.level;
    if (!l.objects) return;
    this.ctx.session.levelComplete({
      level: l.n,
      durationMs: Math.round((this.engine.time - l.start) * 1000),
      scoreDelta: Math.round(l.score),
      trials: l.objects,
      correct: l.dodges,
      errors: l.hits,
      livesLost: l.hits,
      outcome,
      detail: { lanes: this.lanes, ship_mode: this.shipMode, rotation: this.spin, speed_end: this.engine.speed },
    });
    l.objects = 0;
  }

  // ---------------------------------------------------------------- frame

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  private lastFrame: number | null = null;

  private tick(tk: Ticker) {
    const now = performance.now();
    // Real elapsed time for the practice clock: Pixi caps deltaMS on slow frames, which would stretch it.
    const realMs = this.lastFrame === null ? tk.deltaMS : Math.min(250, now - this.lastFrame);
    this.lastFrame = now;
    if (this.paused || this.ended) return;
    const dt = Math.min(0.05, tk.deltaMS / 1000);
    const due = this.timers.filter((t) => (t.left -= tk.deltaMS) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    const e = this.engine;
    if (!e) return;
    if (this.moving) {
      const before = e.scroll;
      const r = e.update(dt);
      if (this.kind === "main") this.metrics.addDistance(e.scroll - before);
      if (r.passed.length) this.onPasses(r.passed);
      if (r.levelUp && this.kind === "main") this.onLevelUp(r.levelUp);
      if (this.kind === "practice") {
        // Wall-clock seconds (pause-aware), so a slow frame rate never stretches the practice.
        this.practiceLeft -= realMs / 1000;
        if (this.practiceLeft <= 0) this.finishPractice();
      }
    }
    this.visAngle += (this.engine.angle - this.visAngle) * Math.min(1, dt * 12);
    this.tilt += (0 - this.tilt) * Math.min(1, dt * 3.5);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.wobble = Math.max(0, this.wobble - dt);
    this.draw(dt);
  }

  private finishPractice() {
    this.moving = false;
    this.accepting = false;
    this.kind = null;
    this.showControls(false);
    const done = this.practiceDone;
    this.practiceDone = null;
    done?.();
  }

  private layout() {
    const { width: W, height: H } = this.app.screen;
    // Fit the tunnel's height (or width in portrait) so the ship at the mouth is always on screen; the sky
    // fills the rest.
    const s = (Math.min(W, H) / 1000) * 1.06;
    this.world.scale.set(s);
    this.world.position.set(W / 2 - CX * s, H / 2 - CY * s - Math.min(40, H * 0.03));
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: this.look.sky[0] }, { offset: 1, color: this.look.sky[1] }], textureSpace: "local" });
    g.rect(0, 0, W, H).fill(sky);
    if (this.ctx.palette === "cold") {
      for (let i = 0; i < 80; i++) g.circle(((i * 7919) % 997) / 997 * W, ((i * 104729) % 991) / 991 * H, 0.7 + (i % 3) * 0.5).fill({ color: "#FFFFFF", alpha: 0.25 + (i % 4) * 0.12 });
    }
    this.flash.clear();
    this.flash.rect(0, 0, W, H).fill({ color: this.look.flash });
    this.flash.alpha = 0;
  }

  // World-space bend (v1): zero at the ship, growing with depth, sweeping past as the run goes on.
  private bend(z: number) {
    const amp = DIFFICULTY[this.kind === "practice" ? 1 : this.difficulty].bend * (this.ctx.reducedMotion ? 0.4 : 1);
    const vertical = (this.kind === "practice" ? 1 : this.difficulty) >= 3;
    return { x: amp * (Math.sin(z * 0.55) * 0.7 + Math.sin(z * 0.23 + 1.3) * 0.3), y: vertical ? amp * 0.45 * Math.sin(z * 0.37 + 2.1) : 0 };
  }

  private ring(d: number) {
    const r = (R * FOCAL) / (FOCAL + d);
    const damp = 0.55 + 0.45 * (r / R);
    const here = this.bend(this.engine.scroll);
    const at = this.bend(this.engine.scroll + d);
    return { r, cx: CX + (at.x - here.x) * damp, cy: CY + (at.y - here.y) * damp };
  }

  /** The tunnel's own turn on screen: rolling in fixed mode, still in move mode. */
  private get rot() {
    return this.shipMode === "move" ? 0 : this.visAngle;
  }

  /** Lane centres sit at whole multiples of the lane arc; the ship's lane is at the bottom (fixed mode). */
  private pt(g: { r: number; cx: number; cy: number }, lanePos: number, k = 1): [number, number] {
    const a = lanePos * this.engine.arc + this.rot + Math.PI / 2;
    return [g.cx + g.r * k * Math.cos(a), g.cy + g.r * k * Math.sin(a)];
  }

  private objectScreenPoint(o: Obstacle, d: number) {
    const [x, y] = this.pt(this.ring(Math.max(0, d)), o.lane, 0.84);
    const s = this.world.scale.x;
    return { x: this.world.x + x * s, y: this.world.y + y * s };
  }

  private draw(dt: number) {
    const e = this.engine;
    const L = this.look;
    const g = this.tunnel;
    g.clear();
    const lanes = e.lanes;
    // Lava glow (warm) or comet light (cold) at the far end.
    const far = this.ring(VIEW_DEPTH);
    for (let i = 4; i >= 1; i--) g.circle(far.cx, far.cy, far.r * (0.8 + i * 0.5)).fill({ color: L.accent, alpha: 0.05 });
    // Lane panels, one tone per lane.
    // The nearest band always reaches the tunnel mouth, so the seams never run past the panels.
    const panels: number[] = [0];
    const off = e.scroll % PANEL;
    for (let k = 0; ; k++) {
      const d = k * PANEL - off;
      if (d > VIEW_DEPTH) break;
      if (d > 0.05) panels.push(d);
    }
    for (let k = 0; k < panels.length - 1; k++) {
      const g1 = this.ring(panels[k]!);
      const g2 = this.ring(panels[k + 1]!);
      const fade = Math.max(0.1, 0.62 - panels[k]! * 0.07);
      for (let j = 0; j < lanes; j++) {
        const a1 = this.pt(g1, j - 0.5);
        const b1 = this.pt(g1, j + 0.5);
        const a2 = this.pt(g2, j - 0.5);
        const b2 = this.pt(g2, j + 0.5);
        g.poly([...a1, ...b1, ...b2, ...a2]).fill({ color: L.lanes[j % L.lanes.length]!, alpha: fade }).stroke({ width: 1.5, color: L.seam, alpha: 0.8, join: "round" });
      }
    }
    // Seams along the walls and a light strip down each lane, following the bend through a few depths.
    const depths = [0, 0.35, 0.8, 1.4, 2.2, 3.2, 4.5, 5.8, VIEW_DEPTH];
    const rings = depths.map((d) => this.ring(d));
    const inset = Math.cos(e.arc / 2); // lane centres on the panel chords, not the outer circle
    for (let j = 0; j < lanes; j++) {
      const seam: number[] = [];
      const strip: number[] = [];
      for (const rg of rings) {
        seam.push(...this.pt(rg, j + 0.5));
        strip.push(...this.pt(rg, j, inset));
      }
      g.poly(seam, false).stroke({ width: 1.5, color: L.accent, alpha: 0.3, join: "round" });
      g.poly(strip, false).stroke({ width: 2.5, color: L.accent, alpha: 0.4, cap: "round", join: "round" });
    }
    // Ribs.
    const boff = e.scroll % BAND;
    for (let k = 0; ; k++) {
      const z = k * BAND - boff;
      if (z < 0.12) continue;
      if (z > VIEW_DEPTH) break;
      const rg = this.ring(z);
      const pts: number[] = [];
      for (let j = 0; j <= lanes; j++) pts.push(...this.pt(rg, j + 0.5));
      const close = z < 1.2;
      // Round joins: thin wedges at the far end otherwise grow long mitre spikes.
      g.poly(pts, false).stroke({ width: close ? 3 : 2, color: L.rib, alpha: close ? 0.75 : 0.35, join: "round" });
      g.poly(pts, false).stroke({ width: close ? 1.5 : 1, color: L.accent, alpha: close ? 0.6 : 0.2, join: "round" });
    }
    // Fog over the far end.
    for (let i = 0; i < 5; i++) g.circle(far.cx, far.cy, far.r * (1.9 - i * 0.3)).fill({ color: L.fog, alpha: 0.16 });

    // Embers (warm) or snow streaks (cold), off under reduced motion.
    const fx = this.fxLayer;
    fx.clear();
    if (!this.ctx.reducedMotion) {
      for (const p of this.particles) {
        p.r += p.v * dt * (0.4 + e.speedRatio());
        if (p.r > 1) p.r = 0.05;
        const rr = 60 + p.r * 520;
        const x = CX + Math.cos(p.a) * rr;
        const y = CY + Math.sin(p.a) * rr;
        if (this.ctx.palette === "warm") fx.circle(x, y, p.s * (0.5 + p.r)).fill({ color: L.particle, alpha: 0.5 * (1 - p.r) + 0.1 });
        else fx.moveTo(x, y).lineTo(x + Math.cos(p.a) * 18 * p.r, y + Math.sin(p.a) * 18 * p.r).stroke({ width: p.s * 0.8, color: L.particle, alpha: 0.5 * p.r });
      }
    }

    // Objects.
    const seen = new Set<number>();
    for (const o of e.obstacles) {
      const d = o.z - e.scroll;
      if (d <= 0 || d > VIEW_DEPTH) continue;
      seen.add(o.id);
      let v = this.views.get(o.id);
      if (!v) {
        v = buildObject(o.glyph, L.badge);
        this.views.set(o.id, v);
        this.objLayer.addChild(v.root);
      }
      const rg = this.ring(d);
      const [x, y] = this.pt(rg, o.lane, 0.84);
      const s = Math.max(0.06, (rg.r * 0.84 * e.arc * 0.92) / 100);
      v.root.position.set(x, y);
      v.root.scale.set(s);
      v.root.zIndex = -d;
      v.root.alpha = clamp((VIEW_DEPTH - d) / 1.2, 0, 1);
      const a = o.lane * e.arc + this.rot + Math.PI / 2;
      v.inner.rotation = this.orientation === "wall" ? a + Math.PI / 2 - Math.PI : 0;
    }
    for (const [id, v] of this.views) {
      if (seen.has(id)) continue;
      v.root.destroy({ children: true });
      this.views.delete(id);
    }

    // Ship: docked at the mouth, or sliding round the tunnel in move mode.
    const sh = this.ship;
    if (this.shipMode === "move") {
      const a = -this.visAngle + Math.PI / 2;
      sh.position.set(CX + R * 0.8 * Math.cos(a), CY + R * 0.8 * Math.sin(a));
      sh.rotation = a - Math.PI / 2 + (this.tilt * Math.PI) / 180;
    } else {
      sh.position.set(CX, CY + R * 0.8);
      sh.rotation = (this.tilt * Math.PI) / 180;
    }
    if (this.wobble > 0 && !this.ctx.reducedMotion) sh.rotation += Math.sin(this.wobble * 40) * 0.12 * (this.wobble / 0.5);
    this.drawFlame();
    this.flash.alpha = this.flashLeft > 0 ? (this.flashLeft / 0.45) * 0.3 : 0;
  }

  private drawShip() {
    const L = this.look;
    const g = this.shipBody;
    g.clear();
    g.ellipse(0, 10, 58, 34).fill({ color: L.trim, alpha: 0.14 });
    if (this.ctx.palette === "warm") {
      // Phoenix glider: swept feather wings and a tail fan.
      g.poly([0, -36, 14, -6, 62, 6, 70, 22, 22, 26, 10, 40, -10, 40, -22, 26, -70, 22, -62, 6, -14, -6]).fill({ color: L.hull }).stroke({ width: 3, color: L.trim, join: "round" });
      for (const sx of [-1, 1]) for (let i = 0; i < 3; i++) g.moveTo(sx * (22 + i * 14), 10 + i * 2).lineTo(sx * (30 + i * 14), 22).stroke({ width: 2.5, color: L.trim, alpha: 0.8, cap: "round" });
      g.ellipse(0, -12, 7, 11).fill({ color: "#FFE2B0" });
    } else {
      // v1's low-poly ship with a cyan glow.
      g.poly([18, 2, 52, 34, 20, 40]).fill({ color: "#16233A" }).stroke({ width: 2.5, color: L.trim, join: "round" });
      g.poly([-18, 2, -52, 34, -20, 40]).fill({ color: "#16233A" }).stroke({ width: 2.5, color: L.trim, join: "round" });
      g.poly([0, -40, 22, -10, 28, 36, -28, 36, -22, -10]).fill({ color: L.hull }).stroke({ width: 3, color: L.trim, join: "round" });
      g.poly([-7, -34, 7, -34, 10, 36, -10, 36]).fill({ color: "#0B1220" });
      g.ellipse(0, -14, 7, 10).fill({ color: L.trim, alpha: 0.95 });
    }
    for (const x of [-14, 14]) g.circle(x, 34, 7).fill({ color: "#0B1220" }).stroke({ width: 2.5, color: L.trim });
    this.ship.scale.set(1.15);
  }

  private drawFlame() {
    const f = this.flame;
    f.clear();
    if (!this.moving) return;
    const len = 26 + this.engine.speedRatio() * 58;
    const flick = this.ctx.reducedMotion ? 1 : 0.8 + 0.2 * Math.sin(this.engine.time * 40);
    for (const x of [-14, 14]) {
      f.poly([x - 7, 34, x, 34 + len * flick, x + 7, 34]).fill({ color: this.look.flame[1], alpha: 0.85 });
      f.poly([x - 3, 34, x, 34 + len * 0.55 * flick, x + 3, 34]).fill({ color: this.look.flame[0] });
    }
  }

  // ---------------------------------------------------------------- input

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") {
      e.preventDefault();
      this.steer(-1);
    } else if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") {
      e.preventDefault();
      this.steer(1);
    }
  };

  private onPointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest?.(".tr-controls")) return;
    this.pointerX = e.clientX;
  };

  private onPointerUp = (e: PointerEvent) => {
    const x0 = this.pointerX;
    this.pointerX = null;
    if (x0 === null) return;
    const dx = e.clientX - x0;
    if (Math.abs(dx) >= SWIPE_PX) this.steer(dx > 0 ? 1 : -1);
  };

  // ---------------------------------------------------------------- DOM: thumb buttons and messages

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    // The steering buttons are physical left and right, like the arrows they stand for, so their row keeps
    // left-to-right order in Hebrew too (same exception as the timer side). They sit above the bottom corners,
    // which the host keeps for its own controls (Close preview, the therapist's pause).
    style.textContent = `
      .tr-controls{position:absolute;inset-inline:16px;inset-block-end:84px;display:flex;justify-content:space-between;direction:ltr;pointer-events:none}
      .tr-controls[hidden]{display:none}
      .tr-steer{pointer-events:auto;inline-size:76px;block-size:76px;border-radius:22px;border:3px solid ${L.accent};background:rgb(0 0 0 / .35);color:${L.accent};display:grid;place-items:center;cursor:pointer;touch-action:manipulation}
      .tr-steer:active{transform:scale(.95)}
      .tr-steer:focus-visible{outline:4px solid #F5C431;outline-offset:3px}
      .tr-msg{position:absolute;inset-inline:0;inset-block-start:124px;display:flex;justify-content:center;pointer-events:none;font-family:${font}}
      .tr-say{padding:8px 18px;border-radius:999px;background:rgb(0 0 0 / .55);color:#FFFFFF;border:2px solid ${L.accent};font-size:22px;font-weight:700}
      @media (prefers-reduced-motion: reduce){.tr-steer:active{transform:none}}
    `;
    this.ctx.mount.appendChild(style);
    this.controls = document.createElement("div");
    this.controls.className = "tr-controls";
    this.controls.hidden = true;
    const chevron = (d: string) => `<svg width="40" height="40" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    for (const [dir, key, d] of [[-1, "steer.left", "M15 5 L8 12 L15 19"], [1, "steer.right", "M9 5 L16 12 L9 19"]] as const) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tr-steer";
      b.setAttribute("aria-label", this.ctx.t(key));
      b.innerHTML = chevron(d);
      b.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        this.steer(dir);
      });
      // Keyboard and switch access (a pointer press already steered).
      b.addEventListener("click", (e) => {
        if (e.detail === 0) this.steer(dir);
      });
      this.controls.appendChild(b);
    }
    this.ctx.mount.appendChild(this.controls);
    this.msg = document.createElement("div");
    this.msg.className = "tr-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
  }

  private showControls(on: boolean) {
    this.controls.hidden = !on;
  }

  /** A short message above the thumb buttons; ms = 0 keeps it until the next one. */
  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const d = document.createElement("div");
    d.className = "tr-say";
    d.textContent = text;
    this.msg.appendChild(d);
    if (ms > 0)
      this.after(ms, () => {
        if (this.msg.firstChild === d) this.msg.innerHTML = "";
      });
  }
}

export const tunnelRush: GameDefinition = { manifest, create: () => new TunnelRush(), strings };
export default tunnelRush;
