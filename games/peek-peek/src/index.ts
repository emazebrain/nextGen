/**
 * Peek Peek (design doc §8.4) on the eMazeBrain Game SDK. The game draws the
 * board and reports events; Session Rules (in the runtime) owns time and
 * session lives. With lives = auto the game keeps a per-board heart budget and
 * shows it in the shared HUD (ADR 0012).
 *
 * Look by hemisphere: left → warm "Treasure Garden" (terracotta pots), right →
 * cold "Under the Sea" (clam shells). Art is drawn in code until the
 * commissioned illustrations arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, Polygon, Sprite, Texture, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus } from "@emb/game-sdk";
import type { Board } from "./board.ts";
import { clamp, MAX_LEVEL, type Difficulty } from "./config.ts";
import { PeekPeekEngine, type LivesModel, type TapResult } from "./engine.ts";
import type { LevelRecord } from "./metrics.ts";
import { PACK_NAMES, PACKS, packForLevel, type PackName } from "./pictures.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const TRAY_SPACE = 132;
const EDGE = 20;
const SQRT3 = Math.sqrt(3);
const WRONG_SHOW_MS = 700;
const REVEAL_MS = 2000;
const DEBOUNCE_MS = 120;
const ACCIDENTAL_MS = 160;

interface Look {
  sky: [string, string];
  ground: string;
  groundEdge: string;
  panel: string;
  panelEdge: string;
  cover: string;
  coverEdge: string;
  coverShine: string;
  face: string;
  light: string;
  found: string;
  ink: string;
  burst: string[];
}
/** Warm "Treasure Garden" and cold "Under the Sea" (design doc §8.4 asset table). */
const LOOKS: Record<"warm" | "cold", Look> = {
  warm: {
    sky: ["#FFF1D9", "#FFD9A3"], ground: "#D9743E", groundEdge: "#A8522A", panel: "#FFF8EC", panelEdge: "#7A2420",
    cover: "#CB6843", coverEdge: "#7A2420", coverShine: "#E58A5E", face: "#FFF4E2", light: "#FFB347", found: "#3E9B5A", ink: "#3B1A12",
    burst: ["#F2B8C6", "#F7D04A", "#F28C5A", "#FFFFFF"],
  },
  cold: {
    sky: ["#E3F5FC", "#A9DAEF"], ground: "#F0DFB4", groundEdge: "#CDB680", panel: "#F4FAFF", panelEdge: "#232C6B",
    cover: "#2A8FD8", coverEdge: "#232C6B", coverShine: "#62B4EC", face: "#EAF5FF", light: "#4FA3FF", found: "#2F9A8A", ink: "#0E1530",
    burst: ["#BFE9FF", "#FFFFFF", "#7FD3F5", "#B7F0E8"],
  },
};

interface TileView {
  hex: string;
  root: Container;
  face: Container;
  cover: Graphics;
  ring: Graphics;
  x: number;
  y: number;
}

interface Timer {
  left: number;
  fn: () => void;
}

class PeekPeek implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private engine!: PeekPeekEngine;
  private look!: Look;
  private lives: LivesModel = "none";
  private packParam: PackName | "rotate" = "marine";
  private hiddenCount = false;
  private controlTrials = true;
  private studyOverride: number | null = null;
  private difficulty: Difficulty = 3;
  private textures = new Map<string, Texture>();
  private bg = new Graphics();
  private boardLayer = new Container();
  private fx = new Container();
  private tiles = new Map<string, TileView>();
  private hexR = 40;
  private tray!: HTMLDivElement;
  private msg!: HTMLDivElement;
  private timers: Timer[] = [];
  private clock = 0; // pause-adjusted ms
  private paused = false;
  private ended = false;
  private qualified = false;
  private locked = true;
  private lastTap = -Infinity;
  private selected: string | null = null;
  private keyboard = false;
  private studyLeft = 0;
  private studyTotal = 0;
  private particles: Array<{ g: Graphics; vx: number; vy: number; life: number; spin: number }> = [];
  /** The board being played: the main engine, the practice engine or the control trial. */
  private active: { engine: PeekPeekEngine; kind: "practice" | "control" | "main" } | null = null;
  private practiceDone: (() => void) | null = null;
  private levelTrials = { trials: 0, correct: 0, errors: 0 };

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    this.look = LOOKS[ctx.palette];
    this.difficulty = p.difficulty;
    this.lives = p.session_mode === "timed" ? "none" : p.lives === "auto" ? "board" : "session";
    const own = (k: string) => p[`peek_peek.${k}`];
    const pack = own("pack");
    this.packParam = typeof pack === "string" && (PACK_NAMES as string[]).concat("rotate").includes(pack) ? (pack as PackName | "rotate") : "marine";
    this.hiddenCount = own("hidden_count") === true;
    this.controlTrials = own("control_trials") !== false;
    const st = own("study_time_s");
    this.studyOverride = typeof st === "number" && st >= 2 ? clamp(Math.round(st), 2, 20) : null;
    // One integer from the host's seeded generator drives every board, so a session replays exactly.
    const seed = Math.floor(ctx.rng() * 2 ** 31);
    this.engine = new PeekPeekEngine({
      difficulty: this.difficulty,
      startLevel: typeof p.start_level === "number" ? p.start_level : 1,
      maxLevel: typeof p.max_level === "number" ? p.max_level : MAX_LEVEL,
      lives: this.lives,
      hemisphere: p.hemisphere === "right" ? "right" : "left",
      packFor: (level) => {
        const name = packForLevel(this.packParam, level);
        return { name, size: PACKS[name].length };
      },
      seed,
      studyOverrideS: this.studyOverride,
    });

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the game's DOM text carries meaning
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.boardLayer, this.fx);
    this.fx.eventMode = "none";
    this.buildDom();
    await this.loadPictures();
    this.app.renderer.on("resize", () => {
      this.drawBackground();
      this.layoutBoard();
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
    const practice = new PeekPeekEngine({
      difficulty: 1,
      startLevel: 1,
      maxLevel: 1,
      lives: "none",
      hemisphere: this.ctx.params.hemisphere === "right" ? "right" : "left",
      packFor: () => ({ name: packForLevel(this.packParam, 1), size: 14 }),
      seed: 7,
      studyOverrideS: 5,
      even: true,
    });
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.active = { engine: practice, kind: "practice" };
      this.playBoard(practice.start(this.clock));
    });
    return { trials: 1 };
  }

  start(): void {
    if (this.controlTrials) this.startControl();
    else this.startMain();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  end(status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.locked = true;
    if (this.engine.metrics.inLevel) {
      const rec = this.engine.metrics.endLevel(false, status === "time_up" ? "time_up" : status, 0, this.clock);
      if (rec) this.reportLevel(rec);
    }
    const m = this.engine.metrics.summary({
      maxLevel: this.engine.maxLevel,
      highestLevel: this.engine.highestLevel,
      hemisphere: this.ctx.params.hemisphere,
      pack: this.packParam,
      hiddenCount: this.hiddenCount,
      studyOverrideS: this.studyOverride,
    });
    return { ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)), score: this.engine.score } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    for (const t of this.textures.values()) t.destroy(true);
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private startControl() {
    this.active = { engine: this.engine, kind: "control" };
    const b = this.engine.startControl(this.clock);
    this.drawBoard(b);
    for (const t of this.tiles.values()) this.setOpen(t, true, false);
    this.showTray(b, b.tray[0]!, "control");
    this.locked = false;
  }

  private startMain() {
    this.active = { engine: this.engine, kind: "main" };
    this.playBoard(this.engine.start(this.clock));
  }

  /** Study phase: every picture shown, a countdown, then they hide and the first round begins. */
  private playBoard(b: Board) {
    this.locked = true;
    this.drawBoard(b);
    this.levelTrials = { trials: 0, correct: 0, errors: 0 };
    if (this.active?.kind === "main") this.ctx.session.boardHearts?.(this.engine.hearts ?? b.heartBudget, b.heartBudget);
    for (const t of this.tiles.values()) this.setOpen(t, true, !this.ctx.reducedMotion);
    this.studyTotal = this.studyLeft = b.studySeconds * 1000;
    this.showTray(b, null, "study");
  }

  private endStudy() {
    const a = this.active!;
    for (const t of this.tiles.values()) this.setOpen(t, false, !this.ctx.reducedMotion);
    this.after(this.ctx.reducedMotion ? 150 : 450, () => {
      a.engine.beginHunt(this.clock);
      this.showTray(a.engine.board!, a.engine.target, "hunt");
      this.locked = false;
    });
  }

  private onTileTap(hex: string) {
    if (this.locked || this.ended || this.paused || !this.active) return;
    const since = this.clock - this.lastTap;
    if (since < DEBOUNCE_MS) return;
    this.lastTap = this.clock;
    const a = this.active;
    if (a.kind === "control") return this.onControlTap(hex);
    if (a.kind === "main" && !this.qualified) {
      this.qualified = true;
      this.ctx.session.qualifyingInteraction(); // the clock starts on the first tap after the first study phase
    }
    const result = a.engine.tap(hex, this.clock, since < ACCIDENTAL_MS);
    if (result.kind === "ignored") return;
    if (a.kind === "main") this.report(hex, result, since);
    if (result.kind === "correct") this.onCorrect(hex, result);
    else this.onWrong(hex, result);
  }

  private report(hex: string, r: Exclude<TapResult, { kind: "ignored" }>, since: number) {
    const t = this.tiles.get(hex)!;
    const x = this.engine.xOf(hex);
    const b = this.engine.board!;
    this.levelTrials.trials += 1;
    if (r.kind === "correct") this.levelTrials.correct += 1;
    else this.levelTrials.errors += 1;
    this.ctx.session.trial({
      trialId: `${b.level}.${b.attempt}.${this.levelTrials.trials}`,
      level: b.level,
      stimulusOnMs: Math.round(this.clock - Math.min(since, 60_000)),
      responseMs: Math.round(Math.min(since, 60_000)),
      outcome: r.kind === "correct" ? "correct" : "error",
      target: { x: Math.round(t.x), y: Math.round(t.y), hemifield: x < 0 ? "L" : x > 0 ? "R" : "C" },
      tags: { round: this.engine.roundIndex, probe: b.isProbe ? 1 : 0 },
    });
  }

  private onCorrect(hex: string, r: Extract<TapResult, { kind: "correct" }>) {
    const a = this.active!;
    const t = this.tiles.get(hex)!;
    this.setOpen(t, true, !this.ctx.reducedMotion);
    this.ring(t, this.look.found);
    if (!r.roundDone) {
      this.updateCount();
      return;
    }
    if (!r.levelDone) {
      this.showTray(a.engine.board!, a.engine.target, "hunt");
      return;
    }
    this.locked = true;
    this.burst();
    if (a.kind === "practice") {
      this.after(900, () => {
        this.clearBoard();
        const done = this.practiceDone;
        this.practiceDone = null;
        this.active = null;
        done?.();
      });
      return;
    }
    const rec = this.engine.metrics.levels[this.engine.metrics.levels.length - 1];
    if (rec) this.reportLevel(rec);
    this.say(this.ctx.t("cleared"), 1100);
    this.after(this.ctx.reducedMotion ? 700 : 1200, () => this.nextBoard());
  }

  private onWrong(hex: string, r: Extract<TapResult, { kind: "wrong" }>) {
    const a = this.active!;
    const t = this.tiles.get(hex)!;
    this.locked = true;
    if (a.kind === "main") {
      this.ctx.session.lifeLossEvent("wrong_tile");
      if (r.heartsLeft !== null) this.ctx.session.boardHearts?.(r.heartsLeft, a.engine.board!.heartBudget);
    }
    if (this.ended) return;
    // Wrong: no red, no buzzer. The tapped picture shows with a soft ✕, then the whole board opens as a reminder.
    this.setOpen(t, true, false);
    this.cross(t);
    this.after(WRONG_SHOW_MS, () => {
      for (const v of this.tiles.values()) this.setOpen(v, true, !this.ctx.reducedMotion);
      this.after(REVEAL_MS, () => {
        for (const v of this.tiles.values()) if (!a.engine.found.has(v.hex)) this.setOpen(v, false, !this.ctx.reducedMotion);
        if (r.boardFailed) {
          const rec = this.engine.metrics.levels[this.engine.metrics.levels.length - 1];
          if (rec) this.reportLevel(rec);
          this.nextBoard();
          return;
        }
        this.locked = false;
      });
    });
  }

  private onControlTap(hex: string) {
    const r = this.engine.controlTap(hex, this.clock);
    if (!r) return;
    const t = this.tiles.get(hex)!;
    this.pulse(t);
    if (r.correct) this.ring(t, this.look.found);
    if (r.correct) this.updateCount();
    if (!r.done) return;
    this.locked = true;
    this.say(this.ctx.t("control.done"), 1400);
    this.after(1500, () => this.startMain());
  }

  private nextBoard() {
    if (this.ended) return;
    const next = this.engine.next(this.clock);
    if (next.kind === "finished") {
      this.ctx.session.contentExhausted("max_level");
      return;
    }
    if (next.retry) this.say(this.ctx.t("retry"), 1300);
    if (next.skipped) this.say(this.ctx.t("moveOn"), 1300);
    this.playBoard(next.board);
  }

  private reportLevel(rec: LevelRecord) {
    const row: LevelHistoryRow = {
      level: rec.level,
      durationMs: Math.round(rec.durationMs),
      scoreDelta: rec.score,
      trials: rec.rounds.reduce((a, r) => a + r.taps.length, 0),
      correct: rec.rounds.reduce((a, r) => a + r.taps.filter((x) => x.correct).length, 0),
      errors: rec.rounds.reduce((a, r) => a + r.misses, 0),
      livesLost: this.lives === "board" ? rec.heartsLost : 0,
      outcome: rec.completed ? "cleared" : rec.failReason === "time_up" ? "timeout" : "failed",
      detail: {
        board_id: rec.boardId,
        attempt: rec.attempt,
        total_hexes: rec.T,
        distinct_pictures: rec.K,
        copy_partition: rec.partition,
        realised_adjacency: rec.realisedAdjacency,
        study_seconds: rec.studySeconds,
        heart_budget: rec.heartBudget,
        is_symmetric_probe: rec.isProbe,
        pack: rec.pack,
        fail_reason: rec.failReason,
        rounds: rec.rounds.map((r) => ({ copies: r.copies, misses: r.misses, within: r.within, between: r.between, novel: r.novel, first_tap_correct: r.firstTapCorrect, first_tap_latency_ms: r.firstTapLatencyMs, first_tap_x: r.firstTapX })),
      },
    };
    this.ctx.session.levelComplete(row);
  }

  // ---------------------------------------------------------------- time (pause-aware)

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;
    if (this.studyLeft > 0) {
      this.studyLeft = Math.max(0, this.studyLeft - dt);
      this.updateStudy();
      if (this.studyLeft === 0) this.endStudy();
    }
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    for (const p of this.particles) {
      p.life -= dt;
      p.g.x += p.vx * dt;
      p.g.y += p.vy * dt;
      p.vy += 0.0006 * dt;
      p.g.rotation += p.spin * dt;
      p.g.alpha = clamp(p.life / 400, 0, 1);
    }
    for (const p of this.particles.filter((q) => q.life <= 0)) p.g.destroy();
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  // ---------------------------------------------------------------- pictures

  /** Rasterises the SVG pictures once (the frame allows data: images), so the board draws sprites. */
  private async loadPictures() {
    const packs = this.packParam === "rotate" ? PACK_NAMES : [this.packParam];
    const jobs: Array<Promise<void>> = [];
    for (const name of packs) {
      PACKS[name].forEach((pic, i) => {
        const svg = pic.svg.replace("<svg ", '<svg width="256" height="256" ');
        const img = new Image(256, 256);
        jobs.push(
          new Promise<void>((resolve) => {
            img.onload = () => {
              this.textures.set(`${name}:${i}`, Texture.from(img));
              resolve();
            };
            img.onerror = () => resolve();
          }),
        );
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
      });
    }
    await Promise.all(jobs);
  }

  private pictureFor(b: Board, slot: number): { texture: Texture | undefined; src: string } {
    const pack = packForLevel(this.packParam, b.level);
    const id = b.pictureIds[slot]!;
    const svg = PACKS[pack][id]!.svg;
    return { texture: this.textures.get(`${pack}:${id}`), src: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
  }

  // ---------------------------------------------------------------- drawing

  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const L = this.look;
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: L.sky[0] }, { offset: 1, color: L.sky[1] }], textureSpace: "local" });
    g.rect(0, 0, w, h).fill(sky);
    const groundY = h - Math.min(110, h * 0.14);
    if (this.ctx.palette === "warm") {
      // Garden wall with a few sunflowers.
      g.rect(0, groundY, w, h - groundY).fill({ color: L.ground });
      const bh = 22;
      for (let y = groundY, row = 0; y < h; y += bh, row++) {
        for (let x = (row % 2) * -30; x < w; x += 60) g.roundRect(x + 2, y + 2, 56, bh - 4, 3).fill({ color: L.groundEdge, alpha: 0.35 });
      }
      for (const fx of [0.08, 0.92, 0.2, 0.8]) this.sunflower(g, w * fx, groundY - 6, Math.min(26, w * 0.025));
    } else {
      // Sea floor with seaweed.
      g.rect(0, groundY, w, h - groundY).fill({ color: L.ground });
      g.moveTo(0, groundY).bezierCurveTo(w * 0.3, groundY - 14, w * 0.6, groundY + 12, w, groundY - 6).lineTo(w, groundY + 10).lineTo(0, groundY + 10).fill({ color: L.groundEdge, alpha: 0.4 });
      for (const fx of [0.06, 0.12, 0.88, 0.94]) this.seaweed(g, w * fx, groundY + 4, Math.min(110, h * 0.18));
      for (let i = 0; i < 9; i++) g.circle(w * ((i * 0.37) % 1), h * (0.15 + ((i * 0.23) % 0.5)), 4 + (i % 3) * 3).stroke({ width: 2, color: "#FFFFFF", alpha: 0.6 });
    }
  }

  private sunflower(g: Graphics, x: number, y: number, r: number) {
    g.moveTo(x, y).lineTo(x, y - r * 2.6).stroke({ width: Math.max(3, r * 0.22), color: "#4F8F3A" });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      g.ellipse(x + Math.cos(a) * r * 0.75, y - r * 2.6 + Math.sin(a) * r * 0.75, r * 0.42, r * 0.42).fill({ color: "#F7C531" });
    }
    g.circle(x, y - r * 2.6, r * 0.5).fill({ color: "#7A4A1E" });
  }

  private seaweed(g: Graphics, x: number, y: number, h: number) {
    g.moveTo(x, y).bezierCurveTo(x - 14, y - h * 0.3, x + 14, y - h * 0.6, x - 4, y - h).stroke({ width: 7, color: "#3E9B6A", cap: "round" });
  }

  private clearBoard() {
    for (const c of this.boardLayer.removeChildren()) c.destroy({ children: true });
    this.tiles.clear();
    this.selected = null;
  }

  private drawBoard(b: Board) {
    this.clearBoard();
    const panel = new Graphics();
    panel.label = "panel";
    this.boardLayer.addChild(panel);
    for (const c of b.cells) {
      const root = new Container();
      const face = new Container();
      const cover = new Graphics();
      const ring = new Graphics();
      root.addChild(face, cover, ring);
      root.eventMode = "static";
      root.cursor = "pointer";
      root.on("pointerdown", () => {
        this.keyboard = false;
        this.onTileTap(c.id);
      });
      this.boardLayer.addChild(root);
      this.tiles.set(c.id, { hex: c.id, root, face, cover, ring, x: 0, y: 0 });
    }
    this.layoutBoard();
  }

  /** Sizes the hex board to fit between the HUD and the tray, centred horizontally (hemifield reference). */
  private layoutBoard() {
    const b = this.active?.engine.board;
    if (!b || !this.tiles.size) return;
    const { width: W, height: H } = this.app.screen;
    const xs = b.cells.map((c) => c.cx);
    const ys = b.cells.map((c) => c.cy);
    const bw = Math.max(...xs) - Math.min(...xs) + SQRT3;
    const bh = Math.max(...ys) - Math.min(...ys) + 2;
    const availW = W - EDGE * 2 - 32;
    const availH = H - HUD_SPACE - TRAY_SPACE - 32;
    const R = (this.hexR = clamp(Math.min(availW / bw, availH / bh), 18, 78));
    const cx = W / 2;
    const cy = HUD_SPACE + 16 + availH / 2;
    const panel = this.boardLayer.getChildByLabel("panel") as Graphics;
    const pw = bw * R + 32;
    const ph = bh * R + 32;
    panel.clear();
    panel.roundRect(cx - pw / 2 + 3, cy - ph / 2 + 6, pw, ph, 28).fill({ color: "#000000", alpha: 0.1 });
    panel.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 28).fill({ color: this.look.panel, alpha: 0.94 }).stroke({ width: 5, color: this.look.panelEdge, alpha: 0.85 });
    for (const c of b.cells) {
      const t = this.tiles.get(c.id)!;
      t.x = cx + c.cx * R;
      t.y = cy + c.cy * R;
      t.root.x = t.x;
      t.root.y = t.y;
      const r = R * 0.94;
      const hex = hexPoints(r);
      t.root.hitArea = new Polygon(hexPoints(R * 1.0));
      this.drawFace(t, b, r, hex);
      this.drawCover(t, r, hex);
    }
    this.drawSelection();
  }

  private drawFace(t: TileView, b: Board, r: number, hex: number[]) {
    for (const c of t.face.removeChildren()) c.destroy({ children: true });
    const L = this.look;
    const base = new Graphics().poly(hex).fill({ color: L.face }).stroke({ width: Math.max(2, r * 0.06), color: L.coverEdge, alpha: 0.55 });
    t.face.addChild(base);
    const slot = b.assignment[t.hex]!;
    const pic = this.pictureFor(b, slot);
    if (pic.texture) {
      const s = new Sprite(pic.texture);
      s.anchor.set(0.5);
      s.width = s.height = r * 1.32;
      t.face.addChild(s);
    }
    // Lighting: a soft warm or cool glaze, the same on every tile.
    t.face.addChild(new Graphics().poly(hex).fill({ color: L.light, alpha: 0.1 }));
  }

  private drawCover(t: TileView, r: number, hex: number[]) {
    const L = this.look;
    const g = t.cover;
    g.clear();
    g.poly(hex).fill({ color: L.cover }).stroke({ width: Math.max(2.5, r * 0.08), color: L.coverEdge });
    if (this.ctx.palette === "warm") {
      // Terracotta pot lid: a rim and a knob.
      g.ellipse(0, r * 0.05, r * 0.62, r * 0.5).stroke({ width: Math.max(2, r * 0.06), color: L.coverEdge, alpha: 0.55 });
      g.ellipse(-r * 0.18, -r * 0.2, r * 0.3, r * 0.14).fill({ color: L.coverShine, alpha: 0.8 });
      g.circle(0, -r * 0.02, r * 0.14).fill({ color: L.coverEdge });
    } else {
      // Clam shell: ridges fanning from a hinge.
      for (let i = -2; i <= 2; i++) {
        g.moveTo(0, r * 0.62).lineTo(i * r * 0.26, -r * 0.6).stroke({ width: Math.max(2, r * 0.05), color: L.coverEdge, alpha: 0.4 });
      }
      g.ellipse(-r * 0.2, -r * 0.28, r * 0.24, r * 0.12).fill({ color: L.coverShine, alpha: 0.85 });
      g.roundRect(-r * 0.22, r * 0.5, r * 0.44, r * 0.18, r * 0.08).fill({ color: L.coverEdge });
    }
  }

  /** Opens or closes a tile: the lid lifts (or the shell opens); with reduced motion it simply changes. */
  private setOpen(t: TileView, open: boolean, animate: boolean) {
    const target = open ? 0 : 1;
    if (!animate) {
      t.cover.alpha = target;
      t.cover.y = 0;
      return;
    }
    const from = t.cover.alpha;
    const start = this.clock;
    const dur = 220;
    const step = () => {
      const p = clamp((this.clock - start) / dur, 0, 1);
      const e = 1 - (1 - p) ** 3;
      t.cover.alpha = from + (target - from) * e;
      t.cover.y = open ? -this.hexR * 0.25 * e : -this.hexR * 0.25 * (1 - e);
      if (p < 1) this.after(16, step);
      else t.cover.y = 0;
    };
    step();
  }

  private ring(t: TileView, color: string) {
    t.ring.clear();
    t.ring.poly(hexPoints(this.hexR * 0.98)).stroke({ width: Math.max(3, this.hexR * 0.09), color });
  }

  private cross(t: TileView) {
    const g = new Graphics();
    const r = Math.max(12, this.hexR * 0.32);
    g.circle(0, 0, r).fill({ color: "#FFFFFF" }).stroke({ width: 3, color: this.look.ink });
    g.moveTo(-r * 0.4, -r * 0.4).lineTo(r * 0.4, r * 0.4).moveTo(r * 0.4, -r * 0.4).lineTo(-r * 0.4, r * 0.4).stroke({ width: Math.max(3, r * 0.2), color: this.look.ink, cap: "round" });
    g.x = t.x + this.hexR * 0.45;
    g.y = t.y - this.hexR * 0.45;
    this.fx.addChild(g);
    this.after(WRONG_SHOW_MS + REVEAL_MS, () => g.destroy());
  }

  /** Control trial feedback: a short heartbeat pulse on the tapped tile, right or wrong. */
  private pulse(t: TileView) {
    if (this.ctx.reducedMotion) return;
    const start = this.clock;
    const step = () => {
      const p = clamp((this.clock - start) / 880, 0, 1);
      t.root.scale.set(1 + 0.08 * Math.sin(p * Math.PI * 2) * (1 - p));
      if (p < 1) this.after(16, step);
      else t.root.scale.set(1);
    };
    step();
  }

  /** Board done: a petal burst (warm) or bubble burst (cold). Still sparkles under reduced motion. */
  private burst() {
    const { width: W, height: H } = this.app.screen;
    const cy = HUD_SPACE + (H - HUD_SPACE - TRAY_SPACE) / 2;
    const n = this.ctx.reducedMotion ? 10 : 34;
    for (let i = 0; i < n; i++) {
      const g = new Graphics();
      const c = this.look.burst[i % this.look.burst.length]!;
      if (this.ctx.palette === "warm") g.ellipse(0, 0, 9, 5).fill({ color: c });
      else g.circle(0, 0, 4 + (i % 4) * 2).stroke({ width: 2.5, color: c }).fill({ color: c, alpha: 0.25 });
      const a = (i / n) * Math.PI * 2;
      g.x = W / 2 + (this.ctx.reducedMotion ? Math.cos(a) * 120 : 0);
      g.y = cy + (this.ctx.reducedMotion ? Math.sin(a) * 90 : 0);
      const speed = this.ctx.reducedMotion ? 0 : 0.25 + (i % 5) * 0.06;
      this.fx.addChild(g);
      this.particles.push({ g, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed - (this.ctx.palette === "cold" ? 0.15 : 0), life: this.ctx.reducedMotion ? 600 : 1000, spin: this.ctx.palette === "warm" ? 0.006 : 0 });
    }
  }

  // ---------------------------------------------------------------- keyboard

  private onKey = (e: KeyboardEvent) => {
    const b = this.active?.engine.board;
    if (!b || this.locked || this.paused || this.ended) return;
    const keys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "];
    if (!keys.includes(e.key)) return;
    e.preventDefault();
    this.keyboard = true;
    if (!this.selected) {
      this.selected = b.cells[Math.floor(b.cells.length / 2)]!.id;
      this.drawSelection();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      this.onTileTap(this.selected);
      return;
    }
    const cur = b.cellsById[this.selected]!;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key as "ArrowLeft"]!;
    // The nearest cell in that direction (screen directions: never mirrored, the board is physical).
    let best: string | null = null;
    let bestScore = Infinity;
    for (const c of b.cells) {
      const dx = c.cx - cur.cx;
      const dy = c.cy - cur.cy;
      const along = dx * dir[0]! + dy * dir[1]!;
      if (along <= 0.1) continue;
      const across = Math.abs(dx * dir[1]! - dy * dir[0]!);
      const score = along + across * 2;
      if (score < bestScore) {
        bestScore = score;
        best = c.id;
      }
    }
    if (best) {
      this.selected = best;
      this.drawSelection();
    }
  };

  private drawSelection() {
    for (const t of this.tiles.values()) t.root.getChildByLabel("focus")?.destroy();
    if (!this.keyboard || !this.selected) return;
    const t = this.tiles.get(this.selected);
    if (!t) return;
    const g = new Graphics().poly(hexPoints(this.hexR * 1.06)).stroke({ width: 4, color: "#F5C431" });
    g.label = "focus";
    t.root.addChild(g);
  }

  // ---------------------------------------------------------------- tray and messages (DOM: text follows the language and direction)

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    this.tray = document.createElement("div");
    this.tray.setAttribute("aria-hidden", "true");
    this.tray.style.cssText = `position:absolute;inset-inline:0;inset-block-end:16px;display:flex;justify-content:center;pointer-events:none;font-family:${font}`;
    this.ctx.mount.appendChild(this.tray);
    this.msg = document.createElement("div");
    this.msg.setAttribute("aria-live", "polite");
    this.msg.style.cssText = `position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 4}px;display:flex;justify-content:center;pointer-events:none;font-family:${font}`;
    this.ctx.mount.appendChild(this.msg);
    const style = document.createElement("style");
    style.textContent = `
      .pp-pill{display:flex;align-items:center;gap:14px;padding:10px 20px;border-radius:999px;background:${L.panel};color:${L.ink};border:3px solid ${L.panelEdge};box-shadow:0 6px 18px rgb(0 0 0 / .15);font-size:24px;font-weight:800}
      .pp-pic{width:84px;height:84px;border-radius:18px;background:${L.face};border:3px solid ${L.panelEdge};display:grid;place-items:center}
      .pp-pic img{width:72px;height:72px}
      .pp-dots{display:flex;gap:6px}
      .pp-dot{width:16px;height:16px;border-radius:50%;border:3px solid ${L.panelEdge};background:transparent}
      .pp-dot.on{background:${L.found};border-color:${L.found}}
      .pp-meter{position:relative;width:26px;height:72px;border-radius:14px;border:3px solid ${L.panelEdge};overflow:hidden;background:${L.face}}
      .pp-meter i{position:absolute;inset-inline:0;inset-block-end:0;background:${this.ctx.palette === "warm" ? "#E8B65A" : "#7FD3F5"}}
      .pp-say{padding:8px 18px;border-radius:999px;background:${L.ink};color:#FFFFFF;font-size:22px;font-weight:700}
    `;
    this.ctx.mount.appendChild(style);
  }

  private trayState: { slot: number | null; mode: "study" | "hunt" | "control" } = { slot: null, mode: "study" };

  private showTray(b: Board, slot: number | null, mode: "study" | "hunt" | "control") {
    this.trayState = { slot, mode };
    if (mode === "study") {
      this.tray.innerHTML = `<div class="pp-pill"><span class="pp-meter"><i style="block-size:100%"></i></span><span>${escapeHtml(this.ctx.t("study"))}</span></div>`;
      return;
    }
    const pic = slot === null ? null : this.pictureFor(b, slot);
    const label = mode === "control" ? this.ctx.t("control") : this.ctx.t("find");
    this.tray.innerHTML = `<div class="pp-pill"><span class="pp-pic">${pic ? `<img alt="" src="${pic.src}">` : ""}</span><span>${escapeHtml(label)}</span><span class="pp-dots"></span></div>`;
    this.updateCount();
  }

  /** One dot per copy, filled as they're found (hidden when the step hides the count). */
  private updateCount() {
    const dots = this.tray.querySelector(".pp-dots");
    const a = this.active;
    if (!dots || !a?.engine.board) return;
    if (this.hiddenCount || this.trayState.slot === null) {
      dots.innerHTML = "";
      return;
    }
    const total = a.engine.board.partition[this.trayState.slot]!;
    const found = total - a.engine.copiesLeft;
    dots.innerHTML = Array.from({ length: total }, (_, i) => `<span class="pp-dot ${i < found ? "on" : ""}"></span>`).join("");
  }

  private updateStudy() {
    const bar = this.tray.querySelector<HTMLElement>(".pp-meter i");
    if (bar) bar.style.blockSize = `${(this.studyLeft / Math.max(1, this.studyTotal)) * 100}%`;
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = `<div class="pp-say">${escapeHtml(text)}</div>`;
    this.after(ms, () => {
      if (this.msg.textContent === text) this.msg.innerHTML = "";
    });
  }
}

/** Pointy-top hex corners around (0, 0). */
function hexPoints(r: number): number[] {
  const pts: number[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 90);
    pts.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  return pts;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const peekPeek: GameDefinition = { manifest, create: () => new PeekPeek(), strings };
export default peekPeek;
