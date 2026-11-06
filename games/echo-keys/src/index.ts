/**
 * Echo Keys (design doc §8.4), rebuilt natively on the eMazeBrain Game SDK (v1 patched an HTML file fetched from
 * a CDN). Notes fall towards a piano; the child taps each key as its note arrives. The falling notes are drawn in
 * Pixi; the keyboard is real buttons, so it works with touch, mouse, keyboard, switches and screen readers.
 *
 * Look by hemisphere (ADR 0016): left → warm "Sunset Stage", right → cold "Moonlight Lake". With go/no-go on,
 * most spiky balls fall on the half of the keyboard that hemisphere sees. The keyboard is physical: low notes on
 * the left in every language.
 */
// The frame forbids eval (CSP), so Pixi uses its no-eval shader path.
import "pixi.js/unsafe-eval";
import { Application, Container, FillGradient, Graphics, type Ticker } from "pixi.js";
import type { GameDefinition, GameModule, InitContext, PauseReason, SessionStatus } from "@emb/game-sdk";
import { EchoEngine, type FallingObject } from "./engine.ts";
import { isBlack, type Difficulty } from "./music.ts";
import { Synth } from "./sound.ts";
import { strings } from "./strings.ts";
import { manifest } from "./manifest.ts";

export { manifest };

const HUD_SPACE = 92;
const TOP_BAR = 52;
/** Computer keys for each keyboard size, laid out like a piano on the home row. */
const KEYMAP: Record<number, string[]> = {
  5: ["a", "s", "d", "f", "g"],
  8: ["a", "s", "d", "f", "g", "h", "j", "k"],
  13: ["a", "w", "s", "e", "d", "f", "t", "g", "y", "h", "u", "j", "k"],
};

interface Look {
  sky: string[];
  ivory: string;
  black: string;
  edge: string;
  note: string;
  noteCore: string;
  nogo: string;
  nogoSpike: string;
  lane: string;
  ink: string;
  spark: string[];
}

/** Warm "Sunset Stage" and cold "Moonlight Lake" (design doc §8.4 asset table). */
const LOOKS: Record<"warm" | "cold", Look> = {
  warm: { sky: ["#2E1230", "#8E3B46", "#F08A4B"], ivory: "#FFF7EC", black: "#7A2420", edge: "#3B1A12", note: "#FFB547", noteCore: "#FFF1C2", nogo: "#5A1A14", nogoSpike: "#B8322B", lane: "#FFE2B0", ink: "#3B1A12", spark: ["#FFF1C2", "#FFB547", "#FF8F3D"] },
  cold: { sky: ["#050B1E", "#122455", "#2B4A8C"], ivory: "#F0F7FF", black: "#232C6B", edge: "#0E1530", note: "#7FD3F5", noteCore: "#FFFFFF", nogo: "#1B2A5C", nogoSpike: "#B39BFF", lane: "#BFE9FF", ink: "#0E1530", spark: ["#FFFFFF", "#BFE9FF", "#7FD3F5"] },
};

interface Timer {
  left: number;
  fn: () => void;
}

class EchoKeys implements GameModule {
  private ctx!: InitContext;
  private app!: Application;
  private look!: Look;
  private engine!: EchoEngine;
  private synth!: Synth;
  private difficulty: Difficulty = 3;
  private goNoGo = false;
  private keyCount: 5 | 8 | 13 | undefined;
  private bg = new Graphics();
  private lanes = new Graphics();
  private notesG = new Graphics();
  private fx = new Graphics();
  private layer = new Container();
  private keysEl!: HTMLDivElement;
  private keyEls: HTMLButtonElement[] = [];
  private top!: HTMLDivElement;
  private msg!: HTMLDivElement;
  private timers: Timer[] = [];
  private sparks: Array<{ x: number; y: number; vx: number; vy: number; life: number; c: string }> = [];
  private clock = 0;
  private paused = false;
  private ended = false;
  private qualified = false;
  private accepting = false;
  private practice = false;
  private practiceDone: (() => void) | null = null;
  private kbTop = 0;
  private laneX: number[] = [];
  private laneW = 40;
  private reported = new Set<number>();

  async init(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const p = ctx.params;
    const own = (k: string) => p[`echo_keys.${k}`];
    this.look = LOOKS[ctx.palette];
    this.difficulty = p.difficulty;
    this.goNoGo = own("go_no_go") === true;
    const kc = Number(own("key_count"));
    this.keyCount = kc === 5 || kc === 8 || kc === 13 ? kc : undefined;
    this.synth = new Synth(ctx.palette, p.sound !== "off");
    this.engine = this.makeEngine(false);

    this.app = new Application();
    await this.app.init({ resizeTo: ctx.mount, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(2, window.devicePixelRatio || 1) });
    this.app.canvas.setAttribute("aria-hidden", "true"); // the picture; the keys and messages are DOM
    ctx.mount.appendChild(this.app.canvas);
    this.layer.addChild(this.lanes, this.notesG, this.fx);
    this.app.stage.addChild(this.bg, this.layer);
    this.buildDom();
    this.buildKeys();
    this.app.renderer.on("resize", () => this.layout());
    this.app.ticker.add((tk) => this.tick(tk));
    window.addEventListener("keydown", this.onKey);
    ctx.session.onEnd(() => {
      this.ended = true;
      this.accepting = false;
    });
    this.layout();
  }

  private makeEngine(practice: boolean) {
    return new EchoEngine({
      difficulty: this.difficulty,
      goNoGo: this.goNoGo,
      // Left hemisphere sees the right visual field: the right half of the keyboard (ADR 0016).
      lean: this.goNoGo ? (this.ctx.params.hemisphere === "right" ? "L" : "R") : null,
      rng: this.ctx.rng,
      practice,
      ...(this.keyCount ? { keyCount: this.keyCount } : {}),
    });
  }

  async startPractice(): Promise<{ trials: number }> {
    const main = this.engine;
    await new Promise<void>((resolve) => {
      this.practiceDone = resolve;
      this.practice = true;
      this.engine = this.makeEngine(true);
      this.accepting = true;
      this.say(this.ctx.t("practice"), 0);
      this.updateTop();
    });
    this.practice = false;
    this.accepting = false;
    this.engine = main;
    return { trials: 1 };
  }

  start(): void {
    this.reported.clear();
    this.accepting = true;
    this.say(this.goNoGo ? `${this.ctx.t("start")} ${this.ctx.t("instructions.nogo")}` : this.ctx.t("start"), 0);
    this.updateTop();
  }

  pause(_reason: PauseReason): void {
    this.paused = true;
    this.synth.suspend();
  }

  resume(): void {
    this.paused = false;
    this.synth.resume();
  }

  end(_status: SessionStatus): Record<string, number | string | object> {
    this.ended = true;
    this.accepting = false;
    const m = this.engine.metrics.summary(this.goNoGo);
    return {
      ...Object.fromEntries(Object.entries(m).filter(([, v]) => v !== null)),
      score: this.engine.score,
      keys: this.engine.keys.length,
      go_no_go: this.goNoGo ? 1 : 0,
    } as Record<string, number | string | object>;
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey);
    this.synth.close();
    this.app?.destroy(true, { children: true });
  }

  // ---------------------------------------------------------------- input

  private press(key: number) {
    if (!this.accepting || this.paused || this.ended) return;
    const e = this.engine;
    const el = this.keyEls[key];
    el?.classList.add("down");
    this.after(140, () => el?.classList.remove("down"));
    if (!e.started) {
      this.msg.innerHTML = "";
      if (!this.practice && !this.qualified) {
        this.qualified = true;
        this.ctx.session.qualifyingInteraction(); // the clock starts on the first key press (§8.4)
      }
      e.begin(this.clock);
      this.updateTop();
    }
    const r = e.press(key, this.clock);
    if (r.kind === "hit") {
      this.synth.note(r.obj.midi);
      this.spark(key, false);
      this.report(r.obj);
    } else if (r.kind === "false_alarm") {
      this.synth.bump();
      this.spark(key, true);
      this.report(r.obj);
      if (!this.practice) this.ctx.session.lifeLossEvent("nogo_pressed");
    } else {
      // A key with no note on it still sounds (it is a piano), softly.
      this.synth.note(e.keys[key]!, true);
      if (r.kind === "wrong" && el) {
        el.classList.remove("wrong");
        void el.offsetWidth;
        el.classList.add("wrong");
      }
    }
  }

  private onKey = (ev: KeyboardEvent) => {
    if (ev.repeat || ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const i = (KEYMAP[this.engine.keys.length] ?? []).indexOf(ev.key.toLowerCase());
    if (i < 0) return;
    ev.preventDefault();
    this.press(i);
  };

  // ---------------------------------------------------------------- events from the engine

  private report(o: FallingObject) {
    if (this.practice || this.reported.has(o.id)) return;
    this.reported.add(o.id);
    const x = this.laneX[o.key] ?? 0;
    this.ctx.session.trial({
      trialId: `${o.melody}.${o.phrase}.${o.id}`,
      level: this.difficulty,
      stimulusOnMs: Math.round(o.t - this.engine.travelMs),
      responseMs: o.result === "hit" ? Math.round(o.errMs! + this.engine.travelMs) : null,
      outcome: o.result === "hit" ? "correct" : o.result === "miss" ? "omission" : o.result === "false_alarm" ? "commission" : "correct",
      target: { x: Math.round(x), y: Math.round(this.kbTop), hemifield: x < this.app.screen.width / 2 - 2 ? "L" : x > this.app.screen.width / 2 + 2 ? "R" : "C" },
      tags: { kind: o.kind, key: o.key, midi: o.midi, err_ms: o.errMs ?? 0 },
    });
  }

  private onUpdate() {
    const e = this.engine;
    const ev = e.update(this.clock);
    for (const o of ev.missed) this.report(o);
    for (const o of ev.rejected) this.report(o);
    if (ev.phraseDone?.failed && !this.practice) {
      this.ctx.session.lifeLossEvent("phrase_failed");
      if (ev.phraseDone.repeat) this.say(this.ctx.t("phrase.again"), 1600);
    }
    if (ev.melodyDone && !this.practice) {
      const rec = e.metrics.melodies.find((m) => m.id === ev.melodyDone);
      if (rec) {
        this.ctx.session.levelComplete({
          level: e.metrics.melodies.indexOf(rec) + 1,
          durationMs: 0,
          scoreDelta: rec.hits * 10,
          trials: rec.notes,
          correct: rec.hits,
          errors: rec.misses + rec.wrong,
          livesLost: rec.phrasesFailed + rec.falseAlarms,
          outcome: rec.phrasesFailed === 0 ? "cleared" : "failed",
          detail: { melody: rec.id, phrases: rec.phrases, phrases_failed: rec.phrasesFailed, false_alarms: rec.falseAlarms, best_streak: rec.bestStreak },
        });
      }
      if (!ev.setDone) {
        const next = e.melody;
        this.say(next ? `${this.ctx.t("melody.done")} ${this.ctx.t("melody.next", { name: this.ctx.t(`melody.${next.id}`) })}` : this.ctx.t("melody.done"), 2200);
      }
    }
    if (ev.phraseDone || ev.melodyDone) this.updateTop();
    if (ev.setDone) {
      this.accepting = false;
      if (this.practice) {
        this.after(600, () => {
          const done = this.practiceDone;
          this.practiceDone = null;
          this.msg.innerHTML = "";
          done?.();
        });
        return;
      }
      this.say(this.ctx.t("melody.done"), 2000);
      this.after(800, () => this.ctx.session.contentExhausted("content_exhausted"));
    }
  }

  // ---------------------------------------------------------------- frame

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
    if (this.engine.started && !this.engine.done) this.onUpdate();
    this.drawNotes();
    this.drawSparks(dt);
  }

  private layout() {
    const { width: W, height: H } = this.app.screen;
    const portrait = H > W;
    void portrait;
    // The keyboard's height comes from CSS (32 %, 38 % in portrait); the hit line sits on its top edge.
    this.kbTop = this.keysEl.getBoundingClientRect().top - this.ctx.mount.getBoundingClientRect().top;
    this.drawBackground(W, H);
    // Lane centres from the real key buttons (white and black keys differ in width and place).
    const rect = this.ctx.mount.getBoundingClientRect();
    this.laneX = this.keyEls.map((el) => {
      const r = el.getBoundingClientRect();
      return r.left - rect.left + r.width / 2;
    });
    const whites = this.keyEls.filter((el) => !el.classList.contains("black"));
    this.laneW = whites.length ? whites[0]!.getBoundingClientRect().width : 40;
    this.drawLanes();
  }

  private drawBackground(W: number, H: number) {
    const L = this.look;
    const g = this.bg;
    g.clear();
    const sky = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: L.sky.map((c, i) => ({ offset: i / (L.sky.length - 1), color: c })), textureSpace: "local" });
    g.rect(0, 0, W, H).fill(sky);
    if (this.ctx.palette === "warm") {
      // A stage: curtains at the sides and two spotlights.
      for (const side of [0, 1]) {
        const x0 = side ? W : 0;
        const dir = side ? -1 : 1;
        for (let i = 0; i < 4; i++) g.rect(x0 + dir * i * 18 - (side ? 18 : 0), 0, 18, H).fill({ color: i % 2 ? "#8E1F25" : "#A8282E" });
        g.poly([x0 + dir * 72, 0, x0 + dir * (W * 0.42), H, x0 + dir * (W * 0.18), H]).fill({ color: "#FFF1C2", alpha: 0.08 });
      }
    } else {
      // Moon, stars and the lake.
      g.circle(W * 0.8, H * 0.16, Math.min(W, H) * 0.06).fill({ color: "#F4F1DE" });
      for (let i = 0; i < 60; i++) g.circle(((i * 7919) % 997) / 997 * W, (((i * 104729) % 991) / 991) * H * 0.45, 0.8 + (i % 3) * 0.5).fill({ color: "#FFFFFF", alpha: 0.3 + (i % 4) * 0.12 });
      g.rect(0, H * 0.48, W, H * 0.52).fill({ color: "#0B1B3F", alpha: 0.6 });
      for (let i = 0; i < 6; i++) g.rect(W * 0.8 - 30 + (i % 2) * 10, H * 0.5 + i * 12, 60 - i * 8, 3).fill({ color: "#F4F1DE", alpha: 0.25 - i * 0.03 });
    }
  }

  private drawLanes() {
    const g = this.lanes;
    g.clear();
    const top = HUD_SPACE + TOP_BAR;
    for (let i = 0; i < this.laneX.length; i++) {
      const black = this.keyEls[i]!.classList.contains("black");
      g.moveTo(this.laneX[i]!, top).lineTo(this.laneX[i]!, this.kbTop).stroke({ width: black ? 1 : 1.5, color: this.look.lane, alpha: 0.18 });
    }
    // The hit line just above the keys.
    g.rect(0, this.kbTop - 6, this.app.screen.width, 6).fill({ color: this.look.lane, alpha: 0.35 });
  }

  private drawNotes() {
    const g = this.notesG;
    g.clear();
    const e = this.engine;
    if (!e.started) return;
    const top = HUD_SPACE + TOP_BAR;
    const span = this.kbTop - top;
    const r = Math.max(14, Math.min(34, this.laneW * 0.32));
    for (const o of e.visible(this.clock)) {
      const x = this.laneX[o.key];
      if (x === undefined) continue;
      const y = this.kbTop - ((o.t - this.clock) / e.travelMs) * span;
      if (y > this.kbTop + r) continue;
      const fade = o.result === "miss" ? 0.3 : o.result === "hit" || o.result === "false_alarm" ? 0 : 1;
      if (fade === 0) continue;
      if (o.kind === "go") this.drop(g, x, y, r, fade);
      else this.spiky(g, x, y, r * 0.95, fade);
    }
  }

  /** A glowing drop: a sun drop (warm) or a water drop (cold). */
  private drop(g: Graphics, x: number, y: number, r: number, a: number) {
    const L = this.look;
    g.circle(x, y, r * 1.6).fill({ color: L.note, alpha: 0.18 * a });
    g.moveTo(x, y - r * 1.6).bezierCurveTo(x + r * 1.1, y - r * 0.4, x + r, y + r, x, y + r).bezierCurveTo(x - r, y + r, x - r * 1.1, y - r * 0.4, x, y - r * 1.6).fill({ color: L.note, alpha: a });
    g.circle(x - r * 0.25, y + r * 0.1, r * 0.35).fill({ color: L.noteCore, alpha: 0.9 * a });
  }

  /** A no-go ball: a spiky thorn ball (warm) or ice ball (cold). Shape, not colour alone, tells it apart. */
  private spiky(g: Graphics, x: number, y: number, r: number, a: number) {
    const L = this.look;
    const pts: number[] = [];
    for (let i = 0; i < 20; i++) {
      const rr = i % 2 ? r * 0.72 : r * 1.25;
      const ang = (i / 20) * Math.PI * 2;
      pts.push(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr);
    }
    g.poly(pts).fill({ color: L.nogoSpike, alpha: a });
    g.circle(x, y, r * 0.72).fill({ color: L.nogo, alpha: a });
    g.moveTo(x - r * 0.3, y - r * 0.3).lineTo(x + r * 0.3, y + r * 0.3).moveTo(x + r * 0.3, y - r * 0.3).lineTo(x - r * 0.3, y + r * 0.3).stroke({ width: Math.max(2, r * 0.14), color: L.nogoSpike, alpha: a, cap: "round" });
  }

  private spark(key: number, nogo: boolean) {
    const x = this.laneX[key] ?? 0;
    const y = this.kbTop - 4;
    const n = this.ctx.reducedMotion ? 5 : 14;
    const cols = nogo ? [this.look.nogoSpike, "#FFFFFF"] : this.look.spark;
    for (let i = 0; i < n; i++) {
      const a = Math.PI + (i / (n - 1)) * Math.PI;
      const sp = this.ctx.reducedMotion ? 0 : 0.1 + (i % 3) * 0.05;
      this.sparks.push({ x: x + (this.ctx.reducedMotion ? Math.cos(a) * 20 : 0), y: y + (this.ctx.reducedMotion ? Math.sin(a) * 20 : 0), vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 450, c: cols[i % cols.length]! });
    }
  }

  private drawSparks(dt: number) {
    const g = this.fx;
    g.clear();
    for (const s of this.sparks) {
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      g.circle(s.x, s.y, 3).fill({ color: s.c, alpha: Math.max(0, Math.min(1, s.life / 250)) });
    }
    this.sparks = this.sparks.filter((s) => s.life > 0);
  }

  // ---------------------------------------------------------------- DOM: keyboard, title, messages

  private buildDom() {
    const font = `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`;
    const L = this.look;
    const style = document.createElement("style");
    // The keyboard is physical, like a real piano: low notes on the left in Hebrew too (same exception as the
    // timer side), so the row keeps left-to-right order.
    style.textContent = `
      .ek-keys{position:absolute;inset-inline:0;inset-block-end:0;block-size:32%;direction:ltr;display:flex;justify-content:center;padding:0 8px 10px;gap:4px;box-sizing:border-box;background:${L.edge}}
      .ek-key{position:relative;flex:1 1 0;max-inline-size:120px;min-inline-size:44px;border:0;border-radius:0 0 14px 14px;background:${L.ivory};color:${L.ink};font:800 20px ${font};display:flex;align-items:flex-end;justify-content:center;padding-block-end:14px;cursor:pointer;touch-action:manipulation;box-shadow:inset 0 -8px 0 rgb(0 0 0 / .12)}
      .ek-key.black{position:absolute;flex:none;z-index:2;block-size:58%;inset-block-start:0;background:${L.black};color:#FFFFFF;font-size:13px;border-radius:0 0 10px 10px;box-shadow:inset 0 -6px 0 rgb(0 0 0 / .35)}
      .ek-key.down{box-shadow:inset 0 -3px 0 rgb(0 0 0 / .12);background:${L.note}}
      .ek-key.black.down{background:${L.nogoSpike}}
      .ek-key.wrong{animation:ek-nudge .2s}
      .ek-key:focus-visible{outline:4px solid #F5C431;outline-offset:-4px}
      @media (orientation: portrait){.ek-keys{block-size:38%}}
      @keyframes ek-nudge{25%{transform:translateX(-3px)}75%{transform:translateX(3px)}}
      @media (prefers-reduced-motion: reduce){.ek-key.wrong{animation:none}}
      .ek-top{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + 4}px;display:flex;justify-content:center;gap:10px;pointer-events:none;font-family:${font}}
      .ek-pill{display:flex;align-items:center;gap:10px;padding:6px 16px;border-radius:999px;background:rgb(0 0 0 / .45);color:#FFFFFF;font-size:18px;font-weight:800}
      .ek-dots{display:flex;gap:5px}
      .ek-dot{inline-size:10px;block-size:10px;border-radius:50%;border:2px solid #FFFFFF;opacity:.7}
      .ek-dot.on{background:#FFFFFF;opacity:1}
      .ek-msg{position:absolute;inset-inline:0;inset-block-start:${HUD_SPACE + TOP_BAR + 10}px;display:flex;justify-content:center;pointer-events:none;font-family:${font}}
      .ek-say{max-inline-size:min(90vw,560px);text-align:center;padding:10px 20px;border-radius:20px;background:#FFFFFF;color:${L.ink};font-size:20px;font-weight:700;box-shadow:0 6px 18px rgb(0 0 0 / .2)}
    `;
    this.ctx.mount.appendChild(style);
    this.top = document.createElement("div");
    this.top.className = "ek-top";
    this.ctx.mount.appendChild(this.top);
    this.msg = document.createElement("div");
    this.msg.className = "ek-msg";
    this.msg.setAttribute("aria-live", "polite");
    this.ctx.mount.appendChild(this.msg);
    this.keysEl = document.createElement("div");
    this.keysEl.className = "ek-keys";
    this.keysEl.setAttribute("role", "group");
    this.keysEl.setAttribute("aria-label", this.ctx.t("keys"));
    this.ctx.mount.appendChild(this.keysEl);
  }

  /** White keys share the row; black keys sit over the gap between two whites. */
  private buildKeys() {
    this.keysEl.replaceChildren();
    const keys = this.engine.keys;
    this.keyEls = keys.map((midi, i) => {
      const b = document.createElement("button");
      b.type = "button";
      const pc = ((midi % 12) + 12) % 12;
      b.className = isBlack(midi) ? "ek-key black" : "ek-key";
      b.setAttribute("aria-label", this.ctx.t(`note.${pc}`));
      if (!isBlack(midi)) b.textContent = this.ctx.t(`label.${pc}`);
      b.dataset.key = String(i);
      b.addEventListener("pointerdown", (ev) => {
        ev.preventDefault();
        this.press(i);
      });
      // Keyboard and switch access (a pointer press already played).
      b.addEventListener("click", (ev) => {
        if (ev.detail === 0) this.press(i);
      });
      return b;
    });
    for (const el of this.keyEls) if (!el.classList.contains("black")) this.keysEl.appendChild(el);
    for (const el of this.keyEls) if (el.classList.contains("black")) this.keysEl.appendChild(el);
    this.placeBlackKeys();
    new ResizeObserver(() => {
      this.placeBlackKeys();
      this.layout();
    }).observe(this.keysEl);
  }

  private placeBlackKeys() {
    const keys = this.engine.keys;
    const box = this.keysEl.getBoundingClientRect();
    keys.forEach((midi, i) => {
      if (!isBlack(midi)) return;
      const left = this.keyEls[i - 1]!.getBoundingClientRect();
      const w = left.width * 0.62;
      const el = this.keyEls[i]!;
      el.style.inlineSize = `${w}px`;
      el.style.insetInlineStart = `${left.right - box.left - w / 2 + 2}px`;
    });
  }

  private updateTop() {
    const e = this.engine;
    const m = e.melody;
    if (!m) {
      this.top.innerHTML = "";
      return;
    }
    const name = this.ctx.t(`melody.${m.id}`);
    const dots = e.started && e.phraseCount > 1 ? `<span class="ek-dots">${Array.from({ length: e.phraseCount }, (_, i) => `<span class="ek-dot ${i < e.phraseIdx ? "on" : ""}"></span>`).join("")}</span>` : "";
    this.top.innerHTML = `<span class="ek-pill"><span>${escapeHtml(name)}</span>${dots}</span>`;
  }

  private say(text: string, ms: number) {
    this.msg.innerHTML = "";
    const d = document.createElement("div");
    d.className = "ek-say";
    d.textContent = text;
    this.msg.appendChild(d);
    if (ms > 0)
      this.after(ms, () => {
        if (this.msg.firstChild === d) this.msg.innerHTML = "";
      });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

export const echoKeys: GameDefinition = { manifest, create: () => new EchoKeys(), strings };
export default echoKeys;
