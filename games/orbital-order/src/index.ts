/**
 * Orbital Order (design doc §8.4) on the eMazeBrain Game SDK. The game draws
 * the planets and reports events; Session Rules (in the runtime) owns session
 * time and lives. The per-target response window is the game's own trial
 * mechanic (like Catch Me's), and running out of it is a reported life-loss
 * event, never a life the game takes itself.
 *
 * Look by hemisphere: left → warm "Sun Orchard", right → cold "Star Ocean";
 * the optional night look darkens both and makes the planets glow. Art is
 * drawn in code until the commissioned illustrations arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Circle, Container, FillGradient, Graphics, Text, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, PauseReason, SessionStatus } from "@emb/game-sdk";
import { DEFAULT_MAX_RULE_TRIALS, PRACTICE_TRIALS, TOKENS, type Difficulty, type GlyphType, type RingPattern, type Token } from "./config.ts";
import { OrbitalEngine, type Segment, type TapResult, type Trial } from "./engine.ts";
import type { Rule, Sphere } from "./rules.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const BANNER_SPACE = 128;
/** The rule sign sits below the HUD's own badge row (Practice, Preview). */
const BANNER_TOP = HUD_SPACE + 30;
const BAR_SPACE = 92;
const EDGE = 24;
const DEBOUNCE_MS = 90;
const WRONG_SHOW_MS = 1100;
const CHAIN_DONE_MS = 750;
const PEEK_MS = 1600;

interface Look {
  sky: string[];
  ink: string;
  rim: string;
  trail: string;
  bannerBg: string;
  bannerInk: string;
  bannerEdge: string;
  barFill: string;
  barTrack: string;
  glow: boolean;
  burst: string[];
}

/** Warm "Sun Orchard" and cold "Star Ocean" (design doc §8.4 asset table), plus the night variant of each. */
function lookFor(palette: "warm" | "cold", neon: boolean): Look {
  if (palette === "warm") {
    return neon
      ? { sky: ["#1A0E14", "#3A1622", "#5A2430"], ink: "#3D1410", rim: "#FFF1D9", trail: "#FFB547", bannerBg: "rgb(40 14 20 / .82)", bannerInk: "#FFF1D9", bannerEdge: "#FFB547", barFill: "#FFB547", barTrack: "rgb(255 241 217 / .2)", glow: true, burst: ["#FFB547", "#FF7A8A", "#F5C431", "#FFFFFF"] }
      : { sky: ["#FFE6B8", "#FFB07A", "#E07563"], ink: "#3D1410", rim: "#3D1410", trail: "#FFF1D9", bannerBg: "#FFF3DC", bannerInk: "#3D1410", bannerEdge: "#7A2420", barFill: "#B8322B", barTrack: "rgb(61 20 16 / .15)", glow: false, burst: ["#FFF1D9", "#F5C431", "#FF8F3D", "#FFFFFF"] };
  }
  return neon
    ? { sky: ["#03060F", "#0A1230", "#131C48"], ink: "#0E1530", rim: "#E3F5FC", trail: "#7FD3F5", bannerBg: "rgb(8 18 48 / .8)", bannerInk: "#E3F5FC", bannerEdge: "#4FD8B8", barFill: "#4FD8B8", barTrack: "rgb(227 245 252 / .18)", glow: true, burst: ["#7FD3F5", "#B39BFF", "#4FD8B8", "#FFFFFF"] }
    : { sky: ["#0E1A3D", "#1B2C66", "#2B4A8C"], ink: "#0E1530", rim: "#E3F5FC", trail: "#BFE9FF", bannerBg: "rgb(180 230 255 / .16)", bannerInk: "#EAF5FF", bannerEdge: "#6CC4E8", barFill: "#6CC4E8", barTrack: "rgb(234 245 255 / .2)", glow: false, burst: ["#BFE9FF", "#FFFFFF", "#7FD3F5", "#B39BFF"] };
}

interface SphereView {
  s: Sphere;
  token: Token;
  root: Container;
  body: Container;
  overlay: Container;
  /** Laid-out centre (px) before drift. */
  bx: number;
  by: number;
  x: number;
  y: number;
  phase: number;
  speed: number;
}

interface Timer {
  left: number;
  fn: () => void;
}

class OrbitalOrder implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private engine!: OrbitalEngine;
  private look!: Look;
  private glyphType: GlyphType = "digits";
  private ruleVisible: "on_request" | "always" = "on_request";
  private bg = new Graphics();
  private trailG = new Graphics();
  private sphereLayer = new Container();
  private fx = new Container();
  private views = new Map<string, SphereView>();
  private R = 40;
  private banner!: HTMLDivElement;
  /** Hidden list of the planets as buttons: for screen readers, switch access and automated tests. */
  private planets!: HTMLDivElement;
  private recheck!: HTMLButtonElement;
  private bar!: HTMLDivElement;
  private msg!: HTMLDivElement;
  private timers: Timer[] = [];
  private clock = 0;
  private paused = false;
  private ended = false;
  private qualified = false;
  private locked = true;
  private lastTap = -Infinity;
  private revealLeft = 0;
  private windowLeft = 0;
  private peekLeft = 0;
  private tapNo = 0;
  private selected: string | null = null;
  private keyboard = false;
  private particles: Array<{ g: Graphics; vx: number; vy: number; life: number }> = [];
  private practiceDone: (() => void) | null = null;
  private block: { key: string; segment: Segment; rule: Rule | null; difficulty: Difficulty; start: number; trials: number; correct: number; errors: number; score: number } | null = null;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`orbital_order.${k}`];
    this.glyphType = own("glyph_type") === "letters" ? "letters" : "digits";
    this.ruleVisible = own("rule_visible") === "always" ? "always" : "on_request";
    this.look = lookFor(ctx.palette, own("neon") === true);
    const cap = own("max_rule_trials");
    const maxRuleTrials = p.session_mode === "lives" ? (typeof cap === "number" ? Math.max(8, Math.min(60, Math.round(cap))) : DEFAULT_MAX_RULE_TRIALS) : null;
    const w = p.trial_window_ms;
    this.engine = new OrbitalEngine({
      difficulty: p.difficulty,
      palette: ctx.palette,
      glyphType: this.glyphType,
      hemisphere: p.hemisphere === "right" ? "right" : "left",
      motorBaseline: own("motor_baseline") !== false,
      maxRuleTrials,
      windowOverrideMs: typeof w === "number" && w > 0 ? Math.max(1000, Math.min(30000, w)) : null,
      rng: ctx.rng,
    });

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the game's DOM text carries meaning
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.trailG, this.sphereLayer, this.fx);
    this.fx.eventMode = "none";
    this.trailG.eventMode = "none";
    this.buildDom();
    this.app.renderer.on("resize", () => {
      this.drawBackground();
      this.layout();
    });
    this.app.ticker.add((tk) => this.tick(tk));
    this.drawBackground();
    window.addEventListener("keydown", this.onKey);
    ctx.session.onEnd(() => {
      this.ended = true;
      this.locked = true;
    });
  }

  async startPractice(): Promise<{ trials: number }> {
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.playTrial(this.engine.startPractice(this.clock));
    });
    return { trials: PRACTICE_TRIALS };
  }

  start(): void {
    const t = this.engine.startScored(this.clock);
    this.playTrial(t);
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.locked = true;
    this.flushBlock();
    const m = this.engine.metrics.summary();
    return {
      ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)),
      score: this.engine.score,
      rule_trials: this.engine.ruleTrials,
      effective_difficulty: this.engine.effectiveDifficulty,
      glyph_type: this.glyphType,
      rule_visible: this.ruleVisible,
    } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private playTrial(t: Trial) {
    this.trackBlock(t);
    this.tapNo = 0;
    this.drawSpheres(t);
    this.windowLeft = this.engine.windowMs;
    this.locked = false;
    if (t.segment === "motor") {
      this.hideBanner();
      if (t.index === 0) this.say(this.ctx.t("motor"), 1600);
      this.revealLeft = 0;
      return;
    }
    this.showBanner(t.rule!, true, t.changed, t.switchTrial);
    this.revealLeft = this.engine.revealMs;
  }

  private endReveal() {
    this.revealLeft = 0;
    this.engine.beginResponse(this.clock);
    this.windowLeft = this.engine.windowMs;
    if (this.ruleVisible === "always") this.showBanner(this.engine.currentRule!, false, []);
    else this.hideBanner();
  }

  private onSphereTap(id: string) {
    if (this.locked || this.ended || this.paused) return;
    if (this.clock - this.lastTap < DEBOUNCE_MS) return;
    this.lastTap = this.clock;
    const t = this.engine.trial;
    if (!t) return;
    if (t.segment === "probe" && !this.qualified) {
      this.qualified = true;
      this.ctx.session.qualifyingInteraction(); // the session clock starts on the first probe tap (§8.4)
    }
    // A planet tapped while the rule is still showing ends the reveal and counts as the first tap, so a quick
    // child's tap is never swallowed.
    if (this.engine.phase === "reveal") this.endReveal();
    const stimulusOn = this.clock - this.sinceTarget();
    const r = this.engine.tap(id, this.clock);
    if (r.kind === "ignored" || r.kind === "skipReveal") return;
    if (r.kind === "motor") {
      this.pulse(this.views.get(id)!);
      this.locked = true;
      this.after(350, () => this.advance());
      return;
    }
    this.report(id, r, stimulusOn);
    if (r.kind === "correct") this.onCorrect(id, r);
    else this.onWrong(id, r);
  }

  /** How long the current target has been waiting (for the trial event). */
  private sinceTarget(): number {
    return Math.max(0, this.engine.windowMs - this.windowLeft);
  }

  private report(id: string, r: Extract<TapResult, { kind: "correct" | "wrong" }>, stimulusOn: number) {
    const t = this.engine.trial!;
    if (t.segment === "practice") return;
    const v = this.views.get(id)!;
    this.tapNo += 1;
    this.ctx.session.trial({
      trialId: `${t.segment}.${t.index}.${this.tapNo}`,
      level: t.difficulty,
      stimulusOnMs: Math.round(stimulusOn),
      responseMs: Math.round(this.clock - stimulusOn),
      outcome: r.kind === "correct" ? "correct" : r.error === "inhibition" ? "commission" : "error",
      target: { x: Math.round(v.x), y: Math.round(v.y), hemifield: v.s.x < 0.5 ? "L" : v.s.x > 0.5 ? "R" : "C" },
      tags: { segment: t.segment, position: t.committed.length + (r.kind === "correct" ? 0 : 1), chain: t.chain.length, switch: t.switchTrial ? 1 : 0, ...(r.kind === "wrong" ? { error: r.error } : {}) },
    });
  }

  private onCorrect(id: string, r: Extract<TapResult, { kind: "correct" }>) {
    const t = this.engine.trial!;
    const v = this.views.get(id)!;
    this.markDone(v, t.committed.length);
    this.renderPlanetList();
    this.windowLeft = this.engine.windowMs;
    if (this.block && this.engine.scored) this.block.score += r.points;
    if (!r.chainDone) return;
    this.locked = true;
    if (this.block && t.segment !== "practice") {
      this.block.trials += 1;
      if (this.engine.metrics.trials.at(-1)?.outcome === "correct") this.block.correct += 1;
      else this.block.errors += 1;
    }
    this.burst(v);
    this.clearSign();
    this.say(this.ctx.t("chain"), CHAIN_DONE_MS);
    this.after(CHAIN_DONE_MS, () => this.advance());
  }

  private onWrong(id: string, r: Extract<TapResult, { kind: "wrong" }>) {
    const t = this.engine.trial!;
    const v = this.views.get(id)!;
    // Wrong: no red and no buzzer. A soft ✕ on the tapped planet and a glow on the one that comes next.
    this.cross(v);
    const exp = r.expected ? this.views.get(r.expected) : undefined;
    if (exp) this.hint(exp);
    if (r.retry) {
      if (t.segment === "practice") this.say(this.ctx.t("practice.show"), 1200);
      return;
    }
    this.ctx.session.lifeLossEvent("wrong_tap", { error: r.error });
    this.failTrial();
  }

  private onTimeout() {
    const t = this.engine.trial!;
    const expected = t.chain[t.committed.length] ?? null;
    if (!this.engine.timeout(this.clock)) return;
    this.tapNo += 1;
    const v = expected ? this.views.get(expected) : undefined;
    this.ctx.session.trial({
      trialId: `${t.segment}.${t.index}.${this.tapNo}`,
      level: t.difficulty,
      stimulusOnMs: Math.round(this.clock - this.engine.windowMs),
      responseMs: null,
      outcome: "timeout",
      ...(v ? { target: { x: Math.round(v.x), y: Math.round(v.y), hemifield: v.s.x < 0.5 ? "L" : v.s.x > 0.5 ? "R" : "C" } } : {}),
      tags: { segment: t.segment, position: t.committed.length + 1, chain: t.chain.length, switch: t.switchTrial ? 1 : 0 },
    });
    this.ctx.session.lifeLossEvent("trial_timeout");
    if (v) this.hint(v);
    this.failTrial();
  }

  private failTrial() {
    this.locked = true;
    this.clearSign();
    if (this.block) {
      this.block.trials += 1;
      this.block.errors += 1;
    }
    this.after(WRONG_SHOW_MS, () => this.advance());
  }

  private advance() {
    if (this.ended) return;
    const before = this.engine.trial?.segment;
    const next = this.engine.next(this.clock);
    if (!next) {
      if (before === "practice") {
        this.clearSpheres();
        this.hideBanner();
        this.say(this.ctx.t("practice.done"), 1200);
        const done = this.practiceDone;
        this.practiceDone = null;
        this.locked = true;
        this.after(900, () => done?.());
        return;
      }
      this.locked = true;
      this.flushBlock();
      this.ctx.session.contentExhausted("trial_cap");
      return;
    }
    if (before === "motor" && next.segment === "probe") {
      this.say(this.ctx.t("motor.done"), 1400);
      this.clearSpheres();
      this.locked = true;
      this.after(1200, () => this.playTrial(next));
      return;
    }
    this.playTrial(next);
  }

  // ---------------------------------------------------------------- level rows (one per rule block, plus the probe)

  private trackBlock(t: Trial) {
    if (t.segment === "practice" || t.segment === "motor") return;
    const isNew = !this.block || this.block.segment !== t.segment || (t.segment === "rules" && t.switchTrial);
    if (!isNew) return;
    this.flushBlock();
    this.block = { key: `${t.segment}.${t.index}`, segment: t.segment, rule: t.rule, difficulty: t.difficulty, start: this.clock, trials: 0, correct: 0, errors: 0, score: 0 };
  }

  private flushBlock() {
    const b = this.block;
    this.block = null;
    if (!b || b.trials === 0) return;
    this.ctx.session.levelComplete({
      level: b.difficulty,
      durationMs: Math.round(this.clock - b.start),
      scoreDelta: b.score,
      trials: b.trials,
      correct: b.correct,
      errors: b.errors,
      livesLost: b.errors,
      outcome: b.correct >= b.errors ? "cleared" : "failed",
      detail: { segment: b.segment, ordering: b.rule?.ordering ?? null, skip_token: b.rule?.skip ?? null, glyph_type: this.glyphType },
    });
  }

  // ---------------------------------------------------------------- time (pause-aware)

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;
    const e = this.engine;
    if (this.revealLeft > 0) {
      this.revealLeft -= dt;
      if (this.revealLeft <= 0) this.endReveal();
    }
    if (this.peekLeft > 0) {
      this.peekLeft -= dt;
      if (this.peekLeft <= 0) this.endPeek();
    }
    // The response window runs only in scored segments, never while the rule is open again, and not before the
    // session clock has started (the very first probe target waits for the first tap).
    const windowRuns = !this.locked && e.phase === "response" && e.scored && !e.peeking && this.qualified;
    if (windowRuns) {
      this.windowLeft -= dt;
      if (this.windowLeft <= 0) this.onTimeout();
    }
    this.updateBar(windowRuns || (e.scored && e.phase === "response"));
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    this.drift();
    for (const p of this.particles) {
      p.life -= dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.g.alpha = Math.max(0, Math.min(1, p.life / 300));
    }
    for (const p of this.particles.filter((q) => q.life <= 0)) p.g.destroy();
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  /** Gentle orbit-like drift (v1). Off under reduced motion; speed follows speed_scale. */
  private drift() {
    const still = this.ctx.reducedMotion;
    const amp = still ? 0 : Math.min(10, this.R * 0.2);
    const scale = typeof this.ctx.params.speed_scale === "number" ? this.ctx.params.speed_scale : 1;
    for (const v of this.views.values()) {
      const a = v.phase + (this.clock / 1000) * v.speed * scale;
      v.x = v.bx + Math.cos(a) * amp;
      v.y = v.by + Math.sin(a * 1.3) * amp * 0.7;
      v.root.x = v.x;
      v.root.y = v.y;
    }
    this.drawTrail();
  }

  // ---------------------------------------------------------------- drawing

  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const L = this.look;
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: L.sky.map((c, i) => ({ offset: i / (L.sky.length - 1), color: c })), textureSpace: "local" });
    g.rect(0, 0, w, h).fill(sky);
    const cx = w / 2;
    const cy = h * 0.58;
    if (this.ctx.palette === "warm" && !L.glow) {
      // Sunset: a low sun with soft orbit rings around it.
      g.circle(cx, h + h * 0.05, Math.min(w, h) * 0.32).fill({ color: "#FFE9A8", alpha: 0.55 });
      g.circle(cx, h + h * 0.05, Math.min(w, h) * 0.22).fill({ color: "#FFF4D0", alpha: 0.6 });
    } else {
      // Stars: fixed positions from a tiny hash, so they don't jump on resize.
      for (let i = 0; i < 70; i++) {
        const x = ((i * 7919) % 997) / 997;
        const y = ((i * 104729) % 991) / 991;
        g.circle(x * w, y * h, 0.8 + (i % 3) * 0.6).fill({ color: "#FFFFFF", alpha: 0.35 + (i % 4) * 0.12 });
      }
      if (this.ctx.palette === "cold") {
        // Aurora band.
        g.moveTo(0, h * 0.3).bezierCurveTo(w * 0.3, h * 0.18, w * 0.6, h * 0.42, w, h * 0.26).lineTo(w, h * 0.34).bezierCurveTo(w * 0.6, h * 0.5, w * 0.3, h * 0.26, 0, h * 0.38).fill({ color: "#4FD8B8", alpha: 0.1 });
      }
    }
    for (let i = 1; i <= 4; i++) {
      g.ellipse(cx, cy, w * 0.16 * i, h * 0.07 * i).stroke({ width: 1.5, color: L.glow || this.ctx.palette === "cold" ? "#FFFFFF" : "#FFF4E2", alpha: 0.16 });
    }
  }

  private clearSpheres() {
    for (const c of this.sphereLayer.removeChildren()) c.destroy({ children: true });
    this.views.clear();
    this.trailG.clear();
    this.selected = null;
    this.renderPlanetList();
  }

  private drawSpheres(t: Trial) {
    this.clearSpheres();
    for (const s of t.spheres) {
      const root = new Container();
      const body = new Container();
      const overlay = new Container();
      root.addChild(body, overlay);
      root.eventMode = "static";
      root.cursor = "pointer";
      root.on("pointerdown", () => {
        this.keyboard = false;
        this.onSphereTap(s.id);
      });
      this.sphereLayer.addChild(root);
      const token = TOKENS[this.ctx.palette][s.token]!;
      this.views.set(s.id, { s, token, root, body, overlay, bx: 0, by: 0, x: 0, y: 0, phase: this.ctx.rng() * Math.PI * 2, speed: 0.35 + this.ctx.rng() * 0.25 });
    }
    this.layout();
    if (t.segment === "motor") {
      for (const v of this.views.values()) v.root.alpha = v.s.id === t.lit ? 1 : 0.35;
      const lit = this.views.get(t.lit!);
      if (lit) this.litRing(lit);
    }
    this.renderPlanetList();
  }

  /** Words for a planet: its glyph, colour and rim, so it can be told apart without seeing it. */
  private planetLabel(v: SphereView): string {
    const t = this.engine.trial;
    const base = this.ctx.t("planet.label", { glyph: v.s.glyph, colour: this.ctx.t(`colour.${this.ctx.palette}.${v.token.id}`), ring: this.ctx.t(`ring.${v.token.ring}`) });
    if (t?.segment === "motor" && t.lit === v.s.id) return this.ctx.t("planet.glowing", { label: base });
    const n = t ? t.committed.indexOf(v.s.id) : -1;
    return n >= 0 ? this.ctx.t("planet.tapped", { label: base, n: n + 1 }) : base;
  }

  /**
   * Keeps the hidden planet buttons in step with the board: top to bottom, then across. Focus stays in the list
   * when a new board replaces the old one, so a screen-reader or switch user is never dropped.
   */
  private renderPlanetList() {
    if (!this.planets) return;
    const hadFocus = this.planets.contains(document.activeElement);
    const focusedId = (document.activeElement as HTMLElement | null)?.dataset?.planet ?? null;
    const t = this.engine?.trial;
    const list = [...this.views.values()].sort((a, b) => a.by - b.by || a.bx - b.bx);
    this.planets.replaceChildren(
      ...list.map((v) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.planet = v.s.id;
        b.textContent = this.planetLabel(v);
        const done = !!t && t.committed.includes(v.s.id);
        const inert = done || (t?.segment === "motor" && t.lit !== v.s.id);
        if (inert) b.setAttribute("aria-disabled", "true");
        b.addEventListener("click", () => {
          this.keyboard = true;
          this.onSphereTap(v.s.id);
        });
        b.addEventListener("focus", () => {
          this.keyboard = true;
          this.selected = v.s.id;
          this.drawSelection();
        });
        return b;
      }),
    );
    if (hadFocus) {
      const again = focusedId ? this.planets.querySelector<HTMLButtonElement>(`[data-planet="${focusedId}"]`) : null;
      (again ?? this.planets.querySelector<HTMLButtonElement>("button"))?.focus();
    }
  }

  /** Places planets in the play area. Positions come from the engine (0…1); overlaps are pushed apart sideways. */
  private layout() {
    if (!this.views.size) return;
    const { width: W, height: H } = this.app.screen;
    const top = HUD_SPACE + BANNER_SPACE;
    const bottom = H - BAR_SPACE;
    const areaH = Math.max(120, bottom - top);
    const areaW = Math.max(160, W - EDGE * 2);
    const n = this.views.size;
    this.R = Math.max(40, Math.min(72, (areaH / n) * 0.72, areaW * 0.07));
    const pad = this.R + 12;
    const list = [...this.views.values()];
    for (const v of list) {
      v.bx = EDGE + pad + (v.s.x - 0.12) / 0.76 * (areaW - pad * 2);
      v.by = top + v.s.y * areaH;
    }
    // Relax overlaps: mostly horizontal pushes, so the hemisphere lean survives.
    const minD = this.R * 2.25;
    for (let it = 0; it < 40; it++) {
      let moved = false;
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const dx = b.bx - a.bx;
          const dy = b.by - a.by;
          const d = Math.hypot(dx, dy) || 0.01;
          if (d >= minD) continue;
          const push = (minD - d) / 2;
          const ux = Math.abs(dx) < 1 ? (i % 2 ? 1 : -1) : dx / d;
          a.bx -= ux * push;
          b.bx += ux * push;
          a.by -= (dy / d) * push * 0.3;
          b.by += (dy / d) * push * 0.3;
          moved = true;
        }
      }
      for (const v of list) {
        v.bx = Math.max(EDGE + pad, Math.min(W - EDGE - pad, v.bx));
        v.by = Math.max(top + this.R, Math.min(bottom - this.R, v.by));
      }
      if (!moved) break;
    }
    const hit = this.ctx.params.input_assist === "large_hit" ? 1.45 : 1.15;
    for (const v of list) {
      this.drawSphere(v);
      v.root.hitArea = new Circle(0, 0, Math.max(30, this.R * hit));
    }
    this.drift();
    this.drawSelection();
  }

  private drawSphere(v: SphereView) {
    const R = this.R;
    const L = this.look;
    for (const c of v.body.removeChildren()) c.destroy();
    const g = new Graphics();
    v.body.addChild(g);
    const fill = v.token.fill;
    if (L.glow) {
      for (let i = 3; i >= 1; i--) g.circle(0, 0, R * (1 + i * 0.16)).fill({ color: fill, alpha: 0.07 * (4 - i) });
    } else {
      g.ellipse(R * 0.08, R * 0.92, R * 0.8, R * 0.2).fill({ color: "#000000", alpha: 0.14 });
    }
    // Shading: a darker body, a lit face offset towards the light (top-left), then a soft highlight.
    g.circle(0, 0, R).fill({ color: shade(fill, -0.22) });
    g.circle(-R * 0.08, -R * 0.08, R * 0.9).fill({ color: fill });
    g.ellipse(-R * 0.34, -R * 0.4, R * 0.32, R * 0.2).fill({ color: "#FFFFFF", alpha: 0.42 });
    drawRing(g, v.token.ring, R, L.glow ? "#FFFFFF" : L.rim, L.glow ? 0.85 : 0.7);
    const label = new Text({
      text: v.s.glyph,
      style: { fontFamily: `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`, fontSize: Math.max(48, Math.round(R)), fontWeight: "800", fill: v.token.ink },
    });
    label.anchor.set(0.5, 0.52);
    label.resolution = 2;
    v.body.addChild(label);
  }

  /** A tapped planet: a small order badge and a dim, so the chain so far is easy to see. */
  private markDone(v: SphereView, n: number) {
    const R = this.R;
    for (const c of v.overlay.removeChildren()) c.destroy();
    const o = new Graphics();
    v.overlay.addChild(o);
    v.root.alpha = 0.62;
    const r = Math.max(11, R * 0.3);
    o.circle(R * 0.72, -R * 0.72, r).fill({ color: this.look.trail }).stroke({ width: 2.5, color: this.look.glow ? "#FFFFFF" : this.look.ink, alpha: 0.8 });
    const t = new Text({ text: String(n), style: { fontFamily: "system-ui,sans-serif", fontSize: Math.round(r * 1.2), fontWeight: "800", fill: this.look.ink } });
    t.anchor.set(0.5);
    t.resolution = 2;
    t.position.set(R * 0.72, -R * 0.72);
    v.overlay.addChild(t);
  }

  private drawTrail() {
    const t = this.engine?.trial;
    const g = this.trailG;
    g.clear();
    if (!t || t.committed.length < 2) return;
    // After a board is cleared the trial still lists its taps but the planets are gone: draw nothing.
    const pts = t.committed.map((id) => this.views.get(id)).filter((v): v is SphereView => !!v);
    if (pts.length < 2) return;
    g.moveTo(pts[0]!.x, pts[0]!.y);
    for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
    g.stroke({ width: Math.max(4, this.R * 0.14), color: this.look.trail, alpha: 0.75, cap: "round", join: "round" });
  }

  private cross(v: SphereView) {
    const g = new Graphics();
    const r = Math.max(13, this.R * 0.34);
    const ink = this.look.glow ? "#1A1A2E" : this.look.ink;
    g.circle(0, 0, r).fill({ color: "#FFFFFF" }).stroke({ width: 3, color: ink });
    g.moveTo(-r * 0.4, -r * 0.4).lineTo(r * 0.4, r * 0.4).moveTo(r * 0.4, -r * 0.4).lineTo(-r * 0.4, r * 0.4).stroke({ width: Math.max(3, r * 0.2), color: ink, cap: "round" });
    g.position.set(this.R * 0.7, -this.R * 0.7);
    v.root.addChild(g);
    this.after(WRONG_SHOW_MS, () => g.destroy());
  }

  /** The planet that comes next: a soft breathing ring. */
  private hint(v: SphereView) {
    const g = new Graphics();
    v.root.addChild(g);
    const start = this.clock;
    const step = () => {
      if (g.destroyed) return;
      const p = Math.min(1, (this.clock - start) / WRONG_SHOW_MS);
      const s = this.ctx.reducedMotion ? 1 : 1 + 0.08 * Math.sin(p * Math.PI * 3);
      g.clear();
      g.circle(0, 0, this.R * 1.22 * s).stroke({ width: Math.max(4, this.R * 0.12), color: this.look.glow ? "#FFFFFF" : this.look.trail, alpha: 0.95 });
      if (p < 1) this.after(16, step);
      else g.destroy();
    };
    step();
  }

  private litRing(v: SphereView) {
    const g = new Graphics();
    v.root.addChild(g);
    const step = () => {
      if (g.destroyed || this.engine.trial?.lit !== v.s.id) {
        if (!g.destroyed) g.destroy();
        return;
      }
      const s = this.ctx.reducedMotion ? 1 : 1.15 + 0.07 * Math.sin(this.clock / 220);
      g.clear();
      g.circle(0, 0, this.R * s).stroke({ width: Math.max(4, this.R * 0.12), color: this.look.glow ? "#FFFFFF" : this.look.trail });
      this.after(16, step);
    };
    step();
  }

  private pulse(v: SphereView) {
    if (this.ctx.reducedMotion) return;
    const start = this.clock;
    const step = () => {
      if (v.root.destroyed) return;
      const p = Math.min(1, (this.clock - start) / 300);
      v.root.scale.set(1 + 0.12 * Math.sin(p * Math.PI));
      if (p < 1) this.after(16, step);
      else v.root.scale.set(1);
    };
    step();
  }

  /** Chain finished: an ember (warm) or stardust (cold) burst from the last planet. Sparkles still under reduced motion. */
  private burst(v: SphereView) {
    const n = this.ctx.reducedMotion ? 8 : 22;
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const c = this.look.burst[i % this.look.burst.length]!;
      if (this.ctx.palette === "warm") g.circle(0, 0, 3 + (i % 3)).fill({ color: c });
      else g.star(0, 0, 4, 6, 2.5).fill({ color: c });
      const a = (i / n) * Math.PI * 2;
      const speed = this.ctx.reducedMotion ? 0 : 0.18 + (i % 4) * 0.05;
      g.x = v.x + (this.ctx.reducedMotion ? Math.cos(a) * this.R * 1.4 : 0);
      g.y = v.y + (this.ctx.reducedMotion ? Math.sin(a) * this.R * 1.4 : 0);
      this.fx.addChild(g);
      this.particles.push({ g, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: this.ctx.reducedMotion ? 500 : 800 });
    }
  }

  // ---------------------------------------------------------------- keyboard

  private onKey = (e: KeyboardEvent) => {
    if (this.paused || this.ended || this.locked || !this.views.size) return;
    // The planet buttons and the ? button handle their own keys.
    if (e.target instanceof HTMLElement && e.target.closest(".oo-planets, .oo-recheck")) return;
    if (e.key === "?" || e.key === "/") {
      e.preventDefault();
      this.startPeek();
      return;
    }
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    this.keyboard = true;
    if (this.engine.phase === "reveal" && (e.key === "Enter" || e.key === " ")) {
      this.endReveal();
      return;
    }
    const list = [...this.views.values()];
    if (!this.selected || !this.views.has(this.selected)) {
      this.selected = list.reduce((a, b) => (Math.hypot(a.bx - this.app.screen.width / 2, a.by - this.app.screen.height / 2) < Math.hypot(b.bx - this.app.screen.width / 2, b.by - this.app.screen.height / 2) ? a : b)).s.id;
      this.drawSelection();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      this.onSphereTap(this.selected);
      return;
    }
    const cur = this.views.get(this.selected)!;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as "ArrowLeft"]!;
    // Screen directions, never mirrored: the play area is physical.
    let best: string | null = null;
    let bestScore = Infinity;
    for (const v of list) {
      const dx = v.bx - cur.bx;
      const dy = v.by - cur.by;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 4) continue;
      const score = along + Math.abs(dx * dir[1]! - dy * dir[0]!) * 2;
      if (score < bestScore) {
        bestScore = score;
        best = v.s.id;
      }
    }
    if (best) {
      this.selected = best;
      this.drawSelection();
    }
  };

  private drawSelection() {
    for (const v of this.views.values()) v.root.getChildByLabel("focus")?.destroy();
    if (!this.keyboard || !this.selected) return;
    const v = this.views.get(this.selected);
    if (!v) return;
    const g = new Graphics().circle(0, 0, this.R * 1.3).stroke({ width: 4, color: "#F5C431" });
    g.label = "focus";
    v.root.addChild(g);
  }

  // ---------------------------------------------------------------- rule banner, recheck, window bar (DOM: text follows language and direction)

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    style.textContent = `
      .oo-banner{position:absolute;inset-inline:0;inset-block-start:${BANNER_TOP}px;display:flex;justify-content:center;pointer-events:none;font-family:${font};transition:opacity .2s ease-out, transform .2s ease-out}
      .oo-banner[hidden]{display:flex;opacity:0;transform:translateY(-8px)}
      .oo-card{position:relative;display:flex;align-items:center;gap:14px;padding:10px 20px;border-radius:22px;background:${L.bannerBg};color:${L.bannerInk};border:3px solid ${L.bannerEdge};box-shadow:0 6px 18px rgb(0 0 0 / .18);font-size:24px;font-weight:800;${this.ctx.palette === "cold" || L.glow ? "backdrop-filter:blur(6px);" : ""}}
      .oo-card.big{font-size:28px;padding:14px 26px}
      .oo-card.rtl .oo-order{transform:scaleX(-1)}
      .oo-new{position:absolute;inset-block-start:-16px;inset-inline-start:50%;transform:translateX(-50%);padding:3px 12px;border-radius:999px;background:${L.bannerEdge};color:${L.glow || this.ctx.palette === "cold" ? "#0E1530" : "#FFFFFF"};font-size:16px;font-weight:800;white-space:nowrap}
      .oo-card.rtl .oo-new{transform:translateX(50%)}
      .oo-part{display:flex;align-items:center;gap:8px;padding:2px 6px;border-radius:12px}
      .oo-part.changed{outline:3px solid ${L.bannerEdge};outline-offset:2px}
      .oo-sep{inline-size:3px;align-self:stretch;border-radius:2px;background:${L.bannerEdge};opacity:.5}
      .oo-recheck{position:absolute;inset-block-start:${BANNER_TOP + 8}px;inset-inline-start:calc(50% - 28px);inline-size:56px;block-size:56px;border-radius:50%;border:3px solid ${L.bannerEdge};background:${L.bannerBg};color:${L.bannerInk};font:800 28px ${font};cursor:pointer;display:none;box-shadow:0 4px 12px rgb(0 0 0 / .18)}
      .oo-recheck.on{display:block}
      .oo-recheck:focus-visible{outline:4px solid #F5C431;outline-offset:3px}
      .oo-bar{position:absolute;inset-inline:${EDGE * 2}px;inset-block-end:60px;block-size:12px;border-radius:999px;background:${L.barTrack};overflow:hidden;opacity:0;transition:opacity .2s}
      .oo-bar.on{opacity:1}
      .oo-bar i{position:absolute;inset-block:0;inset-inline-start:0;border-radius:999px;background:${L.barFill}}
      .oo-msg{position:absolute;inset-inline:0;inset-block-start:${BANNER_TOP + 14}px;display:flex;justify-content:center;pointer-events:none;font-family:${font}}
      .oo-say{padding:8px 18px;border-radius:999px;background:${L.glow || this.ctx.palette === "cold" ? "#FFFFFF" : L.ink};color:${L.glow || this.ctx.palette === "cold" ? "#0E1530" : "#FFFFFF"};font-size:22px;font-weight:700}
      .oo-planets,.oo-sr{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
      @media (prefers-reduced-motion: reduce){.oo-banner{transition:none}}
    `;
    this.ctx.mount.appendChild(style);
    this.banner = document.createElement("div");
    this.banner.className = "oo-banner";
    this.banner.setAttribute("aria-live", "polite");
    this.banner.hidden = true;
    this.ctx.mount.appendChild(this.banner);
    this.recheck = document.createElement("button");
    this.recheck.type = "button";
    this.recheck.className = "oo-recheck";
    this.recheck.textContent = "?";
    this.recheck.setAttribute("aria-label", this.ctx.t("rule.recheck"));
    this.recheck.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.startPeek();
    });
    this.recheck.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        e.stopPropagation();
        this.startPeek();
      }
    });
    this.ctx.mount.appendChild(this.recheck);
    this.bar = document.createElement("div");
    this.bar.className = "oo-bar";
    this.bar.setAttribute("aria-hidden", "true");
    this.bar.innerHTML = "<i></i>";
    this.ctx.mount.appendChild(this.bar);
    this.msg = document.createElement("div");
    this.msg.className = "oo-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
    this.planets = document.createElement("div");
    this.planets.className = "oo-planets";
    this.planets.setAttribute("role", "group");
    this.planets.setAttribute("aria-label", this.ctx.t("planets"));
    this.ctx.mount.appendChild(this.planets);
  }

  private showBanner(rule: Rule, big: boolean, changed: Array<"ordering" | "skip">, isNew = false) {
    const token = TOKENS[this.ctx.palette][rule.skip]!;
    const order = this.ctx.t(`rule.${rule.ordering}${this.glyphType === "letters" ? ".letters" : ""}`);
    // The order icon reads in the text direction, so in Hebrew the steps rise from right to left.
    const rtl = getComputedStyle(this.banner).direction === "rtl";
    this.banner.innerHTML = `<div class="oo-card ${big ? "big" : ""} ${rtl ? "rtl" : ""}">${isNew ? `<span class="oo-new">${escapeHtml(this.ctx.t("rule.new"))}</span>` : ""}
      <span class="oo-part ${changed.includes("ordering") ? "changed" : ""}">${orderIcon(rule.ordering, this.look.bannerInk)}<span>${escapeHtml(order)}</span></span>
      <span class="oo-sep"></span>
      <span class="oo-part ${changed.includes("skip") ? "changed" : ""}"><span>${escapeHtml(this.ctx.t("rule.skip"))}</span>${skipIcon(token, this.look)}<span class="oo-sr">${escapeHtml(this.ctx.t("colour." + this.ctx.palette + "." + token.id))}, ${escapeHtml(this.ctx.t("ring." + token.ring))}</span></span>
    </div>`;
    this.banner.hidden = false;
    this.banner.removeAttribute("aria-hidden");
    this.recheck.classList.remove("on");
  }

  private hideBanner() {
    this.banner.hidden = true;
    this.banner.setAttribute("aria-hidden", "true");
    const t = this.engine.trial;
    const canRecheck = this.ruleVisible === "on_request" && !!t && t.segment !== "motor" && this.engine.phase === "response";
    this.recheck.classList.toggle("on", canRecheck);
  }

  /** Feedback time: the sign and the ? step aside so the message has the slot. */
  private clearSign() {
    if (this.engine.peeking) this.endPeek();
    this.peekLeft = 0;
    this.banner.hidden = true;
    this.recheck.classList.remove("on");
  }

  /** "?" pressed: the rule shows again for a moment. The response window waits while it's open. */
  private startPeek() {
    if (this.ruleVisible !== "on_request" || this.engine.phase !== "response" || this.engine.peeking || this.locked) return;
    const rule = this.engine.currentRule;
    if (!rule) return;
    this.engine.peek(this.clock);
    this.showBanner(rule, false, []);
    this.peekLeft = PEEK_MS;
  }

  private endPeek() {
    this.peekLeft = 0;
    this.engine.peekEnd(this.clock);
    if (this.engine.phase === "response") this.hideBanner();
  }

  private updateBar(on: boolean) {
    this.bar.classList.toggle("on", on);
    const i = this.bar.firstElementChild as HTMLElement | null;
    if (i) i.style.inlineSize = `${Math.max(0, Math.min(1, this.windowLeft / this.engine.windowMs)) * 100}%`;
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = `<div class="oo-say">${escapeHtml(text)}</div>`;
    this.recheck.style.visibility = "hidden"; // the message borrows the ? slot for a moment
    this.after(ms, () => {
      if (this.msg.textContent !== text) return;
      this.msg.innerHTML = "";
      this.recheck.style.visibility = "";
    });
  }
}

/** The rim pattern every colour carries, so the skip colour is also a skip pattern (v1). */
function drawRing(g: Graphics, ring: RingPattern, R: number, color: string, alpha: number) {
  const w = Math.max(2.5, R * 0.09);
  const arc = (r: number, a0: number, a1: number, width: number) => {
    g.moveTo(Math.cos(a0) * r, Math.sin(a0) * r).arc(0, 0, r, a0, a1).stroke({ width, color, alpha, cap: "round" });
  };
  switch (ring) {
    case "solid":
      g.circle(0, 0, R).stroke({ width: w, color, alpha });
      break;
    case "double":
      g.circle(0, 0, R).stroke({ width: w * 0.7, color, alpha });
      g.circle(0, 0, R * 0.84).stroke({ width: w * 0.7, color, alpha });
      break;
    case "notched":
      for (let i = 0; i < 4; i++) arc(R, (i * Math.PI) / 2 + 0.25, ((i + 1) * Math.PI) / 2 - 0.25, w);
      break;
    case "dashed":
      for (let i = 0; i < 12; i++) arc(R, (i * Math.PI) / 6 + 0.08, ((i + 0.55) * Math.PI) / 6, w);
      break;
    case "thick":
      g.circle(0, 0, R * 0.96).stroke({ width: w * 2.2, color, alpha });
      break;
    case "dotted":
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        g.circle(Math.cos(a) * R, Math.sin(a) * R, w * 0.62).fill({ color, alpha });
      }
      break;
    case "quadrant":
      arc(R * 0.96, -Math.PI * 0.75, -Math.PI * 0.25, w * 2);
      arc(R * 0.96, Math.PI * 0.25, Math.PI * 0.75, w * 2);
      break;
    case "inner":
      g.circle(0, 0, R).stroke({ width: w * 0.6, color, alpha });
      g.circle(0, 0, R * 0.7).stroke({ width: w * 0.8, color, alpha });
      break;
  }
}

/** The same rim patterns as SVG, for the skip icon in the rule banner. */
function ringSvg(ring: RingPattern, color: string): string {
  const s = `fill="none" stroke="${color}" stroke-linecap="round"`;
  switch (ring) {
    case "solid":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="3"/>`;
    case "double":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="2"/><circle cx="20" cy="20" r="14" ${s} stroke-width="2"/>`;
    case "notched":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="3" stroke-dasharray="22.4 4.3" stroke-dashoffset="2"/>`;
    case "dashed":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="3" stroke-dasharray="5 3.9"/>`;
    case "thick":
      return `<circle cx="20" cy="20" r="16" ${s} stroke-width="6"/>`;
    case "dotted":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="3.4" stroke-dasharray="0.1 6.6"/>`;
    case "quadrant":
      return `<path d="M8 8 A17 17 0 0 1 32 8 M32 32 A17 17 0 0 1 8 32" ${s} stroke-width="5"/>`;
    case "inner":
      return `<circle cx="20" cy="20" r="17" ${s} stroke-width="2"/><circle cx="20" cy="20" r="12" ${s} stroke-width="2.4"/>`;
  }
}

function skipIcon(token: Token, look: Look): string {
  const rim = look.glow ? "#FFFFFF" : look.rim === "#E3F5FC" ? "#0E1530" : look.rim;
  // The skip planet with a soft diagonal slash.
  return `<svg width="50" height="50" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="${token.fill}"/>${ringSvg(token.ring, rim)}<path d="M9 31 L31 9" stroke="${look.bannerInk}" stroke-width="4" stroke-linecap="round" opacity=".85"/></svg>`;
}

/** Three steps rising (up) or falling (down). */
function orderIcon(ordering: "up" | "down", ink: string): string {
  const hs = ordering === "up" ? [10, 18, 26] : [26, 18, 10];
  return `<svg class="oo-order" width="38" height="34" viewBox="0 0 38 34" aria-hidden="true">${hs.map((h, i) => `<rect x="${2 + i * 12}" y="${32 - h}" width="9" height="${h}" rx="3" fill="${ink}"/>`).join("")}</svg>`;
}

/** Lighten (amount > 0) or darken (amount < 0) a hex colour. */
function shade(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amount < 0 ? c * (1 + amount) : c + (255 - c) * amount));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const orbitalOrder: GameDefinition = { manifest, create: () => new OrbitalOrder(), strings };
export default orbitalOrder;
