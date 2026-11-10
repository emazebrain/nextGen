/**
 * Picture Trail (spec 2026-11-10) on the eMazeBrain Game SDK. Pictures appear one at a time along a line, each gone
 * when the next appears; then, with no pause, a second run on the same line, and the child taps the one picture that
 * was in the first run. The pure engine (engine.ts) owns the round's timing; Session Rules (in the runtime) own the
 * session clock and lives: the game only reports `wrong_picture` and `missed_match`.
 *
 * The line's direction, where most pictures go and the background follow the step's brain-region filter (ADR 0020),
 * or the side when there is none. Pictures: a Twemoji subset (CC-BY 4.0, NOTICE.md) by age band.
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, ColorMatrixFilter, Container, FillGradient, Graphics, Rectangle, Sprite, Texture, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus } from "@emb/game-sdk";
import { countForLevel, finalLevelOutcome, MAX_LEVEL, nextLevel, showMs, startLevel, usesLures, type AgeBand, type Difficulty } from "./config.ts";
import { TrailEngine, type EngineEvent } from "./engine.ts";
import { linePoints, type Compass, type Direction, type Point } from "./geometry.ts";
import { computeMetrics, type RoundRecord } from "./metrics.ts";
import type { Picture } from "./pictures.ts";
import { buildRound, directionsFor, picturesFor, targetsFor, type RegionLike, type Round } from "./rounds.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const FEEDBACK_MS = 600;
const BANDS: AgeBand[] = ["4-6", "7-9", "10-12", "13+"];

interface Look {
  sky: [string, string];
  /** Deeper gradient for the answer phase — makes the phase shift visible. */
  answerSky: [string, string];
  solid: string;
  pattern: string;
  card: string;
  cardEdge: string;
  cue: string;
  ink: string;
  good: string;
  burst: string[];
}
/** Bright, modern looks (spec "Look"): warm and cool palettes, and black and white (ADR 0009). */
const LOOKS: Record<"warm" | "cold" | "mono", Look> = {
  warm: { sky: ["#FFF3DC", "#FFC98A"], answerSky: ["#FFE4B5", "#FFB060"], solid: "#FFE3BC", pattern: "#FFB25E", card: "#FFFFFF", cardEdge: "#F08A3C", cue: "#FF5E7E", ink: "#4A1F0E", good: "#2FB36B", burst: ["#FF5E7E", "#FFC93C", "#FF8A3C", "#7ED957", "#FFFFFF"] },
  cold: { sky: ["#E2F6FF", "#9FD8F5"], answerSky: ["#C5E8FA", "#6FBBEB"], solid: "#CDEBFA", pattern: "#6EC3EE", card: "#FFFFFF", cardEdge: "#2F80ED", cue: "#7B61FF", ink: "#0E2240", good: "#18A999", burst: ["#7B61FF", "#3CC8FF", "#18A999", "#FFD23C", "#FFFFFF"] },
  mono: { sky: ["#F4F4F4", "#D6D6D6"], answerSky: ["#E0E0E0", "#B8B8B8"], solid: "#E6E6E6", pattern: "#9A9A9A", card: "#FFFFFF", cardEdge: "#222222", cue: "#111111", ink: "#111111", good: "#111111", burst: ["#111111", "#555555", "#999999", "#FFFFFF"] },
};

interface Timer {
  left: number;
  fn: () => void;
}
interface CardView {
  /** Positioned and tappable; never scaled, so the tap area is full size from the first frame. */
  root: Container;
  /** What the child sees: pops in by scaling. */
  body: Container;
  slot: number;
  phase: "question" | "answer";
  born: number;
}

class PictureTrail implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private band: AgeBand = "10-12";
  private difficulty: Difficulty = 3;
  private level = 1;
  private sinceChange: boolean[] = [];
  private maxClears = 0;
  private lures: "auto" | "on" | "off" = "auto";
  private showOverride = 0;
  private textured = false;
  private directions: Direction[] = ["ltr"];
  private targets: Compass[] = [];
  private rng!: () => number;
  private used = new Set<string>();
  private textures = new Map<string, Texture>();
  private bg = new Graphics();
  private frame = new Graphics();
  private layer = new Container();
  private fx = new Container();
  private engine = new TrailEngine();
  private round: Round | null = null;
  private points: Point[] = [];
  private size = 120;
  private capped = false;
  private card: CardView | null = null;
  private answerPhase = false;
  private hint = false;
  private clock = 0;
  private paused = false;
  private ended = false;
  private practicing = false;
  private timers: Timer[] = [];
  private particles: Array<{ g: Graphics; vx: number; vy: number; life: number }> = [];
  private shake: { c: Container; left: number; x: number } | null = null;
  private records: RoundRecord[] = [];
  private levelRows: RoundRecord[] = [];
  private levelStart = 0;
  private roundNo = 0;
  private matchShownAt = 0;
  private score = 0;
  private startBtn!: HTMLButtonElement;
  private msg!: HTMLDivElement;
  private phaseLabel!: HTMLDivElement;
  private onRoundDone: (() => void) | null = null;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`picture_trail.${k}`];
    this.band = BANDS.includes(p.age_band as AgeBand) ? (p.age_band as AgeBand) : "10-12";
    this.difficulty = p.difficulty;
    this.level = typeof p.start_level === "number" ? Math.min(MAX_LEVEL, Math.max(1, p.start_level)) : startLevel(p.difficulty);
    const lures = own("lures");
    this.lures = lures === "on" || lures === "off" ? lures : "auto";
    const sm = own("show_ms");
    this.showOverride = typeof sm === "number" ? sm : 0;
    this.textured = own("background") === "textured";
    const temp = own("bg_temperature");
    this.look = ctx.monochrome ? LOOKS.mono : LOOKS[temp === "warm" || temp === "cold" ? temp : ctx.palette];
    const params = { hemisphere: p.hemisphere, direction: typeof own("direction") === "string" ? (own("direction") as string) : "auto", ...(p.region ? { region: p.region as RegionLike } : {}) };
    this.directions = directionsFor(params);
    this.targets = targetsFor(params);
    // One integer from the host's seeded generator drives every round, so a session replays exactly.
    const seed = Math.floor(ctx.rng() * 2 ** 31);
    this.rng = mulberry32(seed);

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true");
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.frame, this.layer, this.fx);
    this.fx.eventMode = "none";
    this.buildDom();
    await this.loadPictures();
    this.app.renderer.on("resize", () => {
      this.drawBackground();
      this.relayout();
    });
    this.app.ticker.add((tk) => this.tick(tk));
    this.drawBackground();
    window.addEventListener("keydown", this.onKey);
    ctx.session.onEnd(() => this.stopAll());
  }

  /** Two easy rounds of two pictures, slower, with a ring around the right answer. Nothing is reported. */
  async startPractice(): Promise<{ trials: number }> {
    this.practicing = true;
    this.hint = true;
    for (let i = 0; i < 2 && !this.ended; i++) {
      await new Promise<void>((resolve) => {
        this.onRoundDone = resolve;
        this.playRound(2, Math.round(showMs(1, this.band, this.ctx.params.speed_scale ?? 1) * 1.5));
      });
    }
    this.practicing = false;
    this.hint = false;
    return { trials: 2 };
  }

  start(): void {
    // The clock starts on this tap (invariant 5): never on load.
    this.startBtn.hidden = false;
    this.startBtn.focus();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  end(status: SessionStatus): Record<string, number | string | object> {
    this.stopAll();
    this.flushLevel(finalLevelOutcome(status, this.maxClears));
    return { ...computeMetrics(this.records), score: this.score, age_band: this.band, directions: this.directions.join(",") };
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    for (const t of this.textures.values()) t.destroy(true);
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private begin = () => {
    if (this.ended) return;
    this.startBtn.hidden = true;
    this.ctx.session.qualifyingInteraction();
    this.levelStart = this.clock;
    this.nextRound();
  };

  private nextRound() {
    if (this.ended || this.paused) {
      if (!this.ended) this.after(200, () => this.nextRound());
      return;
    }
    this.playRound(countForLevel(this.level), showMs(this.level, this.band, this.ctx.params.speed_scale ?? 1, this.showOverride));
  }

  private playRound(n: number, show: number) {
    const { w, h } = this.area();
    const round = buildRound(this.rng, {
      level: this.level,
      band: this.band,
      lures: !this.practicing && usesLures(this.level, this.difficulty, this.lures),
      directions: this.directions,
      targets: this.targets,
      used: this.used,
      n,
      nFor: (d) => linePoints(d, n, w, h).n,
    });
    this.round = round;
    this.capped = round.n < n;
    this.layoutRound();
    this.answerPhase = false;
    this.drawBackground();
    this.drawFrame();
    this.showPhaseLabel(this.ctx.t("watch"));
    this.render(this.engine.startRound(round, show, this.clock));
  }

  private layoutRound() {
    if (!this.round) return;
    const { w, h } = this.area();
    // keepN: a resize mid-round must not drop slots the round already uses (the match could vanish).
    const l = linePoints(this.round.direction, this.round.n, w, h, this.round.target, { keepN: true });
    this.points = l.points.map((pt) => ({ x: pt.x, y: pt.y + HUD_SPACE }));
    this.size = l.size;
  }

  private relayout() {
    this.layoutRound();
    if (this.card) {
      const pt = this.points[this.card.slot];
      if (pt) this.card.root.position.set(pt.x, pt.y);
    }
    this.drawFrame();
  }

  private render(events: EngineEvent[]) {
    for (const e of events) {
      if (e.type === "show") this.showCard(e.phase, e.slot, e.picture);
      else if (e.type === "hide") this.hideCard();
      else if (e.type === "cue") {
        this.answerPhase = true;
        this.drawBackground();
        this.drawFrame();
        this.showPhaseLabel(this.ctx.t("find"));
      } else if (e.type === "wrong") this.onWrong();
      else if (e.type === "miss") {
        if (!this.practicing) this.ctx.session.lifeLossEvent("missed_match");
      } else if (e.type === "correct") this.onCorrect(e.rt);
      else if (e.type === "roundEnd") this.onRoundEnd(e);
    }
  }

  private onCorrect(_rt: number) {
    if (this.card) this.burst(this.card.root.x, this.card.root.y);
    this.say(this.ctx.t("found"), 900);
  }

  private onWrong() {
    if (this.card) {
      this.card.body.alpha = 0.45;
      if (!this.ctx.reducedMotion) this.shake = { c: this.card.root, left: 300, x: this.card.root.x };
    }
    if (!this.practicing) this.ctx.session.lifeLossEvent("wrong_picture");
  }

  private onRoundEnd(e: Extract<EngineEvent, { type: "roundEnd" }>) {
    const r = this.round!;
    this.answerPhase = false;
    this.drawBackground();
    this.drawFrame();
    if (this.practicing) {
      this.after(this.ctx.reducedMotion ? 300 : FEEDBACK_MS, () => {
        this.hideCard();
        const done = this.onRoundDone;
        this.onRoundDone = null;
        done?.();
      });
      return;
    }
    this.roundNo += 1;
    const rec: RoundRecord = { level: this.level, n: r.n, outcome: e.outcome, rt: e.rt, wrongTaps: e.wrongTaps, answerShown: e.answerShown };
    this.records.push(rec);
    this.levelRows.push(rec);
    if (e.outcome === "correct") this.score += 10 * r.n;
    const pt = this.points[r.matchA] ?? { x: this.app.screen.width / 2, y: this.app.screen.height / 2 };
    const cx = this.app.screen.width / 2;
    this.ctx.session.trial({
      trialId: String(this.roundNo),
      level: this.level,
      stimulusOnMs: Math.round(this.matchShownAt),
      responseMs: e.rt,
      outcome: e.outcome,
      target: { x: Math.round(pt.x), y: Math.round(pt.y), hemifield: Math.abs(pt.x - cx) < 1 ? "C" : pt.x < cx ? "L" : "R" },
      tags: { direction: r.direction, target: r.target ?? "none", n: r.n, match_q: r.matchQ, match_a: r.matchA, age_band: this.band, lure: r.lure ? 1 : 0, wrong_taps: e.wrongTaps, capped: this.capped ? 1 : 0 },
    });
    // Within-session staircase: two right in a row up, two not-right in a row down.
    this.sinceChange.push(e.outcome === "correct");
    const next = nextLevel(this.level, this.sinceChange);
    if (this.level === MAX_LEVEL && e.outcome === "correct") this.maxClears += 1;
    if (next !== this.level) {
      this.flushLevel(next > this.level ? "cleared" : "failed");
      this.level = next;
      this.sinceChange = [];
    }
    if (this.maxClears >= 2) {
      this.ctx.session.contentExhausted("max_level");
      return;
    }
    this.after(this.ctx.reducedMotion ? 300 : FEEDBACK_MS, () => {
      this.hideCard();
      this.nextRound();
    });
  }

  /** One history row per stay at a level (SDK LevelHistoryRow). */
  private flushLevel(outcome: LevelHistoryRow["outcome"]) {
    if (!this.levelRows.length) return;
    const rows = this.levelRows;
    const correct = rows.filter((r) => r.outcome === "correct").length;
    this.ctx.session.levelComplete({
      level: rows[0]!.level,
      durationMs: Math.round(this.clock - this.levelStart),
      scoreDelta: rows.reduce((s, r) => s + (r.outcome === "correct" ? 10 * r.n : 0), 0),
      trials: rows.length,
      correct,
      errors: rows.length - correct,
      // A life per wrong picture, and one when the match went by untapped.
      livesLost: rows.reduce((s, r) => s + r.wrongTaps + (r.outcome === "correct" ? 0 : 1), 0),
      outcome,
      detail: { n: rows[0]!.n },
    });
    this.levelRows = [];
    this.levelStart = this.clock;
  }

  private stopAll() {
    this.ended = true;
    this.engine.stop();
    this.startBtn.hidden = true;
    this.hideCard();
    this.answerPhase = false;
    this.drawBackground();
    this.drawFrame();
  }

  private tap(slot: number) {
    if (this.ended || this.paused || !this.card || this.card.slot !== slot || this.card.phase !== "answer") return;
    this.render(this.engine.tap(this.clock));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.key !== " " && e.key !== "Enter") return;
    if (!this.startBtn.hidden) return; // the button handles its own keys
    if (this.card) {
      e.preventDefault();
      this.tap(this.card.slot);
    }
  };

  // ---------------------------------------------------------------- ticker

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;
    if (this.engine.active) this.render(this.engine.tick(this.clock));
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    if (this.card && !this.ctx.reducedMotion) {
      const age = this.clock - this.card.born;
      const s = age < 180 ? 0.6 + 0.4 * easeOutBack(age / 180) : 1;
      this.card.body.scale.set(s);
    }
    if (this.shake) {
      this.shake.left -= dt;
      this.shake.c.x = this.shake.x + (this.shake.left > 0 ? Math.sin(this.shake.left / 22) * 8 : 0);
      if (this.shake.left <= 0) this.shake = null;
    }
    for (const p of this.particles) {
      p.life -= dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vy += 0.0007 * dt;
      p.g.alpha = Math.max(0, p.life / 700);
    }
    for (const p of this.particles.filter((q) => q.life <= 0)) p.g.destroy();
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  // ---------------------------------------------------------------- drawing

  private area() {
    const { width: w, height: h } = this.app.screen;
    return { w, h: Math.max(160, h - HUD_SPACE) };
  }

  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const L = this.look;
    this.bg.clear();
    // Plain: a soft, bright gradient. Patterned: the same with a light pattern on top.
    // Answer phase uses a deeper gradient so the child notices the shift.
    const sky = this.answerPhase ? L.answerSky : L.sky;
    const grad = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: sky[0] }, { offset: 1, color: sky[1] }] });
    this.bg.rect(0, 0, w, h).fill(grad);
    if (this.textured) {
      // A soft pattern: dots for warm, waves for cool (and black and white).
      if (this.look === LOOKS.warm) {
        for (let y = 24; y < h; y += 48) for (let x = (y / 48) % 2 ? 24 : 48; x < w; x += 48) this.bg.circle(x, y, 5).fill({ color: L.pattern, alpha: 0.35 });
      } else {
        for (let y = 30; y < h; y += 56) {
          this.bg.moveTo(0, y);
          for (let x = 0; x <= w; x += 28) this.bg.quadraticCurveTo(x + 14, y + ((x / 28) % 2 ? 10 : -10), x + 28, y);
          this.bg.stroke({ width: 3, color: L.pattern, alpha: 0.3 });
        }
      }
    }
  }

  /** The answer-run cue: a coloured border (dashed in black and white, so it never relies on colour alone). */
  private drawFrame() {
    const { width: w, height: h } = this.app.screen;
    this.frame.clear();
    // The trail: a faint dot at each stop, so the child can see where the pictures will come.
    for (const pt of this.points) this.frame.circle(pt.x, pt.y, 6).fill({ color: this.look.cardEdge, alpha: 0.28 });
    if (!this.answerPhase) return;
    const x = 8;
    const y = HUD_SPACE + 4;
    const fw = w - 16;
    const fh = h - y - 8;
    if (this.ctx.monochrome) {
      const dash = 18;
      const edges: Array<[number, number, number, number]> = [[x, y, x + fw, y], [x + fw, y, x + fw, y + fh], [x + fw, y + fh, x, y + fh], [x, y + fh, x, y]];
      for (const [x1, y1, x2, y2] of edges) {
        const len = Math.hypot(x2 - x1, y2 - y1);
        for (let d = 0; d < len; d += dash * 2) {
          const a = d / len;
          const b = Math.min(1, (d + dash) / len);
          this.frame.moveTo(x1 + (x2 - x1) * a, y1 + (y2 - y1) * a).lineTo(x1 + (x2 - x1) * b, y1 + (y2 - y1) * b);
        }
      }
      this.frame.stroke({ width: 8, color: this.look.cue });
    } else {
      this.frame.roundRect(x, y, fw, fh, 28).stroke({ width: 10, color: this.look.cue, alpha: 0.9 });
    }
  }

  private showCard(phase: "question" | "answer", slot: number, picture: Picture) {
    this.hideCard();
    const pt = this.points[slot];
    if (!pt) return;
    const L = this.look;
    const s = this.size;
    const root = new Container();
    root.position.set(pt.x, pt.y);
    const body = new Container();
    root.addChild(body);
    const shadow = new Graphics().roundRect(-s / 2 + 3, -s / 2 + 6, s, s, s * 0.22).fill({ color: "#000000", alpha: 0.12 });
    const face = new Graphics().roundRect(-s / 2, -s / 2, s, s, s * 0.22).fill(L.card).stroke({ width: Math.max(3, s * 0.04), color: L.cardEdge });
    body.addChild(shadow, face);
    const tex = this.textures.get(picture.id);
    if (tex) {
      const sp = new Sprite(tex);
      sp.anchor.set(0.5);
      sp.width = sp.height = s * 0.74;
      if (this.ctx.monochrome) {
        const f = new ColorMatrixFilter();
        f.desaturate();
        sp.filters = [f];
      }
      body.addChild(sp);
    }
    const round = this.round;
    if (phase === "answer" && this.hint && round && slot === round.matchA) {
      body.addChild(new Graphics().roundRect(-s / 2 - 10, -s / 2 - 10, s + 20, s + 20, s * 0.26).stroke({ width: 6, color: L.good }));
    }
    if (phase === "answer" && round && slot === round.matchA) this.matchShownAt = this.clock;
    if (phase === "answer") {
      const extra = this.ctx.params.input_assist === "large_hit" ? s * 0.5 : 24;
      root.eventMode = "static";
      root.cursor = "pointer";
      root.hitArea = new Rectangle(-s / 2 - extra / 2, -s / 2 - extra / 2, s + extra, s + extra);
      root.on("pointerdown", () => this.tap(slot));
    }
    if (!this.ctx.reducedMotion) body.scale.set(0.6);
    this.layer.addChild(root);
    this.card = { root, body, slot, phase, born: this.clock };
  }

  private hideCard() {
    if (!this.card) return;
    if (this.shake?.c === this.card.root) this.shake = null;
    this.card.root.destroy({ children: true });
    this.card = null;
  }

  private burst(x: number, y: number) {
    if (this.ctx.reducedMotion) return;
    for (let i = 0; i < 30; i++) {
      const g = new Graphics().roundRect(-5, -3, 10, 6, 2).fill(this.look.burst[i % this.look.burst.length]!);
      g.position.set(x, y);
      g.rotation = this.rng() * Math.PI;
      const a = this.rng() * Math.PI * 2;
      const v = 0.25 + this.rng() * 0.35;
      this.particles.push({ g, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 0.3, life: 700 });
      this.fx.addChild(g);
    }
  }

  private async loadPictures() {
    const jobs = picturesFor(this.band).map(
      (pic) =>
        new Promise<void>((resolve) => {
          const img = new Image(256, 256);
          img.onload = () => {
            this.textures.set(pic.id, Texture.from(img));
            resolve();
          };
          img.onerror = () => resolve();
          img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pic.svg.replace("<svg ", '<svg width="256" height="256" '))}`;
        }),
    );
    await Promise.all(jobs);
  }

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    style.textContent = `
      .pt-start{position:absolute;inset-block-start:50%;inset-inline-start:50%;transform:translate(-50%,-50%);padding:22px 44px;border-radius:999px;border:0;background:${L.cue};color:#FFFFFF;font:800 30px ${font};box-shadow:0 10px 0 rgb(0 0 0 / .18),0 18px 36px rgb(0 0 0 / .18);cursor:pointer}
      .pt-start:focus-visible{outline:4px solid ${L.ink};outline-offset:4px}
      .pt-start[hidden]{display:none}
      .pt-msg{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 6}px;display:flex;justify-content:center;pointer-events:none;font-family:${font}}
      .pt-say{padding:8px 18px;border-radius:999px;background:${L.ink};color:#FFFFFF;font-size:22px;font-weight:700}
      .pt-phase{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;font-family:${font};z-index:10}
      .pt-phase-text{padding:18px 48px;border-radius:24px;background:${L.ink};color:#FFFFFF;font-size:38px;font-weight:800;letter-spacing:0.03em;opacity:0;transform:scale(0.7);animation:pt-phase-in 600ms ease-out forwards}
      @keyframes pt-phase-in{0%{opacity:0;transform:scale(0.7)}20%{opacity:1;transform:scale(1.05)}40%{transform:scale(1)}80%{opacity:1;transform:scale(1)}100%{opacity:0;transform:scale(0.95)}}
      @media(prefers-reduced-motion:reduce){.pt-phase-text{animation:pt-phase-fade 600ms ease-out forwards}@keyframes pt-phase-fade{0%{opacity:0}20%{opacity:1}80%{opacity:1}100%{opacity:0}}}
    `;
    this.ctx.mount.appendChild(style);
    this.phaseLabel = document.createElement("div");
    this.phaseLabel.className = "pt-phase";
    this.phaseLabel.setAttribute("aria-live", "assertive");
    this.phaseLabel.hidden = true;
    this.ctx.mount.appendChild(this.phaseLabel);
    this.startBtn = document.createElement("button");
    this.startBtn.type = "button";
    this.startBtn.className = "pt-start";
    this.startBtn.textContent = this.ctx.t("start");
    this.startBtn.hidden = true;
    this.startBtn.addEventListener("click", this.begin);
    this.ctx.mount.appendChild(this.startBtn);
    this.msg = document.createElement("div");
    this.msg.className = "pt-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const el = document.createElement("div");
    el.className = "pt-say";
    el.textContent = text;
    this.msg.appendChild(el);
    this.after(ms, () => {
      if (el.parentElement === this.msg) el.remove();
    });
  }

  /** A large, centred label that flashes for ~800 ms to announce the phase. */
  private showPhaseLabel(text: string) {
    this.phaseLabel.innerHTML = "";
    const el = document.createElement("div");
    el.className = "pt-phase-text";
    el.textContent = text;
    this.phaseLabel.hidden = false;
    this.phaseLabel.appendChild(el);
    this.after(800, () => {
      if (el.parentElement === this.phaseLabel) el.remove();
      if (!this.phaseLabel.firstChild) this.phaseLabel.hidden = true;
    });
  }
}

function easeOutBack(t: number) {
  const c = 1.70158;
  const x = Math.min(1, Math.max(0, t)) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pictureTrail: GameDefinition = { manifest, create: () => new PictureTrail(), strings };
export default pictureTrail;
