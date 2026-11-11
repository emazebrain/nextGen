/**
 * It's Left, It's Right (spec 2026-11-10) on the eMazeBrain Game SDK.
 *
 * A rotated body-part image appears; the child decides left or right.
 * The pure engine (engine.ts) owns the round's timing; Session Rules
 * (in the runtime) owns the session clock and lives: the game only
 * reports `wrong_answer` and `no_answer`.
 *
 * Buttons are PHYSICAL — Left is always screen-left, Right always
 * screen-right, never mirrored in RTL (design doc §11.6, spec).
 */
import "pixi.js/unsafe-eval";
import {
  Application,
  Container,
  FillGradient,
  Graphics,
  Sprite,
  Texture,
  type Ticker,
} from "pixi.js";
import type {
  EndReason,
  GameDefinition,
  GameModule,
  InitContext,
  LevelHistoryRow,
  PauseReason,
  SessionStatus,
  TrialOutcome,
} from "@emb/game-sdk";
import type { AgeBand, BodyPart, Side } from "./assets.ts";
import { posesFor } from "./assets.ts";
import { bodyPartsForLevel, MAX_LEVEL, nextLevel, rotationRange, timeLimit } from "./config.ts";
import { LateralityEngine, type EngineEvent, type RoundRecord } from "./engine.ts";
import { computeMetrics } from "./metrics.ts";
import { generateRound, type RoundContext, type RoundSpec } from "./rounds.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const FEEDBACK_MS = 800;
const FLY_IN_MS = 400;
const BANDS: AgeBand[] = ["4-6", "7-9", "10-12", "13+"];

interface Look {
  sky: [string, string];
  solid: string;
  pattern: string;
  btnLeft: string;
  btnRight: string;
  cue: string;
  ink: string;
  good: string;
  bad: string;
}

const LOOKS: Record<"warm" | "cold" | "mono", Look> = {
  warm: { sky: ["#FFF3DC", "#FFC98A"], solid: "#FFE3BC", pattern: "#FFB25E", btnLeft: "#2F80ED", btnRight: "#F08A3C", cue: "#FF5E7E", ink: "#4A1F0E", good: "#2FB36B", bad: "#E74C3C" },
  cold: { sky: ["#E2F6FF", "#9FD8F5"], solid: "#CDEBFA", pattern: "#6EC3EE", btnLeft: "#2F80ED", btnRight: "#F08A3C", cue: "#7B61FF", ink: "#0E2240", good: "#18A999", bad: "#E74C3C" },
  mono: { sky: ["#F4F4F4", "#D6D6D6"], solid: "#E6E6E6", pattern: "#9A9A9A", btnLeft: "#555555", btnRight: "#888888", cue: "#111111", ink: "#111111", good: "#111111", bad: "#444444" },
};

interface Timer {
  left: number;
  fn: () => void;
}

class ItsLeftItsRight implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private band: AgeBand = "10-12";
  private level = 1;
  private sinceChange: boolean[] = [];
  private maxClears = 0;
  private timeLimitOverride = 0;
  private maxRotationOverride = 0;
  private bodyPartsOverride: BodyPart[] = [];
  private textured = false;
  private rng!: () => number;
  private rotationBias: "cw" | "ccw" = "cw";
  private textures = new Map<string, Texture>();
  private bg = new Graphics();
  private layer = new Container();
  private engine = new LateralityEngine();
  private currentSpec: RoundSpec | null = null;
  private currentSprite: Container | null = null;
  private flyProgress = 0;
  private flyFrom: { x: number; y: number } = { x: 0, y: 0 };
  private flyTo: { x: number; y: number } = { x: 0, y: 0 };
  private flying = false;
  private clock = 0;
  private paused = false;
  private ended = false;
  private practicing = false;
  private timers: Timer[] = [];
  private records: RoundRecord[] = [];
  private levelRows: RoundRecord[] = [];
  private levelStart = 0;
  private roundNo = 0;
  private score = 0;
  private startBtn!: HTMLButtonElement;
  private leftBtn!: HTMLButtonElement;
  private rightBtn!: HTMLButtonElement;
  private msg!: HTMLDivElement;
  private buttonsEnabled = false;
  private onRoundDone: (() => void) | null = null;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    this.band = BANDS.includes(p.age_band as AgeBand) ? (p.age_band as AgeBand) : "10-12";
    this.level = typeof p.start_level === "number" ? Math.min(MAX_LEVEL, Math.max(1, p.start_level)) : 1;

    // Game-specific params
    const tl = p["its-left-its-right.time_limit_ms"];
    this.timeLimitOverride = typeof tl === "number" ? tl : 0;
    const mr = p["its-left-its-right.max_rotation"];
    this.maxRotationOverride = typeof mr === "number" ? mr : 0;
    const bp = p["its-left-its-right.body_parts"];
    this.bodyPartsOverride = typeof bp === "string" && bp !== "auto" ? bp.split("+") as BodyPart[] : [];
    const bg = p["its-left-its-right.background"];
    this.textured = bg === "textured";

    // Rotation bias from region
    this.rotationBias = p.region?.rotation === "ccw" ? "ccw" : "cw";

    const temp = p["its-left-its-right.bg_temperature"];
    this.look = ctx.monochrome ? LOOKS.mono : LOOKS[temp === "warm" || temp === "cold" ? temp : ctx.palette];

    const seed = Math.floor(ctx.rng() * 2 ** 31);
    this.rng = mulberry32(seed);

    this.app = new Application();
    await this.app.init({
      resizeTo: ctx.mount,
      backgroundAlpha: 0,
      antialias: true,
      autoDensity: true,
      resolution: Math.min(2, window.devicePixelRatio || 1),
    });
    this.app.canvas.setAttribute("aria-hidden", "true");
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.layer);

    this.buildDom();
    await this.loadAssets();

    this.app.renderer.on("resize", () => this.drawBackground());
    this.app.ticker.add((tk: Ticker) => this.tick(tk));
    this.drawBackground();

    window.addEventListener("keydown", this.onKey);
    ctx.session.onEnd(() => this.stopAll());
  }

  async startPractice(): Promise<{ trials: number }> {
    this.practicing = true;
    for (let i = 0; i < 2 && !this.ended; i++) {
      await new Promise<void>((resolve) => {
        this.onRoundDone = resolve;
        this.playRound();
      });
    }
    this.practicing = false;
    return { trials: 2 };
  }

  start(): void {
    this.startBtn.hidden = false;
    this.startBtn.focus();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
    this.setButtonsEnabled(false);
  }

  resume(): void {
    this.paused = false;
    if (this.engine.phase === "waiting") this.setButtonsEnabled(true);
  }

  end(status: SessionStatus, _reason: EndReason): Record<string, number | string | object> {
    this.stopAll();
    this.flushLevel(status === "completed" ? "cleared" : "timeout");
    return { ...computeMetrics(this.records), score: this.score, age_band: this.band };
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
    this.playRound();
  }

  private playRound() {
    const limit = timeLimit(this.level, this.timeLimitOverride);
    const ctx: RoundContext = {
      level: this.level,
      ageBand: this.band,
      rotationBias: this.rotationBias,
      rng: this.rng,
      ...(this.bodyPartsOverride.length > 0 ? { bodyParts: this.bodyPartsOverride } : {}),
      ...(this.maxRotationOverride > 0 ? { maxRotation: this.maxRotationOverride } : {}),
    };
    const spec = generateRound(ctx);
    this.currentSpec = spec;
    this.render(this.engine.startRound(spec, this.level, limit, this.clock));
  }

  private render(events: EngineEvent[]) {
    for (const e of events) {
      switch (e.type) {
        case "show":
          this.showImage(e.spec);
          break;
        case "ready":
          this.setButtonsEnabled(true);
          break;
        case "correct":
          this.onCorrect(e.rt);
          break;
        case "wrong":
          this.onWrong();
          break;
        case "timeout":
          this.onTimeout();
          break;
        case "roundEnd":
          this.onRoundEnd(e.record);
          break;
      }
    }
  }

  private showImage(spec: RoundSpec) {
    this.clearImage();
    this.setButtonsEnabled(false);

    const { width: w, height: h } = this.app.screen;
    const centre = { x: w / 2, y: (h - HUD_SPACE) / 2 + HUD_SPACE };
    const size = Math.min(w * 0.5, (h - HUD_SPACE) * 0.45);

    // Create sprite from texture
    const tex = this.textures.get(spec.pose.svgFile);
    if (!tex) return;

    const container = new Container();
    const sprite = new Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.width = size;
    sprite.height = size;

    // Flip horizontally if left side (canonical is right)
    if (spec.side === "left") {
      sprite.scale.x = -Math.abs(sprite.scale.x);
    }

    container.addChild(sprite);

    // Apply rotation
    const sign = spec.rotationDir === "cw" ? 1 : -1;
    container.rotation = (spec.rotationDeg * Math.PI) / 180 * sign;

    this.layer.addChild(container);
    this.currentSprite = container;

    // Fly-in animation
    const region = this.ctx.params.region;
    const dirs = region?.motion?.[0]?.directions ?? ["ltr"];
    const dir = dirs[0] ?? "ltr";
    const from = flyInOrigin(dir, w, h, centre);
    this.flyFrom = from;
    this.flyTo = centre;
    this.flyProgress = 0;
    this.flying = true;
    container.position.set(from.x, from.y);
    container.alpha = 0;
  }

  private clearImage() {
    if (this.currentSprite) {
      this.currentSprite.destroy({ children: true });
      this.currentSprite = null;
    }
    this.flying = false;
  }

  private onCorrect(_rt: number) {
    this.setButtonsEnabled(false);
    this.say(this.ctx.t("correct"), this.ctx.reducedMotion ? 400 : FEEDBACK_MS);
  }

  private onWrong() {
    this.setButtonsEnabled(false);
    this.say(this.ctx.t("wrong"), this.ctx.reducedMotion ? 400 : FEEDBACK_MS);
    if (!this.practicing) this.ctx.session.lifeLossEvent("wrong_answer");
  }

  private onTimeout() {
    this.setButtonsEnabled(false);
    this.say(this.ctx.t("timeout"), this.ctx.reducedMotion ? 400 : FEEDBACK_MS);
    if (!this.practicing) this.ctx.session.lifeLossEvent("no_answer");
  }

  private onRoundEnd(record: RoundRecord) {
    if (this.practicing) {
      this.after(this.ctx.reducedMotion ? 300 : FEEDBACK_MS, () => {
        this.clearImage();
        const done = this.onRoundDone;
        this.onRoundDone = null;
        done?.();
      });
      return;
    }

    this.roundNo += 1;
    this.records.push(record);
    this.levelRows.push(record);
    if (record.outcome === "correct") this.score += 10;

    // Report trial to SDK
    const { width: w } = this.app.screen;
    const cx = w / 2;
    const tx = this.currentSprite?.x ?? cx;
    const outcome: TrialOutcome =
      record.outcome === "correct" ? "correct" : record.outcome === "wrong" ? "error" : "timeout";

    this.ctx.session.trial({
      trialId: String(this.roundNo),
      level: this.level,
      stimulusOnMs: Math.round(this.clock),
      responseMs: record.rt_ms,
      outcome,
      target: {
        x: Math.round(tx),
        y: Math.round(this.currentSprite?.y ?? 0),
        hemifield: Math.abs(tx - cx) < 1 ? "C" : tx < cx ? "L" : "R",
      },
      tags: {
        bodyPart: record.bodyPart,
        pose: record.pose,
        rotationDeg: record.rotationDeg,
        rotationDir: record.rotationDir,
        correctSide: record.correctSide,
        chosenSide: record.chosenSide ?? "none",
      },
    });

    // Staircase: 2 correct up, 2 wrong down
    this.sinceChange.push(record.outcome === "correct");
    const next = nextLevel(this.level, this.sinceChange);
    if (this.level === MAX_LEVEL && record.outcome === "correct") this.maxClears += 1;
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
      this.clearImage();
      this.nextRound();
    });
  }

  private flushLevel(outcome: LevelHistoryRow["outcome"]) {
    if (!this.levelRows.length) return;
    const rows = this.levelRows;
    const correct = rows.filter((r) => r.outcome === "correct").length;
    this.ctx.session.levelComplete({
      level: rows[0]!.level,
      durationMs: Math.round(this.clock - this.levelStart),
      scoreDelta: rows.reduce((s, r) => s + (r.outcome === "correct" ? 10 : 0), 0),
      trials: rows.length,
      correct,
      errors: rows.length - correct,
      livesLost: rows.filter((r) => r.outcome !== "correct").length,
      outcome,
      detail: { bodyParts: [...new Set(rows.map((r) => r.bodyPart))] },
    });
    this.levelRows = [];
    this.levelStart = this.clock;
  }

  private stopAll() {
    this.ended = true;
    this.engine.stop();
    this.startBtn.hidden = true;
    this.setButtonsEnabled(false);
    this.clearImage();
  }

  private tapSide(side: Side) {
    if (this.ended || this.paused || !this.buttonsEnabled) return;
    this.render(this.engine.answer(side, this.clock));
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat) return;
    if (!this.startBtn.hidden && (e.key === " " || e.key === "Enter")) {
      e.preventDefault();
      this.begin();
      return;
    }
    if (!this.buttonsEnabled) return;
    if (e.key === "ArrowLeft" || e.key === "l" || e.key === "L") {
      e.preventDefault();
      this.tapSide("left");
    } else if (e.key === "ArrowRight" || e.key === "r" || e.key === "R") {
      e.preventDefault();
      this.tapSide("right");
    }
  };

  // ---------------------------------------------------------------- ticker

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;

    // Fly-in animation
    if (this.flying && this.currentSprite) {
      this.flyProgress += dt / FLY_IN_MS;
      if (this.flyProgress >= 1) {
        this.flyProgress = 1;
        this.flying = false;
        this.currentSprite.position.set(this.flyTo.x, this.flyTo.y);
        this.currentSprite.alpha = 1;
        // Image is fully visible — tell engine to start timer
        this.render(this.engine.imageReady(this.clock));
      } else {
        const t = easeOutCubic(this.flyProgress);
        this.currentSprite.x = this.flyFrom.x + (this.flyTo.x - this.flyFrom.x) * t;
        this.currentSprite.y = this.flyFrom.y + (this.flyTo.y - this.flyFrom.y) * t;
        this.currentSprite.alpha = Math.min(1, this.flyProgress * 3);
      }
    }

    // Engine tick (checks timeout)
    if (this.engine.active) this.render(this.engine.tick(this.clock));

    // Timers
    const due = this.timers.filter((t) => (t.left -= dt) <= 0);
    this.timers = this.timers.filter((t) => t.left > 0);
    for (const t of due) t.fn();
  }

  private after(ms: number, fn: () => void) {
    this.timers.push({ left: ms, fn });
  }

  // ---------------------------------------------------------------- drawing

  private drawBackground() {
    const { width: w, height: h } = this.app.screen;
    const L = this.look;
    this.bg.clear();
    const grad = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: L.sky[0] },
        { offset: 1, color: L.sky[1] },
      ],
    });
    this.bg.rect(0, 0, w, h).fill(grad);
    if (this.textured) {
      for (let y = 24; y < h; y += 48) {
        for (let x = (y / 48) % 2 ? 24 : 48; x < w; x += 48) {
          this.bg.circle(x, y, 5).fill({ color: L.pattern, alpha: 0.25 });
        }
      }
    }
  }

  private setButtonsEnabled(on: boolean) {
    this.buttonsEnabled = on;
    this.leftBtn.disabled = !on;
    this.rightBtn.disabled = !on;
    this.leftBtn.style.opacity = on ? "1" : "0.4";
    this.rightBtn.style.opacity = on ? "1" : "0.4";
  }

  private async loadAssets() {
    const eligible = posesFor(this.band);
    const jobs = eligible.map(
      (pose) =>
        new Promise<void>((resolve) => {
          // Build an inline data URI from the SVG asset path
          const assetPath = new URL(`../assets/${pose.svgFile}`, import.meta.url).href;
          const img = new Image(256, 256);
          img.onload = () => {
            this.textures.set(pose.svgFile, Texture.from(img));
            resolve();
          };
          img.onerror = () => resolve(); // non-fatal; the pose will just be invisible
          img.src = assetPath;
        }),
    );
    await Promise.all(jobs);
  }

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const lang = this.ctx.params.lang ?? "en";
    const s = strings[lang as keyof typeof strings] ?? strings.en;

    const style = document.createElement("style");
    style.textContent = `
      .lr-start{position:absolute;inset-block-start:50%;inset-inline-start:50%;transform:translate(-50%,-50%);padding:22px 44px;border-radius:999px;border:0;background:${L.cue};color:#FFFFFF;font:800 30px ${font};box-shadow:0 10px 0 rgb(0 0 0 / .18),0 18px 36px rgb(0 0 0 / .18);cursor:pointer;z-index:20}
      .lr-start:focus-visible{outline:4px solid ${L.ink};outline-offset:4px}
      .lr-start[hidden]{display:none}
      .lr-btn{position:fixed;bottom:12px;width:calc(50% - 18px);height:72px;border:0;border-radius:18px;font:800 28px ${font};color:#FFFFFF;cursor:pointer;z-index:10;transition:opacity 0.15s}
      .lr-btn:focus-visible{outline:4px solid ${L.ink};outline-offset:4px}
      .lr-btn:disabled{cursor:default}
      .lr-btn-left{left:8px;background:${L.btnLeft}}
      .lr-btn-right{right:8px;background:${L.btnRight}}
      .lr-msg{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 8}px;display:flex;justify-content:center;pointer-events:none;font-family:${font};z-index:15}
      .lr-say{padding:10px 24px;border-radius:999px;background:${L.ink};color:#FFFFFF;font-size:24px;font-weight:700}
    `;
    this.ctx.mount.appendChild(style);

    // Start button
    this.startBtn = document.createElement("button");
    this.startBtn.type = "button";
    this.startBtn.className = "lr-start";
    this.startBtn.textContent = s.start;
    this.startBtn.hidden = true;
    this.startBtn.addEventListener("click", this.begin);
    this.ctx.mount.appendChild(this.startBtn);

    // Left button — always screen-left (physical, never mirrored)
    this.leftBtn = document.createElement("button");
    this.leftBtn.type = "button";
    this.leftBtn.className = "lr-btn lr-btn-left";
    this.leftBtn.textContent = s.left;
    this.leftBtn.disabled = true;
    this.leftBtn.addEventListener("pointerdown", () => this.tapSide("left"));
    this.ctx.mount.appendChild(this.leftBtn);

    // Right button — always screen-right (physical, never mirrored)
    this.rightBtn = document.createElement("button");
    this.rightBtn.type = "button";
    this.rightBtn.className = "lr-btn lr-btn-right";
    this.rightBtn.textContent = s.right;
    this.rightBtn.disabled = true;
    this.rightBtn.addEventListener("pointerdown", () => this.tapSide("right"));
    this.ctx.mount.appendChild(this.rightBtn);

    // Feedback message
    this.msg = document.createElement("div");
    this.msg.className = "lr-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);

    this.setButtonsEnabled(false);
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const el = document.createElement("div");
    el.className = "lr-say";
    el.textContent = text;
    this.msg.appendChild(el);
    this.after(ms, () => {
      if (el.parentElement === this.msg) el.remove();
    });
  }
}

// ---------------------------------------------------------------- helpers

function flyInOrigin(
  dir: string,
  w: number,
  h: number,
  centre: { x: number; y: number },
): { x: number; y: number } {
  switch (dir) {
    case "rtl": return { x: w + 100, y: centre.y };
    case "ttb": return { x: centre.x, y: -100 };
    case "btt": return { x: centre.x, y: h + 100 };
    default:    return { x: -100, y: centre.y }; // ltr
  }
}

function easeOutCubic(t: number): number {
  return 1 - (1 - t) ** 3;
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

export const itsLeftItsRight: GameDefinition = { manifest, create: () => new ItsLeftItsRight(), strings };
export default itsLeftItsRight;
