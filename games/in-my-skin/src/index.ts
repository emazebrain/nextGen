/**
 * In My Skin (spec 2026-11-23) on the eMazeBrain Game SDK.
 *
 * A colour picture travels toward a grey copy of itself; the child presses Stop when the picture sits on it.
 * The pure modules (engine.ts, rounds.ts) decide where the picture is and how a stop is judged; Session Rules
 * (in the runtime) owns the session clock and lives: the game only reports `stopped_early`, `stopped_late` and
 * `no_stop`, and Session Rules applies them in the modes that have lives.
 *
 * The Stop button's side is PHYSICAL: bottom-left for the right hemisphere, bottom-right for the left, never
 * mirrored in RTL (CLAUDE.md invariant 10).
 */
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, Sprite, Texture, type Ticker } from "pixi.js";
import type { EndReason, GameDefinition, GameModule, InitContext, LevelHistoryRow, PauseReason, SessionStatus, TrialOutcome } from "@emb/game-sdk";
import { FREEZE_MS, MAX_LEVEL, clamp, nextLevel, startLevel } from "./config.ts";
import { drawnSvg } from "./drawn.ts";
import { coverage, judge, viewAt, type StopResult } from "./engine.ts";
import { FLAT_SVG } from "./flat.generated.ts";
import { manifest } from "./manifest.ts";
import { computeMetrics, coverageBands, type RoundRecord } from "./metrics.ts";
import { MOVEMENT_TYPES, mirrored, pointAt, type Field } from "./motion.ts";
import { CATEGORIES, PictureBag, poolFor, type Category, type Picture } from "./pictures.ts";
import { planRound, type RoundSpec } from "./rounds.ts";
import { strings } from "./strings.ts";

export { manifest };

const HUD_SPACE = 92;
const LEAD_IN_MS = 450;
const BUTTON = 124;
const BUTTON_GAP = 16;
const MASK = 48;
const TEX = 256;

interface Look {
  sky: [string, string];
  pattern: string;
  cue: string;
  ink: string;
  good: string;
  off: string;
}

const LOOKS: Record<"warm" | "cold" | "mono", Look> = {
  warm: { sky: ["#FFF3DC", "#FFC98A"], pattern: "#FFB25E", cue: "#FF5E7E", ink: "#4A1F0E", good: "#2FB36B", off: "#E08A1E" },
  cold: { sky: ["#E2F6FF", "#9FD8F5"], pattern: "#6EC3EE", cue: "#7B61FF", ink: "#0E2240", good: "#18A999", off: "#E08A1E" },
  mono: { sky: ["#F4F4F4", "#D6D6D6"], pattern: "#9A9A9A", cue: "#111111", ink: "#111111", good: "#111111", off: "#555555" },
};

interface Art {
  colour: Texture;
  grey: Texture;
  /** The picture's shape on a MASK × MASK grid, for measuring coverage. */
  mask: Uint8Array;
}

interface Timer {
  left: number;
  fn: () => void;
}

type Phase = "idle" | "lead" | "moving" | "frozen";

class InMySkin implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private rng!: () => number;
  private level = 1;
  private sinceChange: boolean[] = [];
  private maxClears = 0;
  private textured = false;
  private movementOverride: number | null = null;
  private bag!: PictureBag;
  private art = new Map<string, Art>();
  private bg = new Graphics();
  private layer = new Container();
  private outline: Sprite | null = null;
  private mover: Sprite | null = null;
  private ring = new Graphics();
  private spec: RoundSpec | null = null;
  private phase: Phase = "idle";
  private roundStart = 0;
  private strays = 0;
  private clock = 0;
  private paused = false;
  private ended = false;
  private practicing = false;
  private onRoundDone: (() => void) | null = null;
  private timers: Timer[] = [];
  private records: RoundRecord[] = [];
  private levelRows: RoundRecord[] = [];
  private levelStart = 0;
  private roundNo = 0;
  private score = 0;
  private startBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private msg!: HTMLDivElement;

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    this.level = typeof p.start_level === "number" ? clamp(p.start_level, 1, MAX_LEVEL) : startLevel(p.difficulty);
    if (typeof p.max_level === "number") this.level = Math.min(this.level, p.max_level);

    this.textured = p["in_my_skin.background"] === "textured";
    const temp = p["in_my_skin.bg_temperature"];
    this.look = ctx.monochrome ? LOOKS.mono : LOOKS[temp === "warm" || temp === "cold" ? temp : ctx.palette];
    const move = MOVEMENT_TYPES.indexOf(p["in_my_skin.movement_type"] as (typeof MOVEMENT_TYPES)[number]);
    this.movementOverride = move >= 0 ? move : null;
    const cat = p["in_my_skin.category"];
    const category = (CATEGORIES as readonly string[]).includes(cat as string) ? (cat as Category) : null;

    this.rng = mulberry32(Math.floor(ctx.rng() * 2 ** 31));
    const pool = poolFor(p.hemisphere === "left" ? "left" : "right", p.lang, category);

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true");
    ctx.mount.appendChild(this.app.canvas);
    this.app.stage.addChild(this.bg, this.layer);

    this.buildDom();
    await Promise.all(pool.map((pic) => this.loadPicture(pic)));
    // A picture that failed to load is left out, never shown as a blank.
    const usable = pool.filter((pic) => this.art.has(pic.id));
    this.bag = new PictureBag(usable.length ? usable : pool, this.rng);

    this.app.renderer.on("resize", () => this.drawBackground());
    this.app.ticker.add((tk: Ticker) => this.tick(tk));
    this.drawBackground();

    window.addEventListener("keydown", this.onKey);
    ctx.mount.addEventListener("pointerdown", this.onPointer);
    ctx.session.onEnd(() => this.stopAll());
  }

  async startPractice(): Promise<{ trials: number }> {
    this.practicing = true;
    this.stopBtn.hidden = false;
    for (let i = 0; i < 2 && !this.ended; i++) {
      await new Promise<void>((resolve) => {
        this.onRoundDone = resolve;
        this.playRound();
      });
    }
    this.practicing = false;
    this.stopBtn.hidden = true;
    return { trials: 2 };
  }

  start(): void {
    this.startBtn.hidden = false;
    this.startBtn.focus();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
  }

  resume(): void {
    this.paused = false;
  }

  end(status: SessionStatus, _reason: EndReason): Record<string, number | string | object> {
    this.stopAll();
    this.flushLevel(status === "completed" ? "cleared" : "timeout");
    return { ...computeMetrics(this.records), coverage_bands: coverageBands(this.records), score: this.score } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.ctx?.mount.removeEventListener("pointerdown", this.onPointer);
    for (const a of this.art.values()) {
      a.colour.destroy(true);
      a.grey.destroy(true);
    }
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- flow

  private begin = () => {
    if (this.ended || this.startBtn.hidden) return;
    this.startBtn.hidden = true;
    this.stopBtn.hidden = false;
    this.ctx.session.qualifyingInteraction();
    this.levelStart = this.clock;
    this.playRound();
  };

  private field(): Field {
    const { width: w, height: h } = this.app.screen;
    return { x: 0, y: HUD_SPACE, w, h: Math.max(120, h - HUD_SPACE) };
  }

  private buttonCentre() {
    const { width: w, height: h } = this.app.screen;
    const r = BUTTON / 2;
    const left = this.ctx.params.hemisphere === "right";
    return { x: left ? BUTTON_GAP + r : w - BUTTON_GAP - r, y: h - BUTTON_GAP - r, r };
  }

  private playRound() {
    if (this.ended) return;
    this.clearRound();
    const region = this.ctx.params.region;
    const picture = this.bag.next();
    const spec = planRound({
      level: this.practicing ? 1 : this.level,
      picture,
      field: this.field(),
      rng: this.rng,
      motion: region?.motion,
      targetLocations: region?.target_locations,
      movementType: this.practicing ? 0 : this.movementOverride,
      speedScale: this.ctx.params.speed_scale,
      avoid: this.buttonCentre(),
    });
    this.spec = spec;
    this.strays = 0;

    const art = this.art.get(picture.id);
    if (art) {
      this.outline = this.sprite(art.grey, spec.size);
      this.outline.position.set(spec.target.x, spec.target.y);
      this.outline.alpha = 0;
      this.mover = this.sprite(art.colour, spec.size);
      this.mover.visible = false;
      this.layer.addChild(this.outline, this.ring, this.mover);
    }
    this.ring.clear();
    this.face(false);
    this.phase = "lead";
    this.roundStart = this.clock + LEAD_IN_MS;
    this.stopBtn.disabled = true;
  }

  private sprite(tex: Texture, size: number): Sprite {
    const s = new Sprite(tex);
    s.anchor.set(0.5);
    s.width = size;
    s.height = size;
    return s;
  }

  /** Turns the picture and its outline to face the way the leg travels. */
  private face(reverse: boolean) {
    const spec = this.spec;
    if (!spec) return;
    const flip = mirrored(spec.picture.faces, spec.direction, reverse) ? -1 : 1;
    for (const s of [this.outline, this.mover]) if (s) s.scale.x = Math.abs(s.scale.x) * flip;
  }

  private stop = () => {
    if (this.ended || this.paused || this.phase !== "moving" || !this.spec) return;
    this.finish(judge(this.spec.plan, this.clock - this.roundStart));
  };

  private finish(result: StopResult) {
    const spec = this.spec!;
    this.phase = "frozen";
    this.stopBtn.disabled = true;

    let covered: number | null = null;
    if (result.share !== null && this.mover) {
      const at = pointAt(spec.path, result.share);
      this.mover.position.set(at.x, at.y);
      this.mover.visible = true;
      const flipped = this.mover.scale.x < 0 ? -1 : 1;
      const art = this.art.get(spec.picture.id);
      if (art) covered = coverage(art.mask, MASK, ((at.x - spec.target.x) / spec.size) * flipped, (at.y - spec.target.y) / spec.size);
    } else if (this.mover) this.mover.visible = false;

    const good = result.cls === "on_time";
    this.ring
      .clear()
      .circle(spec.target.x, spec.target.y, spec.size * 0.62)
      .stroke({ color: good ? this.look.good : this.look.off, width: 8, alpha: 0.9 });
    this.say(this.ctx.t(result.cls), FREEZE_MS);

    if (this.practicing) {
      this.after(FREEZE_MS, () => {
        this.clearRound();
        const done = this.onRoundDone;
        this.onRoundDone = null;
        done?.();
      });
      return;
    }

    const record: RoundRecord = {
      level: spec.level,
      picture: spec.picture.id,
      category: spec.picture.category,
      direction: spec.direction,
      movementType: spec.movementType,
      cls: result.cls,
      leg: result.leg,
      kind: result.kind ?? spec.plan.legs[spec.plan.legs.length - 1]!.kind,
      errorMs: result.errorMs === null ? null : Math.round(result.errorMs),
      offset: result.offset === null ? null : Math.round(result.offset * 1000) / 1000,
      spotsOff: result.spotsOff,
      coverage: covered === null ? null : Math.round(covered * 1000) / 1000,
      strayTaps: this.strays,
    };
    this.roundNo += 1;
    this.records.push(record);
    this.levelRows.push(record);
    if (good) this.score += 10;

    const cx = this.app.screen.width / 2;
    const outcome: TrialOutcome = good ? "correct" : result.cls === "no_stop" ? "omission" : "error";
    this.ctx.session.trial({
      trialId: String(this.roundNo),
      level: spec.level,
      stimulusOnMs: Math.round(this.roundStart),
      // Anticipation, not reaction: a response time would mislead, so none is reported.
      responseMs: null,
      outcome,
      target: { x: Math.round(spec.target.x), y: Math.round(spec.target.y), hemifield: Math.abs(spec.target.x - cx) < 1 ? "C" : spec.target.x < cx ? "L" : "R" },
      tags: { picture: record.picture, category: record.category, direction: record.direction, movement: MOVEMENT_TYPES[record.movementType] ?? "continuous", stop: record.cls, leg: record.leg ?? 0 },
    });
    if (!good) this.ctx.session.lifeLossEvent(result.cls === "early" ? "stopped_early" : result.cls === "late" ? "stopped_late" : "no_stop");

    this.sinceChange.push(good);
    const next = Math.min(nextLevel(this.level, this.sinceChange), typeof this.ctx.params.max_level === "number" ? this.ctx.params.max_level : MAX_LEVEL);
    if (this.level === MAX_LEVEL && good) this.maxClears += 1;
    if (next !== this.level) {
      this.flushLevel(next > this.level ? "cleared" : "failed");
      this.level = next;
      this.sinceChange = [];
    }
    if (this.maxClears >= 2) {
      this.ctx.session.contentExhausted("max_level");
      return;
    }
    this.after(FREEZE_MS, () => this.playRound());
  }

  private flushLevel(outcome: LevelHistoryRow["outcome"]) {
    if (!this.levelRows.length) return;
    const rows = this.levelRows;
    const correct = rows.filter((r) => r.cls === "on_time").length;
    this.ctx.session.levelComplete({
      level: rows[0]!.level,
      durationMs: Math.round(this.clock - this.levelStart),
      scoreDelta: correct * 10,
      trials: rows.length,
      correct,
      errors: rows.length - correct,
      livesLost: rows.length - correct,
      outcome,
      detail: { rounds: rows },
    });
    this.levelRows = [];
    this.levelStart = this.clock;
  }

  private clearRound() {
    this.outline?.destroy();
    this.mover?.destroy();
    this.outline = null;
    this.mover = null;
    this.ring.clear();
    this.spec = null;
    this.phase = "idle";
  }

  private stopAll() {
    this.ended = true;
    this.startBtn.hidden = true;
    this.stopBtn.hidden = true;
    this.clearRound();
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== " " && e.key !== "Enter")) return;
    e.preventDefault();
    if (!this.startBtn.hidden) this.begin();
    else this.stop();
  };

  /** Taps that miss the Stop button are counted, so poor aiming is not mistaken for poor timing. */
  private onPointer = (e: PointerEvent) => {
    if (this.phase !== "moving" || this.paused) return;
    if (e.target instanceof Node && this.stopBtn.contains(e.target)) return;
    this.strays += 1;
  };

  // ---------------------------------------------------------------- ticker

  private tick(tk: Ticker) {
    if (this.paused || this.ended) return;
    const dt = tk.deltaMS;
    this.clock += dt;

    const spec = this.spec;
    if (spec && this.phase === "lead") {
      if (this.outline) this.outline.alpha = clamp(1 - (this.roundStart - this.clock) / LEAD_IN_MS, 0, 1);
      if (this.clock >= this.roundStart) {
        this.phase = "moving";
        this.stopBtn.disabled = false;
        if (this.outline) this.outline.alpha = 1;
      }
    }
    if (spec && this.phase === "moving") {
      const view = viewAt(spec.plan, this.clock - this.roundStart);
      if (!view) this.finish(judge(spec.plan, this.clock - this.roundStart));
      else if (this.mover) {
        const at = pointAt(spec.path, view.share);
        this.face(view.reverse);
        this.mover.position.set(at.x, at.y);
        this.mover.visible = view.visible;
      }
    }

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
    const grad = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: L.sky[0] }, { offset: 1, color: L.sky[1] }] });
    this.bg.rect(0, 0, w, h).fill(grad);
    if (this.textured) {
      for (let y = 24; y < h; y += 48) {
        for (let x = (y / 48) % 2 ? 24 : 48; x < w; x += 48) this.bg.circle(x, y, 5).fill({ color: L.pattern, alpha: 0.25 });
      }
    }
  }

  /** Loads one picture and makes its grey copy and its shape mask from the same pixels. */
  private loadPicture(pic: Picture): Promise<void> {
    const src =
      pic.source === "file"
        ? new URL(`../assets/${pic.id}.webp`, import.meta.url).href
        : svgUrl(pic.source === "flat" ? FLAT_SVG[pic.id] : drawnSvg(pic.id));
    if (!src) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const colour = document.createElement("canvas");
          colour.width = colour.height = TEX;
          const c = colour.getContext("2d", { willReadFrequently: true })!;
          c.drawImage(img, 0, 0, TEX, TEX);
          const data = c.getImageData(0, 0, TEX, TEX);
          const grey = document.createElement("canvas");
          grey.width = grey.height = TEX;
          const g = grey.getContext("2d")!;
          const out = g.createImageData(TEX, TEX);
          const mask = new Uint8Array(MASK * MASK);
          const cell = TEX / MASK;
          for (let i = 0; i < data.data.length; i += 4) {
            const a = data.data[i + 3]!;
            // Black and white, lifted toward a mid grey so the outline reads as a quiet copy of the picture.
            const lum = 0.3 * data.data[i]! + 0.59 * data.data[i + 1]! + 0.11 * data.data[i + 2]!;
            const v = Math.round(118 + lum * 0.42);
            out.data[i] = out.data[i + 1] = out.data[i + 2] = v;
            out.data[i + 3] = Math.round(a * 0.88);
            if (a > 48) {
              const px = (i / 4) % TEX;
              const py = Math.floor(i / 4 / TEX);
              mask[Math.floor(py / cell) * MASK + Math.floor(px / cell)] = 1;
            }
          }
          g.putImageData(out, 0, 0);
          this.art.set(pic.id, { colour: Texture.from(colour), grey: Texture.from(grey), mask });
        } catch {
          // Leave the picture out.
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = src;
    });
  }

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    // Physical side, on purpose: the opposite of the hemisphere, and not mirrored in RTL.
    const side = this.ctx.params.hemisphere === "right" ? "left" : "right";

    const style = document.createElement("style");
    style.textContent = `
      .ims-start{position:absolute;inset-block-start:50%;inset-inline-start:50%;transform:translate(-50%,-50%);padding:22px 44px;border-radius:999px;border:0;background:${L.cue};color:#FFFFFF;font:800 30px ${font};box-shadow:0 10px 0 rgb(0 0 0 / .18),0 18px 36px rgb(0 0 0 / .18);cursor:pointer;z-index:20}
      .ims-start:focus-visible,.ims-stop:focus-visible{outline:4px solid ${L.ink};outline-offset:4px}
      .ims-start[hidden],.ims-stop[hidden]{display:none}
      .ims-stop{position:absolute;bottom:${BUTTON_GAP}px;${side}:${BUTTON_GAP}px;width:${BUTTON}px;height:${BUTTON}px;border:0;border-radius:50%;background:${this.ctx.monochrome ? "#222222" : "#E5372E"};color:#FFFFFF;font:800 22px ${font};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;box-shadow:0 8px 0 rgb(0 0 0 / .22),0 14px 28px rgb(0 0 0 / .2);cursor:pointer;z-index:10;touch-action:manipulation;-webkit-tap-highlight-color:transparent;user-select:none;transition:transform .06s,opacity .15s}
      .ims-stop:active:not(:disabled){transform:translateY(5px);box-shadow:0 3px 0 rgb(0 0 0 / .22)}
      .ims-stop:disabled{opacity:.45;cursor:default}
      .ims-stop svg{width:44px;height:44px}
      .ims-msg{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 8}px;display:flex;justify-content:center;pointer-events:none;font-family:${font};z-index:15}
      .ims-say{padding:10px 24px;border-radius:999px;background:${L.ink};color:#FFFFFF;font-size:24px;font-weight:700}
    `;
    this.ctx.mount.appendChild(style);

    this.startBtn = document.createElement("button");
    this.startBtn.type = "button";
    this.startBtn.className = "ims-start";
    this.startBtn.textContent = this.ctx.t("start");
    this.startBtn.hidden = true;
    this.startBtn.addEventListener("click", this.begin);
    this.ctx.mount.appendChild(this.startBtn);

    this.stopBtn = document.createElement("button");
    this.stopBtn.type = "button";
    this.stopBtn.className = "ims-stop";
    this.stopBtn.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.3 2h7.4L22 8.3v7.4L15.7 22H8.3L2 15.7V8.3z" fill="none" stroke="#fff" stroke-width="2" stroke-linejoin="round"/><rect x="7" y="10.5" width="10" height="3" rx="1" fill="#fff"/></svg>`;
    const label = document.createElement("span");
    label.textContent = this.ctx.t("stop");
    this.stopBtn.appendChild(label);
    this.stopBtn.hidden = true;
    this.stopBtn.disabled = true;
    this.stopBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      this.stop();
    });
    this.ctx.mount.appendChild(this.stopBtn);

    this.msg = document.createElement("div");
    this.msg.className = "ims-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const el = document.createElement("div");
    el.className = "ims-say";
    el.textContent = text;
    this.msg.appendChild(el);
    this.after(ms, () => {
      if (el.parentElement === this.msg) el.remove();
    });
  }
}

// ---------------------------------------------------------------- helpers

function svgUrl(svg: string | null | undefined): string | null {
  // An explicit size: some browsers will not draw an SVG image that has none.
  return svg ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.replace("<svg ", `<svg width="${TEX}" height="${TEX}" `))}` : null;
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

export const inMySkin: GameDefinition = { manifest, create: () => new InMySkin(), strings };
export default inMySkin;
