/**
 * Catch Me If You Can (design doc §8.4) on the eMazeBrain Game SDK.
 * The game draws boards and reports events; Session Rules (in the runtime)
 * owns time and lives. Art is drawn in code from the warm/cold master
 * palettes until the commissioned illustrations arrive (§8.5).
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, Rectangle, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus } from "@emb/game-sdk";
import { backgroundTone, CatchMeEngine, NoRepeatPicker, pickBackground, seeded, type BackgroundTone, type Board, type Outcome, type Stage } from "./logic.ts";
import { hexToRgb, rgbToHex } from "./colors.ts";
import { LEVEL_UP_COUNT, PRAISE_COUNT, strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 84;
const EDGE = 24;

class CatchMe implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private engine!: CatchMeEngine;
  private bg = new Graphics();
  private boardsLayer = new Container();
  private fx = new Container();
  private stage: Stage | null = null;
  private shownAt = 0;
  private pausedAt: number | null = null;
  private pausedTotal = 0;
  private qualified = false;
  private inputLocked = true;
  private ended = false;
  private paused = false;
  private practiceDone: (() => void) | null = null;
  private practiceLeft = 0;
  private tileRects = new Map<string, { x: number; y: number; size: number; board: Board }>();
  private windowBar = new Graphics();
  private levelStart = { at: 0, trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
  /** Each side looks and rewards differently (ADR 0009): left = flat tiles + messages, right = 3D buttons + confetti. */
  private side: "left" | "right" = "left";
  private mono = false;
  private tone: BackgroundTone = "warm";
  private bgColour = "#FFFFFF";
  private bgSeed = 1;
  private textured = false;
  private motion = false;
  private deco = new Container();
  private drifters: Array<{ g: Container; vx: number; vy: number; sway: number; phase: number }> = [];
  private patternShift = { x: 0, y: 0, cell: 90 };
  private party = new Container();
  private msgLayer!: HTMLDivElement;
  private praise!: NoRepeatPicker;
  private levelLine!: NoRepeatPicker;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    this.side = p.hemisphere === "right" ? "right" : "left";
    this.mono = ctx.monochrome === true;
    this.tone = backgroundTone(p["catch_me_if_you_can.bg_temperature"], this.side, this.mono);
    this.textured = p["catch_me_if_you_can.background"] === "textured";
    this.motion = this.textured && p["catch_me_if_you_can.bg_motion"] === true && !ctx.reducedMotion;
    // Drawn once per session from the seeded generator, before anything else uses it, so a replay looks the same.
    this.bgColour = pickBackground(this.tone, ctx.rng);
    this.bgSeed = Math.floor(ctx.rng() * 2 ** 31);
    this.praise = new NoRepeatPicker(PRAISE_COUNT, ctx.rng, 5);
    this.levelLine = new NoRepeatPicker(LEVEL_UP_COUNT, ctx.rng, 2);
    this.engine = new CatchMeEngine({
      difficulty: p.difficulty,
      ...(typeof p.start_level === "number" ? { startLevel: p.start_level } : {}),
      ...(p.max_level ? { maxLevel: p.max_level } : {}),
      palette: this.mono ? "mono" : ctx.palette,
      cvdMode: p["catch_me_if_you_can.cvd_mode"] === true, // game settings arrive namespaced by game id
      staircase: p.session_mode === "timed",
      rng: ctx.rng,
    });
    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.deco, this.boardsLayer, this.fx, this.party);
    this.party.eventMode = "none";
    this.deco.eventMode = "none";
    this.msgLayer = document.createElement("div");
    this.msgLayer.setAttribute("aria-hidden", "true");
    this.msgLayer.style.cssText = `position:absolute;inset:0;pointer-events:none;display:grid;place-items:center;font-family:ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    ctx.mount.appendChild(this.msgLayer);
    this.app.renderer.on("resize", () => {
      this.drawBackground();
      if (this.stage) this.drawStage(this.stage, false);
    });
    this.app.ticker.add((tk) => this.tick(tk));
    this.drawBackground();
    ctx.session.onEnd(() => {
      this.ended = true;
      this.inputLocked = true;
    });
    ctx.session.onLifeLost(() => {
      // The runtime freezes input for 400 ms after a life is lost; the game's own feedback covers that time too.
    });
  }

  async startPractice(): Promise<{ trials: number }> {
    this.practiceLeft = 3;
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.show(this.engine.practiceStage());
    });
    return { trials: 3 };
  }

  start(): void {
    this.levelStart = { at: performance.now(), trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
    this.show(this.engine.start());
  }

  pause(_reason: PauseReason): void {
    if (this.paused) return;
    this.paused = true;
    this.pausedAt = performance.now();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.pausedAt !== null) this.pausedTotal += performance.now() - this.pausedAt;
    this.pausedAt = null;
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.inputLocked = true;
    const m = this.engine.metrics();
    return Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)) as Record<string, number | string | object>;
  }

  destroy(): void {
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private now(): number {
    return performance.now() - this.pausedTotal - (this.pausedAt !== null ? performance.now() - this.pausedAt : 0);
  }

  private show(stage: Stage) {
    this.stage = stage;
    this.drawStage(stage, true);
    this.shownAt = this.now();
    this.inputLocked = false;
  }

  private windowMs(): number | null {
    const w = this.ctx.params.trial_window_ms;
    return typeof w === "number" && !this.stage?.practice ? w : null;
  }

  private onTap(board: Board, index: number) {
    if (this.inputLocked || this.ended || this.paused || !this.stage) return;
    const s = this.ctx.session;
    if (!this.stage.practice && !this.qualified) {
      this.qualified = true;
      s.qualifyingInteraction(); // the clock starts on the first real tap, never on load
    }
    const rt = Math.round(this.now() - this.shownAt);
    const outcome = this.engine.pick(board.role, index, rt);
    if (!outcome) return;
    this.markPick(board, index);
    if (outcome.kind === "pending") return;
    this.inputLocked = true;
    if (!this.stage.practice) this.report(outcome);
    if (outcome.kind === "correct") this.onCorrect();
    else this.onWrong(outcome);
  }

  private report(outcome: Exclude<Outcome, { kind: "pending" }>) {
    const s = this.ctx.session;
    const st = this.stage!;
    for (const p of outcome.picks) {
      const rect = this.tileRects.get(`${p.role}:${p.index}`);
      s.trial({
        trialId: `${st.level}.${st.stage}.${st.step}.${p.role}`,
        level: st.level,
        stimulusOnMs: Math.round(this.shownAt),
        responseMs: p.rtMs,
        outcome: p.correct ? "correct" : "error",
        ...(rect ? { target: { x: Math.round(rect.x), y: Math.round(rect.y), hemifield: p.hemifield } } : {}),
        tags: { delta_e: Math.round(st.deltaE * 100) / 100, board: p.role, quadrant: p.quadrant, boards: st.boards.length },
      });
      this.levelStart.trials += 1;
      if (p.correct) this.levelStart.correct += 1;
      else this.levelStart.errors += 1;
    }
  }

  private onCorrect() {
    const st = this.stage!;
    const levelUp = this.engine.completesLevel && this.engine.currentLevel < this.engine.maxLevel;
    this.celebrate(levelUp ? this.engine.currentLevel + 1 : null);
    window.setTimeout(() => {
      if (this.ended) return;
      if (st.practice) {
        this.practiceLeft -= 1;
        if (this.practiceLeft <= 0) {
          const done = this.practiceDone;
          this.practiceDone = null;
          this.clearBoards();
          done?.();
          return;
        }
        this.show(this.engine.practiceStage());
        return;
      }
      const before = this.engine.score;
      const next = this.engine.advance();
      this.levelStart.score += this.engine.score - before;
      if (next.levelCompleted !== null) {
        const row: LevelHistoryRow = {
          level: next.levelCompleted,
          durationMs: Math.round(performance.now() - this.levelStart.at),
          scoreDelta: this.levelStart.score,
          trials: this.levelStart.trials,
          correct: this.levelStart.correct,
          errors: this.levelStart.errors,
          livesLost: this.levelStart.livesLost,
          outcome: "cleared",
        };
        this.ctx.session.levelComplete(row);
        this.levelStart = { at: performance.now(), trials: 0, correct: 0, errors: 0, livesLost: 0, score: 0 };
      }
      if (next.finished) {
        this.ctx.session.contentExhausted("max_level");
        return;
      }
      if (next.stage) this.show(next.stage);
    }, this.ctx.reducedMotion ? 450 : levelUp ? 1000 : 750);
  }

  private onWrong(outcome: Extract<Outcome, { kind: "wrong" }>) {
    const st = this.stage!;
    this.gentleMiss(outcome);
    if (!st.practice) {
      this.levelStart.livesLost += 1;
      this.ctx.session.lifeLossEvent("wrong_tile");
    }
    window.setTimeout(() => {
      if (!this.ended) this.show(this.engine.retry());
    }, 1200);
  }

  private onTimeout() {
    if (!this.stage || this.stage.practice) return;
    this.inputLocked = true;
    this.engine.timeout();
    const st = this.stage;
    this.ctx.session.trial({ trialId: `${st.level}.${st.stage}.${st.step}.timeout`, level: st.level, stimulusOnMs: Math.round(this.shownAt), responseMs: null, outcome: "timeout" });
    this.levelStart.livesLost += 1;
    this.ctx.session.lifeLossEvent("trial_timeout");
    for (const b of st.boards) this.revealOdd(b);
    window.setTimeout(() => {
      if (!this.ended) this.show(this.engine.retry());
    }, 1200);
  }

  private tick(tk: Ticker) {
    const w = this.windowMs();
    this.windowBar.clear();
    if (w && this.stage && !this.inputLocked && !this.paused && !this.ended) {
      const left = Math.max(0, w - (this.now() - this.shownAt));
      const frac = left / w;
      const b = this.boardBounds;
      if (b) {
        this.windowBar.roundRect(b.x, b.y - 14, b.w * frac, 6, 3).fill({ color: this.ctx.tokens.g700!, alpha: 0.85 });
      }
      if (left <= 0) this.onTimeout();
    }
    if (this.motion && !this.paused) this.moveBackground(tk.deltaTime);
  }

  // ---------------------------------------------------------------- drawing

  private boardBounds: { x: number; y: number; w: number; h: number } | null = null;

  /**
   * The background (ADR 0009): one colour drawn per session from the tone's palette, solid or textured
   * (flat 2D patterns on the left, shaded 3D shapes on the right), optionally moving. It never touches the
   * tiles: every board keeps its plain light frame.
   */
  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const g = this.bg;
    g.clear();
    for (const c of this.deco.removeChildren()) c.destroy({ children: true });
    this.drifters = [];
    if (!this.textured) {
      g.rect(0, 0, w, h).fill({ color: this.bgColour });
      return;
    }
    const rng = seeded(this.bgSeed); // the same pattern after every resize
    if (this.side === "left") this.drawPattern2d(w, h, rng);
    else this.drawShapes3d(w, h, rng);
  }

  /** Left: a flat pattern of simple shapes in tones of the background colour. */
  private drawPattern2d(w: number, h: number, rng: () => number) {
    this.bg.rect(0, 0, w, h).fill({ color: this.bgColour });
    const cell = Math.max(72, Math.min(110, Math.min(w, h) / 7));
    this.patternShift.cell = cell;
    const layer = new Container();
    const inks = [shade(this.bgColour, -0.1), shade(this.bgColour, -0.18), shade(this.bgColour, 0.35)];
    // One extra row and column all round, so a drifting pattern never shows an edge.
    for (let row = -1, r = 0; row * cell < h + cell; row++, r++) {
      for (let col = -1; col * cell < w + cell; col++) {
        const x = col * cell + (r % 2 ? cell / 2 : 0);
        const y = row * cell;
        const size = cell * (0.16 + rng() * 0.12);
        const ink = inks[Math.floor(rng() * inks.length)]!;
        const kind = Math.floor(rng() * 4);
        const s = new Graphics();
        if (kind === 0) s.circle(0, 0, size).fill({ color: ink });
        else if (kind === 1) s.roundRect(-size, -size, size * 2, size * 2, size * 0.45).fill({ color: ink });
        else if (kind === 2) s.circle(0, 0, size).stroke({ width: Math.max(3, size * 0.32), color: ink });
        else s.poly([0, -size * 1.1, size, size * 0.75, -size, size * 0.75]).fill({ color: ink });
        s.x = x;
        s.y = y;
        s.rotation = kind === 1 || kind === 3 ? rng() * Math.PI : 0;
        layer.addChild(s);
      }
    }
    this.deco.addChild(layer);
    this.deco.x = this.patternShift.x;
    this.deco.y = this.patternShift.y;
  }

  /** Right: shaded 3D spheres and cubes floating over a soft gradient of the background colour. */
  private drawShapes3d(w: number, h: number, rng: () => number) {
    const sky = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [{ offset: 0, color: shade(this.bgColour, 0.3) }, { offset: 1, color: this.bgColour }],
      textureSpace: "local",
    });
    this.bg.rect(0, 0, w, h).fill(sky);
    this.deco.x = 0;
    this.deco.y = 0;
    const count = Math.round(Math.max(10, Math.min(26, (w * h) / 26000)));
    for (let i = 0; i < count; i++) {
      const size = 18 + rng() * 46;
      const base = shade(this.bgColour, -0.12 - rng() * 0.18);
      const shape = rng() < 0.6 ? sphere(size, base) : cube(size, base);
      shape.x = rng() * w;
      shape.y = rng() * h;
      shape.alpha = 0.75;
      this.deco.addChild(shape);
      // Bigger shapes are "nearer", so they drift a little faster (parallax).
      this.drifters.push({ g: shape, vx: (rng() - 0.5) * 0.12, vy: -(0.12 + size / 260), sway: 4 + rng() * 8, phase: rng() * Math.PI * 2 });
    }
  }

  /** Slow movement, only for textured backgrounds and never under reduced motion (ADR 0009). */
  private moveBackground(dt: number) {
    if (this.side === "left") {
      const c = this.patternShift.cell;
      this.patternShift.x = (this.patternShift.x + 0.18 * dt) % c;
      this.patternShift.y = (this.patternShift.y + 0.12 * dt) % (c * 2);
      this.deco.x = this.patternShift.x - c;
      this.deco.y = this.patternShift.y - c * 2;
      return;
    }
    const { width: w, height: h } = this.app.screen;
    for (const d of this.drifters) {
      d.phase += 0.01 * dt;
      d.g.y += d.vy * dt;
      d.g.x += d.vx * dt + Math.sin(d.phase) * 0.15;
      if (d.g.y < -80) d.g.y = h + 80;
      if (d.g.x < -80) d.g.x = w + 80;
      if (d.g.x > w + 80) d.g.x = -80;
    }
  }

  private clearBoards() {
    // The trial-window bar lives on the fx layer but is reused across boards: detach it before destroying the rest,
    // or the next tick draws on a destroyed Graphics, throws, and stops the ticker (the game freezes after one board).
    this.fx.removeChild(this.windowBar);
    for (const c of this.boardsLayer.removeChildren()) c.destroy({ children: true });
    for (const c of this.fx.removeChildren()) c.destroy({ children: true });
    this.tileRects.clear();
    this.boardBounds = null;
  }

  private drawStage(stage: Stage, animate: boolean) {
    this.clearBoards();
    const { width: W, height: H } = this.app.screen;
    const t = this.ctx.tokens;
    const top = HUD_SPACE;
    const availW = W - EDGE * 2;
    const availH = H - top - EDGE;
    const two = stage.boards.length === 2;
    const sideBySide = !two || availW >= availH * 1.15;
    const gap = two ? Math.max(32, availW * 0.06) : 0;
    const boardMax = two ? (sideBySide ? Math.min((availW - gap) / 2, availH) : Math.min(availW, (availH - gap) / 2)) : Math.min(availW, availH);

    const ordered = [...stage.boards].sort((a, b) => (a.side === "left" ? -1 : b.side === "left" ? 1 : 0));
    ordered.forEach((board, i) => {
      // Every board in a stage has the same outer size, so neither side looks "easier" (§8.4 hemifield metrics).
      const size = Math.min(boardMax, 620);
      const cx = two ? (sideBySide ? W / 2 + (i === 0 ? -1 : 1) * (gap / 2 + size / 2) : W / 2) : W / 2;
      const cy = two && !sideBySide ? top + (i === 0 ? size / 2 : size * 1.5 + gap) : top + availH / 2;
      const x = cx - size / 2;
      const y = cy - size / 2;
      if (i === 0) this.boardBounds = { x, y, w: size, h: size };
      const frame = new Graphics();
      frame.roundRect(x + 4, y + 8, size, size, 28).fill({ color: t.g900!, alpha: 0.12 });
      frame.roundRect(x, y, size, size, 28).fill({ color: t.g50! }).stroke({ width: 6, color: t.g800!, alpha: 0.9 });
      this.boardsLayer.addChild(frame);

      const pad = size * 0.07;
      const n = board.size;
      const tileGap = Math.max(6, (size - pad * 2) * 0.05);
      const tile = (size - pad * 2 - tileGap * (n - 1)) / n;
      for (let k = 0; k < n * n; k++) {
        const col = k % n;
        const row = Math.floor(k / n);
        const tx = x + pad + col * (tile + tileGap);
        const ty = y + pad + row * (tile + tileGap);
        const g = new Graphics();
        const r = tile * 0.16;
        const face = k === board.oddIndex ? board.odd : board.base;
        if (this.side === "right") {
          // 3D button (ADR 0009): depth from a neutral side wall and a shadow, identical for every tile.
          // The face is one flat, exact colour, so the ΔE the engine set is the ΔE the child sees.
          const depth = Math.max(4, tile * 0.09);
          g.roundRect(depth * 0.4, depth + 3, tile, tile, r).fill({ color: "#000000", alpha: 0.16 });
          g.roundRect(0, depth, tile, tile, r).fill({ color: "#1E1E24", alpha: 0.55 });
          g.roundRect(0, 0, tile, tile, r).fill({ color: face }).stroke({ width: 1.5, color: "#000000", alpha: 0.22 });
        } else {
          // Flat 2D tile: the face, with a fine neutral outline for definition.
          g.roundRect(0, 0, tile, tile, r).fill({ color: face }).stroke({ width: 2, color: "#000000", alpha: 0.12 });
        }
        g.x = tx;
        g.y = ty;
        g.eventMode = "static";
        g.cursor = "pointer";
        const forgive = Math.min(10, tileGap / 2);
        g.hitArea = new Rectangle(-forgive, -forgive, tile + forgive * 2, tile + forgive * 2);
        g.on("pointerdown", () => this.onTap(board, k));
        if (animate && !this.ctx.reducedMotion) {
          g.alpha = 0;
          const delay = (row + col) * 18;
          this.animate(220, (p) => (g.alpha = p), delay);
        }
        this.boardsLayer.addChild(g);
        this.tileRects.set(`${board.role}:${k}`, { x: tx + tile / 2, y: ty + tile / 2, size: tile, board });
      }
    });
    this.fx.addChild(this.windowBar);
  }

  private markPick(board: Board, index: number) {
    const rect = this.tileRects.get(`${board.role}:${index}`);
    if (!rect) return;
    const t = this.ctx.tokens;
    const ring = new Graphics();
    const half = rect.size / 2;
    ring.roundRect(-half - 5, -half - 5, rect.size + 10, rect.size + 10, rect.size * 0.2).stroke({ width: 4, color: "#FFFFFF" });
    ring.roundRect(-half - 9, -half - 9, rect.size + 18, rect.size + 18, rect.size * 0.24).stroke({ width: 3, color: t.g900! });
    ring.x = rect.x;
    ring.y = rect.y;
    this.fx.addChild(ring);
  }

  /**
   * Correct: a ✓ on every odd tile, then the side's reward (ADR 0009). Left: a praise message, or a
   * two-line message on level up. Right: a small confetti burst, or confetti cannons on level up.
   * Rewards never block taps, last about a second, and don't move under reduced motion.
   */
  private celebrate(levelUpTo: number | null) {
    const t = this.ctx.tokens;
    const spots: Array<{ x: number; y: number; size: number }> = [];
    for (const b of this.stage!.boards) {
      const rect = this.tileRects.get(`${b.role}:${b.oddIndex}`);
      if (!rect) continue;
      spots.push(rect);
      const r = Math.max(14, rect.size * 0.28);
      const mark = new Graphics();
      mark.circle(0, 0, r).fill({ color: "#FFFFFF" }).stroke({ width: 3, color: t.success! });
      mark.moveTo(-r * 0.45, 0).lineTo(-r * 0.1, r * 0.38).lineTo(r * 0.5, -r * 0.35).stroke({ width: Math.max(3, r * 0.22), color: t.success!, cap: "round", join: "round" });
      mark.x = rect.x;
      mark.y = rect.y;
      this.fx.addChild(mark);
      if (!this.ctx.reducedMotion) {
        mark.scale.set(0.4);
        this.animate(200, (p) => mark.scale.set(0.4 + 0.6 * easeOut(p)));
      }
    }
    if (this.side === "left") {
      if (levelUpTo !== null) this.showMessage(this.ctx.t("levelup.title", { level: levelUpTo }), this.ctx.t(`levelup.${this.levelLine.next()}`), 950);
      else this.showMessage(this.ctx.t(`praise.${this.praise.next()}`), null, 700);
    } else {
      for (const s of spots) this.confettiBurst(s.x, s.y, s.size);
      if (levelUpTo !== null) this.confettiCannons();
    }
  }

  /** Left side: a short message over the boards. Pointer events pass through it. */
  private showMessage(line1: string, line2: string | null, ms: number) {
    const t = this.ctx.tokens;
    const box = document.createElement("div");
    const big = line2 !== null;
    box.style.cssText = [
      "max-width:min(88vw,620px);text-align:center;border-radius:28px",
      `padding:${big ? "18px 34px" : "12px 28px"}`,
      `background:${this.mono ? "rgb(255 255 255 / .94)" : "rgb(255 255 255 / .92)"};color:${t.g900};box-shadow:0 10px 28px rgb(0 0 0 / .18)`,
      `border:3px solid ${this.mono ? "#141414" : t.g400}`,
      "opacity:0;transition:opacity 120ms ease-out,transform 160ms ease-out",
      this.ctx.reducedMotion ? "" : "transform:scale(.9)",
    ].join(";");
    const a = document.createElement("div");
    a.textContent = line1;
    a.style.cssText = `font-weight:800;line-height:1.15;font-size:${big ? "clamp(34px,5.5vw,56px)" : "clamp(24px,3.6vw,38px)"};color:${this.mono ? "#141414" : t.g800}`;
    box.appendChild(a);
    if (line2) {
      const b = document.createElement("div");
      b.textContent = line2;
      b.style.cssText = "font-weight:600;font-size:clamp(18px,2.6vw,26px);margin-top:6px;line-height:1.3";
      box.appendChild(b);
    }
    this.msgLayer.replaceChildren(box);
    requestAnimationFrame(() => {
      box.style.opacity = "1";
      if (!this.ctx.reducedMotion) box.style.transform = "scale(1)";
    });
    window.setTimeout(() => {
      box.style.opacity = "0";
      window.setTimeout(() => box.remove(), 160);
    }, ms - 160);
  }

  private confettiColours(): string[] {
    if (this.mono) return ["#FFFFFF", "#141414", "#7C7C7C", "#B8B8B8", "#444444"];
    const t = this.ctx.tokens;
    return [t.accent1!, t.accent2!, t.g300!, t.g500!, t.g600!, "#FFFFFF"];
  }

  private piece(colour: string, size: number): Graphics {
    const g = new Graphics();
    const outline = this.mono && colour === "#FFFFFF" ? { width: 1, color: "#444444" } : null;
    if (this.ctx.rng() < 0.65) g.rect(-size / 2, -size / 4, size, size / 2).fill({ color: colour });
    else g.circle(0, 0, size / 3).fill({ color: colour });
    if (outline) g.stroke(outline);
    this.party.addChild(g);
    return g;
  }

  /** Right side: a small confetti burst from a tile. Still sparkles under reduced motion. */
  private confettiBurst(x: number, y: number, tileSize: number) {
    const colours = this.confettiColours();
    const n = 18;
    if (this.ctx.reducedMotion) {
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const g = this.piece(colours[i % colours.length]!, 10);
        g.x = x + Math.cos(a) * tileSize * 0.75;
        g.y = y + Math.sin(a) * tileSize * 0.75;
        window.setTimeout(() => g.destroy(), 600);
      }
      return;
    }
    for (let i = 0; i < n; i++) {
      const g = this.piece(colours[i % colours.length]!, 8 + this.ctx.rng() * 6);
      const a = -Math.PI / 2 + (this.ctx.rng() - 0.5) * Math.PI * 1.4;
      const speed = tileSize * (1.6 + this.ctx.rng() * 1.4);
      const spin = (this.ctx.rng() - 0.5) * 12;
      this.fly(g, x, y, Math.cos(a) * speed, Math.sin(a) * speed, tileSize * 3.2, spin, 700);
    }
  }

  /** Right side, level up: confetti cannons from both bottom corners. Still confetti under reduced motion. */
  private confettiCannons() {
    const { width: W, height: H } = this.app.screen;
    const colours = this.confettiColours();
    if (this.ctx.reducedMotion) {
      for (let i = 0; i < 30; i++) {
        const g = this.piece(colours[i % colours.length]!, 12);
        const left = i % 2 === 0;
        g.x = left ? this.ctx.rng() * W * 0.22 : W - this.ctx.rng() * W * 0.22;
        g.y = H * (0.45 + this.ctx.rng() * 0.5);
        g.rotation = this.ctx.rng() * Math.PI;
        window.setTimeout(() => g.destroy(), 900);
      }
      return;
    }
    // Three quick waves from each bottom corner, aimed up and inwards.
    for (const fromLeft of [true, false]) {
      for (let i = 0; i < 75; i++) {
        const g = this.piece(colours[i % colours.length]!, 13 + this.ctx.rng() * 10);
        const angle = -Math.PI / 2 + (fromLeft ? 1 : -1) * (0.2 + this.ctx.rng() * 0.5);
        const speed = H * (1.45 + this.ctx.rng() * 0.6);
        const spin = (this.ctx.rng() - 0.5) * 14;
        const wave = Math.floor(i / 25) * 140;
        this.fly(g, fromLeft ? -6 : W + 6, H + 10, Math.cos(angle) * speed, Math.sin(angle) * speed, H * 2.1, spin, 1250 + this.ctx.rng() * 300, wave);
      }
    }
  }

  /** A confetti piece under gravity (velocities in px/s), fading out over its last third, then removed. */
  private fly(g: Graphics, x0: number, y0: number, vx: number, vy: number, gravity: number, spin: number, ms: number, delay = 0) {
    g.x = x0;
    g.y = y0;
    if (delay) g.alpha = 0;
    this.animate(ms, (p) => {
      if (g.destroyed) return;
      const s = (p * ms) / 1000;
      g.x = x0 + vx * s;
      g.y = y0 + vy * s + 0.5 * gravity * s * s;
      g.rotation = spin * s;
      g.alpha = p < 0.66 ? 1 : 1 - (p - 0.66) / 0.34;
      if (p >= 1) g.destroy();
    }, delay);
  }

  /** Wrong: no red, no buzzer. A small ✕ where they tapped, a gentle wobble, and the odd tile is shown. */
  private gentleMiss(outcome: Extract<Outcome, { kind: "wrong" }>) {
    const t = this.ctx.tokens;
    for (const p of outcome.picks) {
      if (p.correct) continue;
      const rect = this.tileRects.get(`${p.role}:${p.index}`);
      if (!rect) continue;
      const r = Math.max(12, rect.size * 0.22);
      const mark = new Graphics();
      mark.circle(0, 0, r).fill({ color: "#FFFFFF", alpha: 0.9 });
      mark.moveTo(-r * 0.4, -r * 0.4).lineTo(r * 0.4, r * 0.4).moveTo(r * 0.4, -r * 0.4).lineTo(-r * 0.4, r * 0.4).stroke({ width: Math.max(3, r * 0.2), color: t.g800!, cap: "round" });
      mark.x = rect.x;
      mark.y = rect.y;
      this.fx.addChild(mark);
      if (!this.ctx.reducedMotion) this.animate(360, (q) => (mark.x = rect.x + Math.sin(q * Math.PI * 4) * 6 * (1 - q)));
    }
    for (const b of this.stage!.boards) this.revealOdd(b);
  }

  private revealOdd(b: Board) {
    const rect = this.tileRects.get(`${b.role}:${b.oddIndex}`);
    if (!rect) return;
    const half = rect.size / 2;
    const glow = new Graphics().roundRect(-half - 6, -half - 6, rect.size + 12, rect.size + 12, rect.size * 0.22).stroke({ width: 5, color: this.ctx.tokens.accent1! });
    glow.x = rect.x;
    glow.y = rect.y;
    this.fx.addChild(glow);
  }

  private animate(ms: number, step: (p: number) => void, delay = 0) {
    const start = performance.now() + delay;
    const fn = () => {
      const p = Math.min(1, Math.max(0, (performance.now() - start) / ms));
      step(p);
      if (p >= 1) this.app.ticker.remove(fn);
    };
    this.app.ticker.add(fn);
  }
}

const easeOut = (p: number) => 1 - (1 - p) ** 3;

/** Lighter (amount > 0, towards white) or darker (amount < 0, towards black) version of a colour. */
function shade(hex: string, amount: number): string {
  const [r, g, b] = hexToRgb(hex);
  const to = amount > 0 ? 255 : 0;
  const k = Math.abs(amount);
  return rgbToHex([r + (to - r) * k, g + (to - g) * k, b + (to - b) * k]);
}

/** A shaded sphere with a soft shadow: light from the top left. */
function sphere(size: number, base: string): Container {
  const c = new Container();
  const shadow = new Graphics().ellipse(size * 0.15, size * 0.95, size * 0.8, size * 0.22).fill({ color: "#000000", alpha: 0.12 });
  const fill = new FillGradient({
    type: "radial",
    center: { x: 0.35, y: 0.3 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.62,
    colorStops: [{ offset: 0, color: shade(base, 0.55) }, { offset: 0.55, color: base }, { offset: 1, color: shade(base, -0.35) }],
    textureSpace: "local",
  });
  const ball = new Graphics().circle(0, 0, size).fill(fill);
  c.addChild(shadow, ball);
  return c;
}

/** An isometric cube: three faces in light, mid and dark tones of one colour. */
function cube(size: number, base: string): Container {
  const c = new Container();
  const s = size * 0.9;
  const g = new Graphics();
  g.poly([0, -s, s, -s / 2, 0, 0, -s, -s / 2]).fill({ color: shade(base, 0.4) }); // top
  g.poly([-s, -s / 2, 0, 0, 0, s, -s, s / 2]).fill({ color: base }); // left
  g.poly([s, -s / 2, 0, 0, 0, s, s, s / 2]).fill({ color: shade(base, -0.3) }); // right
  const shadow = new Graphics().ellipse(s * 0.2, s * 1.1, s * 0.95, s * 0.2).fill({ color: "#000000", alpha: 0.1 });
  c.addChild(shadow, g);
  return c;
}

export const catchMe: GameDefinition = { manifest, create: () => new CatchMe(), strings };
export default catchMe;
