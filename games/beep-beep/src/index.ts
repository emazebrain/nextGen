/**
 * Beep Beep (design doc §8.4) on the eMazeBrain Game SDK. The game draws the
 * board and reports events; Session Rules owns time and lives. Running out of
 * moves (lives modes) or of time on a board (when a per-board time limit is set)
 * is reported as a life-loss event, and a fresh board of the same size and
 * depth follows.
 *
 * Look by hemisphere (ADR 0015): left → warm "Desert Rally" with the exit on
 * the right; right → cold "Harbor Rush" with the exit on the left. Boards are
 * stored with the exit on the right and mirrored on screen.
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, Rectangle, type FederatedPointerEvent, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, PauseReason, SessionStatus } from "@emb/game-sdk";
import { drawVehicle, drawWall, LOOKS, shade, type Look } from "./art.ts";
import type { Board, Move } from "./board.ts";
import { BeepEngine } from "./engine.ts";
import { bucket, decodePack, IDLE_HINT_S, MAX_LEVEL, START_LEVEL, type Difficulty } from "./levels.ts";
import rawPack from "./pack.json";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const TOP_BAR = 56;
const BOTTOM_BAR = 104;
const EDGE = 16;
const SLIDE_MS = 140;
const TAP_PX = 8;

interface PieceView {
  idx: number;
  root: Container;
  art: Graphics;
  mark: Graphics;
  /** Shown position along the axis (cells, may be fractional while dragging or animating). */
  shown: number;
}

interface Drag {
  idx: number;
  x0: number;
  y0: number;
  v0: number;
  moved: boolean;
  wrongAxis: boolean;
  min: number;
  max: number;
}

interface Timer {
  left: number;
  fn: () => void;
}

class BeepBeep implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private engine!: BeepEngine;
  private difficulty: Difficulty = 3;
  private mirror = false;
  private enforceBudget = true;
  private hintButton = true;
  private showAnswer = true;
  private undoOn = true;
  private timeLimitMs: number | null = null;
  private idleHintS = 0;
  private bg = new Graphics();
  private boardLayer = new Container();
  private boardG = new Graphics();
  private ghostG = new Graphics();
  private pieceLayer = new Container();
  private fx = new Graphics();
  private views: PieceView[] = [];
  private cell = 60;
  private size = 240;
  private origin = { x: 0, y: 0 };
  private drag: Drag | null = null;
  private anims: Array<{ v: PieceView; from: number; to: number; t: number; dur: number; done?: () => void }> = [];
  private particles: Array<{ x: number; y: number; vx: number; vy: number; life: number; c: string; r: number }> = [];
  private timers: Timer[] = [];
  private clock = 0;
  private paused = false;
  private ended = false;
  private qualified = false;
  private locked = true;
  private practice = false;
  private practiceDone: (() => void) | null = null;
  private idleMs = 0;
  private idleShown = false;
  private highlight: { set: Set<number>; kind: "blockers" | "piece" } | null = null;
  private ghost: Move | null = null;
  private selected = 0;
  private top!: HTMLDivElement;
  private controls!: HTMLDivElement;
  private msg!: HTMLDivElement;
  private pieceList!: HTMLDivElement;
  private btn: Record<"undo" | "reset" | "hint", HTMLButtonElement> = {} as never;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`beep_beep.${k}`];
    this.look = LOOKS[ctx.palette];
    this.difficulty = p.difficulty;
    // The exit sits on the side the hemisphere sees: left hemisphere → exit on the right (ADR 0015).
    this.mirror = p.hemisphere === "right";
    this.enforceBudget = p.session_mode !== "timed";
    this.hintButton = own("hint_button") !== false;
    this.showAnswer = own("show_answer_on_miss") !== false;
    this.undoOn = own("undo") !== false;
    const ha = own("hint_after_s");
    this.idleHintS = typeof ha === "number" && ha > 0 ? Math.min(120, ha) : IDLE_HINT_S[p.difficulty];
    const tw = p.trial_window_ms;
    this.timeLimitMs = typeof tw === "number" && tw > 0 ? Math.max(30_000, Math.min(300_000, tw)) : null;
    const start = typeof p.start_level === "number" ? p.start_level : START_LEVEL[this.difficulty];
    this.engine = new BeepEngine({
      pack: decodePack(rawPack as never),
      difficulty: this.difficulty,
      startLevel: start,
      maxLevel: typeof p.max_level === "number" ? p.max_level : MAX_LEVEL,
      enforceBudget: this.enforceBudget,
      rng: ctx.rng,
    });

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the game's DOM text carries meaning
    ctx.mount.appendChild(this.app.canvas);
    this.boardLayer.addChild(this.boardG, this.pieceLayer, this.ghostG); // the guide arrow sits on top of the vehicles
    this.app.stage.addChild(this.bg, this.boardLayer, this.fx);
    this.fx.eventMode = "none";
    this.app.stage.eventMode = "static";
    this.app.stage.hitArea = this.app.screen;
    this.app.stage.on("pointermove", (e) => this.onDragMove(e));
    this.app.stage.on("pointerup", (e) => this.onDragEnd(e));
    this.app.stage.on("pointerupoutside", (e) => this.onDragEnd(e));
    this.buildDom();
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((tk) => this.tick(tk));
    window.addEventListener("keydown", this.onKey);
    ctx.session.onEnd(() => {
      this.ended = true;
      this.locked = true;
    });
  }

  async startPractice(): Promise<{ trials: number }> {
    // One 3-move board with the next move always shown (§8.4).
    const pack = decodePack(rawPack as never);
    const b = bucket(pack, 4, 3)[0]!;
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.practice = true;
      this.engine.budgetOn = false;
      this.engine.load(b, this.clock, false);
      this.showBoard();
      this.say(this.ctx.t("practice"), 2500);
    });
    this.practice = false;
    this.engine.budgetOn = this.enforceBudget;
    return { trials: 1 };
  }

  start(): void {
    this.engine.metrics.boards.length = 0; // practice is not part of the results
    this.engine.startLevel(this.clock);
    this.showBoard();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
    this.drag = null;
  }

  resume(): void {
    this.paused = false;
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.locked = true;
    const cur = this.engine.metrics.current;
    if (cur) this.engine.metrics.endBoard({ completed: false, failReason: "ended", score: 0, movesUsed: cur.movesUsed, now: this.clock });
    const m = this.engine.metrics.summary();
    return {
      ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)),
      score: this.engine.score,
      highest_level: this.engine.level,
      exit_side: this.mirror ? "left" : "right",
    } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private showBoard() {
    this.locked = false;
    this.idleMs = 0;
    this.idleShown = false;
    this.ghost = this.practice ? this.engine.bestMove() : null;
    this.highlight = this.ghost ? { set: new Set([this.ghost.idx]), kind: "piece" } : null;
    this.selected = 0;
    this.buildPieces();
    this.layout();
    this.updateTop();
    this.renderPieceList();
  }

  private onMoved(idx: number, to: number, viaHint = false) {
    const e = this.engine;
    if (!this.practice && !this.qualified) {
      this.qualified = true;
      this.ctx.session.qualifyingInteraction(); // the clock starts on the first move (§8.4)
    }
    const r = e.move(idx, to, this.clock, viaHint);
    if (r.kind === "ignored") return;
    this.animate(idx, to);
    this.idleMs = 0;
    this.idleShown = false;
    this.ghost = this.practice ? e.bestMove() : null;
    this.highlight = this.ghost ? { set: new Set([this.ghost.idx]), kind: "piece" } : null;
    this.updateTop();
    this.renderPieceList();
    if (r.solved) this.onSolved();
    else if (r.overBudget) this.onFailed("budget");
    this.drawMarks();
  }

  private onSolved() {
    this.locked = true;
    const e = this.engine;
    // The hero drives out through the exit.
    const hero = this.views[0]!;
    this.after(SLIDE_MS, () => this.anims.push({ v: hero, from: hero.shown, to: e.board.n + 1, t: 0, dur: this.ctx.reducedMotion ? 200 : 520 }));
    this.burst();
    if (this.practice) {
      this.after(1200, () => {
        const done = this.practiceDone;
        this.practiceDone = null;
        done?.();
      });
      return;
    }
    this.reportBoard();
    this.say(this.ctx.t("cleared"), 1100);
    this.after(1300, () => {
      if (this.ended) return;
      const next = e.nextLevel(this.clock);
      if (!next) {
        this.ctx.session.contentExhausted("max_level");
        return;
      }
      this.showBoard();
    });
  }

  private onFailed(reason: "budget" | "time") {
    const e = this.engine;
    if (reason === "time") e.fail("time", this.clock);
    this.locked = true;
    this.reportBoard();
    this.ctx.session.lifeLossEvent(reason === "budget" ? "move_budget" : "board_time");
    if (this.ended) return;
    this.say(this.ctx.t(reason === "budget" ? "fail.budget" : "fail.time"), 1600);
    // Show the right next move for a moment (v1 show_answer_on_miss).
    if (this.showAnswer) {
      const m = e.bestMove();
      if (m) {
        this.ghost = m;
        this.highlight = { set: new Set([m.idx]), kind: "piece" };
        this.drawMarks();
      }
    }
    this.after(1700, () => {
      if (this.ended) return;
      e.replacement(this.clock);
      this.showBoard();
    });
  }

  private reportBoard() {
    const rec = this.engine.metrics.boards.at(-1);
    if (!rec) return;
    this.ctx.session.trial({
      trialId: `${rec.level}.${this.engine.metrics.boards.length}`,
      level: rec.level,
      stimulusOnMs: Math.round(rec.start),
      responseMs: rec.firstMoveMs === null ? null : Math.round(rec.firstMoveMs),
      outcome: rec.completed ? "correct" : rec.failReason === "time" ? "timeout" : "error",
      tags: { grid: rec.grid, optimal: rec.optimal, moves: rec.movesUsed, hints: rec.hints },
    });
    this.ctx.session.levelComplete({
      level: rec.level,
      durationMs: Math.round(rec.end - rec.start),
      scoreDelta: rec.score,
      trials: rec.moves.length,
      correct: rec.moves.filter((m) => m.cls === "progressive").length,
      errors: rec.moves.filter((m) => m.cls === "regressive").length,
      livesLost: rec.completed ? 0 : 1,
      outcome: rec.completed ? "cleared" : rec.failReason === "time" ? "timeout" : "failed",
      detail: { board_id: rec.boardId, grid: rec.grid, optimal: rec.optimal, budget: rec.budget, moves_used: rec.movesUsed, replacement: rec.replacement, undos: rec.undos, resets: rec.resets, hints: rec.hints, fail_reason: rec.failReason },
    });
  }

  private doUndo() {
    if (this.locked || !this.undoOn || !this.engine.undo(this.clock)) return;
    this.syncAll();
  }

  private doReset() {
    if (this.locked || !this.undoOn || !this.engine.reset(this.clock)) return;
    this.syncAll();
  }

  private doHint() {
    if (this.locked || !this.hintButton) return;
    const h = this.engine.hint(this.clock);
    this.idleMs = 0;
    if (h.rung === 4 && h.move && h.result?.kind === "moved") {
      this.animate(h.move.idx, h.move.to);
      this.highlight = null;
      this.ghost = null;
      this.updateTop();
      this.renderPieceList();
      if (h.result.solved) this.onSolved();
      else if (h.result.overBudget) this.onFailed("budget");
    } else if (h.rung === 1) {
      this.highlight = { set: h.blockers, kind: "blockers" };
      this.ghost = null;
    } else if (h.move) {
      this.highlight = { set: new Set([h.move.idx]), kind: "piece" };
      this.ghost = h.rung >= 3 ? h.move : null;
    }
    this.drawMarks();
  }

  private syncAll() {
    for (const v of this.views) this.animate(v.idx, this.engine.state[v.idx]!);
    this.highlight = null;
    this.ghost = this.practice ? this.engine.bestMove() : null;
    this.idleMs = 0;
    this.updateTop();
    this.renderPieceList();
    this.drawMarks();
  }

  // ---------------------------------------------------------------- time (pause-aware)

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
    for (const a of this.anims) {
      a.t += dt;
      const p = Math.min(1, a.t / a.dur);
      a.v.shown = a.from + (a.to - a.from) * (1 - (1 - p) ** 3);
      this.place(a.v);
      if (p >= 1) a.done?.();
    }
    this.anims = this.anims.filter((a) => a.t < a.dur);
    // Idle hint: after a quiet spell, the blockers glow (not counted as a hint).
    const idleS = this.idleHintS;
    if (!this.locked && !this.practice && idleS > 0 && !this.highlight) {
      this.idleMs += dt;
      if (this.idleMs >= idleS * 1000 && !this.idleShown) {
        this.idleShown = true;
        this.highlight = { set: this.engine.blockers(), kind: "blockers" };
        this.drawMarks();
      }
    }
    // Per-board time limit, when the step sets one (counts from the first move on the first board).
    if (this.timeLimitMs && !this.locked && !this.practice && this.qualified) {
      const left = this.timeLimitMs - this.engine.elapsed(this.clock);
      this.updateTimeBar(left / this.timeLimitMs);
      if (left <= 0) this.onFailed("time");
    }
    this.tickParticles(dt);
  }

  // ---------------------------------------------------------------- drawing

  private layout() {
    const { width: W, height: H } = this.app.screen;
    this.drawBackground(W, H);
    const n = this.engine.board?.n ?? 4;
    const availW = W - EDGE * 2;
    const availH = H - HUD_SPACE - TOP_BAR - BOTTOM_BAR;
    // Room for the frame (0.3 cell each side) and the exit stub (1 cell) beside the board.
    this.cell = Math.max(28, Math.min(availW / (n + 1.6), availH / (n + 0.6), 110));
    this.size = this.cell * n;
    const exitStub = this.cell;
    const x = (W - this.size) / 2 + (this.mirror ? exitStub / 2 : -exitStub / 2);
    const y = HUD_SPACE + TOP_BAR + (availH - this.size) / 2;
    this.origin = { x, y };
    // Mirroring: the board's own coordinates keep the exit on the right; the layer flips it on screen.
    this.boardLayer.scale.x = this.mirror ? -1 : 1;
    this.boardLayer.position.set(this.mirror ? x + this.size : x, y);
    this.drawBoard();
    for (const v of this.views) {
      const p = this.engine.board.pieces[v.idx]!;
      drawVehicle(v.art, this.look, p.len, this.cell, v.idx === 0 ? this.look.hero : this.colourOf(v.idx), v.idx === 0);
      this.place(v);
    }
    this.drawMarks();
  }

  private drawBackground(W: number, H: number) {
    const L = this.look;
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: L.sky[0] }, { offset: 1, color: L.sky[1] }], textureSpace: "local" });
    g.rect(0, 0, W, H).fill(sky);
    if (L.name === "warm") {
      // Dunes and a little town on the horizon.
      for (let i = 0; i < 6; i++) g.rect(W * (0.05 + i * 0.16), H * 0.2 - (i % 3) * 14, 26 + (i % 2) * 18, 30 + (i % 3) * 14).fill({ color: "#E7A96B", alpha: 0.55 });
      g.moveTo(0, H * 0.32).bezierCurveTo(W * 0.3, H * 0.22, W * 0.6, H * 0.4, W, H * 0.28).lineTo(W, H).lineTo(0, H).fill({ color: L.ground });
      g.moveTo(0, H * 0.55).bezierCurveTo(W * 0.4, H * 0.45, W * 0.7, H * 0.62, W, H * 0.5).lineTo(W, H).lineTo(0, H).fill({ color: shade(L.ground, -0.08) });
    } else {
      // Port cranes and the sea.
      for (let i = 0; i < 3; i++) {
        const x = W * (0.12 + i * 0.36);
        g.rect(x, H * 0.1, 6, H * 0.18).fill({ color: "#5B7A99", alpha: 0.6 });
        g.rect(x - 30, H * 0.1, 70, 5).fill({ color: "#5B7A99", alpha: 0.6 });
      }
      g.rect(0, H * 0.28, W, H).fill({ color: L.ground });
      for (let i = 0; i < 14; i++) {
        const y = H * (0.34 + ((i * 0.37) % 0.6));
        const x = W * ((i * 0.53) % 1);
        g.moveTo(x, y).quadraticCurveTo(x + 12, y - 6, x + 24, y).stroke({ width: 2, color: "#FFFFFF", alpha: 0.35 });
      }
    }
  }

  private drawBoard() {
    const L = this.look;
    const b = this.engine.board;
    const g = this.boardG;
    const c = this.cell;
    const s = this.size;
    const f = c * 0.3;
    g.clear();
    // Shadow, frame (with the exit gap on the right in board coordinates), and the floor.
    g.roundRect(-f + 4, -f + 8, s + f * 2, s + f * 2, f).fill({ color: "#000000", alpha: 0.15 });
    g.roundRect(-f, -f, s + f * 2, s + f * 2, f).fill({ color: L.frame }).stroke({ width: 3, color: L.frameEdge });
    g.rect(0, 0, s, s).fill({ color: L.board });
    for (let i = 1; i < b.n; i++) {
      g.moveTo(i * c, 0).lineTo(i * c, s).stroke({ width: L.name === "warm" ? 2 : 1.5, color: L.boardLine, alpha: 0.8 });
      g.moveTo(0, i * c).lineTo(s, i * c).stroke({ width: L.name === "warm" ? 2 : 1, color: L.boardLine, alpha: L.name === "warm" ? 0.8 : 0.35 });
    }
    if (L.name === "cold") {
      // Rope along the dock edge.
      g.roundRect(-f * 0.5, -f * 0.5, s + f, s + f, f * 0.6).stroke({ width: 3, color: "#F5EBD2", alpha: 0.9 });
    }
    // Exit: the gap, a lane stub outside, and an arch with flags (warm) or a lighthouse (cold).
    const ey = b.exitRow * c;
    g.rect(s - 1, ey, f + 2, c).fill({ color: L.board });
    g.rect(s + f, ey, c * 0.9, c).fill({ color: L.board, alpha: 0.75 });
    for (let k = 0; k < 2; k++) {
      const x = s + f + c * (0.15 + k * 0.35);
      g.poly([x, ey + c * 0.3, x + c * 0.18, ey + c * 0.5, x, ey + c * 0.7]).fill({ color: L.ghost, alpha: 0.8 });
    }
    if (L.name === "warm") {
      g.rect(s + f * 0.2, ey - c * 0.35, c * 0.1, c * 0.4).fill({ color: L.frameEdge });
      g.rect(s + f * 0.2, ey + c * 0.95, c * 0.1, c * 0.4).fill({ color: L.frameEdge });
      g.poly([s + f * 0.25 + c * 0.05, ey - c * 0.35, s + f * 0.25 + c * 0.35, ey - c * 0.25, s + f * 0.25 + c * 0.05, ey - c * 0.15]).fill({ color: "#E0483A" });
      g.poly([s + f * 0.25 + c * 0.05, ey + c * 1.0, s + f * 0.25 + c * 0.35, ey + c * 1.1, s + f * 0.25 + c * 0.05, ey + c * 1.2]).fill({ color: "#F5C431" });
    } else {
      const lx = s + f + c * 0.95;
      const ly = ey - c * 0.6;
      g.poly([lx, ly + c * 0.6, lx + c * 0.12, ly, lx + c * 0.28, ly, lx + c * 0.4, ly + c * 0.6]).fill({ color: "#FFFFFF" }).stroke({ width: 2, color: "#C0392B" });
      g.rect(lx + c * 0.08, ly + c * 0.22, c * 0.24, c * 0.12).fill({ color: "#C0392B" });
      g.circle(lx + c * 0.2, ly - c * 0.06, c * 0.08).fill({ color: "#F5C431" });
    }
    for (const [r, cc] of b.walls) drawWall(g, L, cc * c, r * c, c);
  }

  private colourOf(idx: number) {
    return this.look.blockers[(idx - 1) % this.look.blockers.length]!;
  }

  private buildPieces() {
    for (const c of this.pieceLayer.removeChildren()) c.destroy({ children: true });
    this.views = [];
    this.anims = [];
    const b = this.engine.board;
    b.pieces.forEach((p, idx) => {
      const root = new Container();
      const art = new Graphics();
      const mark = new Graphics();
      root.addChild(art, mark);
      root.eventMode = "static";
      root.cursor = "grab";
      root.on("pointerdown", (e) => this.onDragStart(idx, e));
      this.pieceLayer.addChild(root);
      const v: PieceView = { idx, root, art, mark, shown: this.engine.state[idx]! };
      this.views.push(v);
      void p;
    });
  }

  /** Positions a piece at its shown position (board coordinates; upright pieces are turned 90°). */
  private place(v: PieceView) {
    const p = this.engine.board.pieces[v.idx]!;
    const c = this.cell;
    if (p.horiz) {
      v.root.rotation = 0;
      v.root.position.set(v.shown * c, p.fixed * c);
    } else {
      v.root.rotation = Math.PI / 2;
      v.root.position.set((p.fixed + 1) * c, v.shown * c);
    }
    v.root.hitArea = new Rectangle(0, 0, p.len * c, c);
  }

  private animate(idx: number, to: number) {
    const v = this.views[idx];
    if (!v) return;
    this.anims = this.anims.filter((a) => a.v !== v);
    if (this.ctx.reducedMotion) {
      v.shown = to;
      this.place(v);
      return;
    }
    this.anims.push({ v, from: v.shown, to, t: 0, dur: SLIDE_MS });
  }

  /** Hint highlights, the ghost of the next move, and the keyboard selection. */
  private drawMarks() {
    const c = this.cell;
    const L = this.look;
    const b = this.engine.board;
    if (!b) return;
    for (const v of this.views) {
      const p = b.pieces[v.idx]!;
      v.mark.clear();
      const on = this.highlight?.set.has(v.idx);
      if (on) v.mark.roundRect(-3, -3, p.len * c + 6, c + 6, c * 0.22).stroke({ width: Math.max(3, c * 0.07), color: this.highlight!.kind === "piece" ? L.ghost : L.glow, alpha: 0.95 });
      if (this.keyboardOn && this.selected === v.idx) v.mark.roundRect(-6, -6, p.len * c + 12, c + 12, c * 0.26).stroke({ width: 4, color: "#F5C431" });
    }
    const g = this.ghostG;
    g.clear();
    const m = this.ghost;
    if (!m) return;
    const p = b.pieces[m.idx]!;
    const x = p.horiz ? m.to * c : p.fixed * c;
    const y = p.horiz ? p.fixed * c : m.to * c;
    const w = p.horiz ? p.len * c : c;
    const h = p.horiz ? c : p.len * c;
    g.roundRect(x + 3, y + 3, w - 6, h - 6, c * 0.2).fill({ color: L.ghost, alpha: 0.18 }).stroke({ width: 3, color: L.ghost, alpha: 0.9 });
    // An arrow from the piece to where it goes.
    const fx = p.horiz ? m.from * c + (p.len * c) / 2 : p.fixed * c + c / 2;
    const fy = p.horiz ? p.fixed * c + c / 2 : m.from * c + (p.len * c) / 2;
    const tx = x + w / 2;
    const ty = y + h / 2;
    const ang = Math.atan2(ty - fy, tx - fx);
    g.moveTo(fx, fy).lineTo(tx, ty).stroke({ width: Math.max(4, c * 0.09), color: L.ghost, cap: "round" });
    const a = c * 0.22;
    g.poly([tx, ty, tx - Math.cos(ang - 0.5) * a, ty - Math.sin(ang - 0.5) * a, tx - Math.cos(ang + 0.5) * a, ty - Math.sin(ang + 0.5) * a]).fill({ color: L.ghost });
  }

  private burst() {
    const b = this.engine.board;
    const c = this.cell;
    const exitX = this.mirror ? this.origin.x : this.origin.x + this.size;
    const exitY = this.origin.y + (b.exitRow + 0.5) * c;
    const n = this.ctx.reducedMotion ? 8 : 26;
    const cols = this.look.name === "warm" ? ["#E9B872", "#F2D7A6", "#C99A5E"] : ["#FFFFFF", "#BFE9FF", "#6CC4E8"];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const sp = this.ctx.reducedMotion ? 0 : 0.08 + (i % 4) * 0.04;
      this.particles.push({ x: exitX + (this.ctx.reducedMotion ? Math.cos(a) * c : 0), y: exitY + (this.ctx.reducedMotion ? Math.sin(a) * c : 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 700, c: cols[i % cols.length]!, r: 3 + (i % 3) * 2 });
    }
  }

  private tickParticles(dt: number) {
    const g = this.fx;
    g.clear();
    for (const p of this.particles) {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      g.circle(p.x, p.y, p.r).fill({ color: p.c, alpha: Math.max(0, Math.min(1, p.life / 300)) });
    }
    this.particles = this.particles.filter((p) => p.life > 0);
  }

  // ---------------------------------------------------------------- input: drag and tap

  /** Screen direction → board direction along a horizontal axis (the board is mirrored for an exit on the left). */
  private sx(dx: number) {
    return this.mirror ? -dx : dx;
  }

  private onDragStart(idx: number, e: FederatedPointerEvent) {
    if (this.locked || this.paused || this.drag) return;
    this.keyboardOn = false;
    this.selected = idx;
    this.engine.metrics.touch(idx === 0);
    const r = this.engine.range(idx);
    this.drag = { idx, x0: e.global.x, y0: e.global.y, v0: this.engine.state[idx]!, moved: false, wrongAxis: false, min: r.min, max: r.max };
  }

  private onDragMove(e: FederatedPointerEvent) {
    const d = this.drag;
    if (!d || this.locked) return;
    const p = this.engine.board.pieces[d.idx]!;
    const dx = e.global.x - d.x0;
    const dy = e.global.y - d.y0;
    const along = p.horiz ? this.sx(dx) : dy;
    const across = p.horiz ? dy : dx;
    if (!d.moved && Math.abs(across) > Math.abs(along) + 6 && Math.abs(across) > 14) {
      if (!d.wrongAxis) this.engine.metrics.wrongAxisDrags += 1; // cars only go along their length
      d.wrongAxis = true;
      return;
    }
    if (d.wrongAxis) return;
    if (Math.abs(along) > TAP_PX) d.moved = true;
    if (!d.moved) return;
    const v = this.views[d.idx]!;
    v.shown = Math.max(d.min, Math.min(d.max, d.v0 + along / this.cell));
    this.place(v);
  }

  private onDragEnd(e: FederatedPointerEvent) {
    const d = this.drag;
    this.drag = null;
    if (!d || this.locked) return;
    const p = this.engine.board.pieces[d.idx]!;
    const v = this.views[d.idx]!;
    if (d.wrongAxis) return;
    if (d.moved) {
      const to = Math.round(v.shown);
      if (to !== d.v0) this.onMoved(d.idx, to);
      else {
        this.animate(d.idx, d.v0);
        this.engine.metrics.blockedDrags += 1;
      }
      return;
    }
    // A tap sends the piece as far as it can go towards the tapped end (v1).
    const local = v.root.toLocal(e.global);
    const dir = local.x > (p.len * this.cell) / 2 ? 1 : -1; // in the piece's own frame: +x is along its axis
    const to = dir > 0 ? d.max : d.min;
    if (to !== d.v0) this.onMoved(d.idx, to);
    else this.engine.metrics.blockedDrags += 1;
  }

  // ---------------------------------------------------------------- keyboard

  private keyboardOn = false;

  private onKey = (e: KeyboardEvent) => {
    if (this.paused || this.ended) return;
    const k = e.key.toLowerCase();
    if (k === "u") return this.doUndo();
    if (k === "r") return this.doReset();
    if (k === "h") return this.doHint();
    if (!["arrowleft", "arrowright", "arrowup", "arrowdown"].includes(k) || this.locked) return;
    e.preventDefault();
    this.keyboardOn = true;
    this.moveSelected(k);
  };

  private moveSelected(k: string) {
    const idx = this.selected;
    const p = this.engine.board.pieces[idx]!;
    const horizKey = k === "arrowleft" || k === "arrowright";
    if (horizKey !== p.horiz) {
      this.engine.metrics.wrongAxisDrags += 1;
      this.drawMarks();
      return;
    }
    // Screen directions, never mirrored: right is right on screen.
    const screen = k === "arrowright" || k === "arrowdown" ? 1 : -1;
    const dir = p.horiz ? this.sx(screen) : screen;
    const r = this.engine.range(idx);
    const to = Math.max(r.min, Math.min(r.max, this.engine.state[idx]! + dir));
    if (to !== this.engine.state[idx]) this.onMoved(idx, to);
    else this.engine.metrics.blockedDrags += 1;
    this.drawMarks();
  }

  // ---------------------------------------------------------------- DOM: moves, buttons, messages, vehicle list

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    style.textContent = `
      .bb-top{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 6}px;display:flex;justify-content:center;gap:10px;pointer-events:none;font-family:${font}}
      .bb-pill{display:flex;align-items:center;gap:8px;padding:6px 16px;border-radius:999px;background:#FFFFFF;color:${L.ink};border:3px solid ${L.frameEdge};font-size:20px;font-weight:800}
      .bb-pill.low{border-color:#C0392B}
      .bb-time{inline-size:120px;block-size:10px;border-radius:999px;background:rgb(0 0 0 / .12);overflow:hidden}
      .bb-time i{display:block;block-size:100%;background:${L.ghost}}
      .bb-controls{position:absolute;inset-inline:0;inset-block-end:24px;display:flex;justify-content:center;gap:16px;font-family:${font}}
      .bb-btn{min-inline-size:64px;block-size:64px;padding-inline:16px;border-radius:20px;border:3px solid ${L.frameEdge};background:#FFFFFF;color:${L.ink};font:800 18px ${font};display:flex;align-items:center;gap:8px;cursor:pointer;touch-action:manipulation}
      .bb-btn:disabled{opacity:.45;cursor:default}
      .bb-btn:focus-visible,.bb-list button:focus-visible{outline:4px solid #F5C431;outline-offset:3px}
      .bb-btn[hidden]{display:none}
      .bb-msg{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + TOP_BAR + 8}px;display:flex;justify-content:center;pointer-events:none;font-family:${font}}
      .bb-say{padding:8px 18px;border-radius:999px;background:${L.ink};color:#FFFFFF;font-size:20px;font-weight:700}
      .bb-list{position:absolute;inline-size:1px;block-size:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    `;
    this.ctx.mount.appendChild(style);
    this.top = document.createElement("div");
    this.top.className = "bb-top";
    this.top.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.top);
    this.controls = document.createElement("div");
    this.controls.className = "bb-controls";
    const icon = (d: string) => `<svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    const make = (key: "undo" | "reset" | "hint", d: string, fn: () => void) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "bb-btn";
      b.innerHTML = `${icon(d)}<span>${this.ctx.t(key)}</span>`;
      if (key === "reset") b.setAttribute("aria-label", this.ctx.t("reset"));
      b.addEventListener("click", fn);
      this.btn[key] = b;
      this.controls.appendChild(b);
    };
    make("undo", "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3", () => this.doUndo());
    make("reset", "M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5", () => this.doReset());
    make("hint", "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z", () => this.doHint());
    this.btn.reset.querySelector("span")!.remove(); // icon only; the button keeps its name for screen readers
    this.btn.undo.hidden = this.btn.reset.hidden = !this.undoOn;
    this.btn.hint.hidden = !this.hintButton;
    this.ctx.mount.appendChild(this.controls);
    this.msg = document.createElement("div");
    this.msg.className = "bb-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
    this.pieceList = document.createElement("div");
    this.pieceList.className = "bb-list";
    this.pieceList.setAttribute("role", "group");
    this.pieceList.setAttribute("aria-label", this.ctx.t("vehicles"));
    this.ctx.mount.appendChild(this.pieceList);
  }

  private updateTop() {
    const e = this.engine;
    if (!e.board) return;
    const low = e.budgetOn && e.budget - e.moveCount <= 2;
    const moves = e.budgetOn ? this.ctx.t("moves", { n: e.moveCount, budget: e.budget }) : this.ctx.t("moves.free", { n: e.moveCount });
    const level = this.practice ? "" : `<span class="bb-pill">${escapeHtml(this.ctx.t("level", { n: e.level }))}</span>`;
    const time = this.timeLimitMs && !this.practice ? `<span class="bb-pill"><span class="bb-time"><i style="inline-size:100%"></i></span></span>` : "";
    this.top.innerHTML = `${level}<span class="bb-pill ${low ? "low" : ""}" data-moves>${escapeHtml(moves)}</span>${time}`;
    this.btn.undo.disabled = !e.canUndo;
    this.btn.reset.disabled = e.moveCount === 0 || e.solved || e.failed;
  }

  private updateTimeBar(frac: number) {
    const i = this.top.querySelector<HTMLElement>(".bb-time i");
    if (i) i.style.inlineSize = `${Math.max(0, Math.min(1, frac)) * 100}%`;
  }

  /**
   * Hidden buttons, one per vehicle, for screen readers, switch access and tests: focusing one selects it, and the
   * arrow keys slide it a cell at a time.
   */
  private renderPieceList() {
    const e = this.engine;
    const hadFocus = this.pieceList.contains(document.activeElement);
    const pal = this.look.name;
    this.pieceList.replaceChildren(
      ...e.board.pieces.map((p, idx) => {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.piece = String(idx);
        const name = idx === 0 ? this.ctx.t(`hero.${pal}`) : this.ctx.t(`blocker.${pal}.${p.len}`, { colour: this.ctx.t(`colour.${pal}.${(idx - 1) % 6}`) });
        b.textContent = `${name}, ${this.ctx.t(p.horiz ? "dir.h" : "dir.v")}`;
        b.addEventListener("focus", () => {
          this.selected = idx;
          this.keyboardOn = true;
          this.drawMarks();
        });
        b.addEventListener("keydown", (ev) => {
          const k = ev.key.toLowerCase();
          if (!k.startsWith("arrow")) return;
          ev.preventDefault();
          ev.stopPropagation();
          if (!this.locked && !this.paused) this.moveSelected(k);
        });
        return b;
      }),
    );
    if (hadFocus) this.pieceList.querySelector<HTMLButtonElement>(`[data-piece="${this.selected}"]`)?.focus();
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = `<div class="bb-say">${escapeHtml(text)}</div>`;
    this.after(ms, () => {
      if (this.msg.textContent === text) this.msg.innerHTML = "";
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const beepBeep: GameDefinition = { manifest, create: () => new BeepBeep(), strings };
export default beepBeep;

export type { Board };
