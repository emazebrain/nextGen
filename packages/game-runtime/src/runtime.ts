/**
 * The Game Runtime (design doc C4, §8.1–8.3). Runs inside the sandboxed
 * frame. It owns Session Rules, so time and lives behave the same in every
 * game: games report events, the runtime decides. It draws the shared HUD
 * (timer ring on the hemisphere's side, hearts), the instructions, practice,
 * pause menu and the child's summary, and posts one results envelope.
 */
import { Session, timerLayout, timerShown, type EndReason, type SessionRulesConfig, type SessionSnapshot, type TimerLayout } from "@emb/session-rules";
import type { GameDefinition, GameModule, LevelHistoryRow, PauseReason, SessionApi, TrialEvent } from "@emb/game-sdk";
import { isHostMessage, type FrameToHost, type HostToFrame, type LaunchParams, type ResultEnvelope } from "./protocol.ts";
import { HIGH_CONTRAST, PALETTES } from "./palettes.ts";
import { stars, stdMetrics } from "./stats.ts";
import { fill, runtimeStrings, type RuntimeKey } from "./strings.ts";

const MAX_TRIALS = 5000;
const FREEZE_AFTER_LIFE_LOSS_MS = 400;

export function boot(def: GameDefinition, win: Window = window): void {
  const post = (msg: FrameToHost) => win.parent.postMessage(msg, "*");
  let launched = false;
  win.addEventListener("message", (e: MessageEvent) => {
    if (e.source !== win.parent || !isHostMessage(e.data)) return;
    const msg = e.data as HostToFrame;
    if (msg.type === "launch" && !launched) {
      launched = true;
      new Run(def, msg.sessionId, msg.params, msg.demo, post, win).start().catch((err: Error) => post({ type: "error", message: err.message }));
    } else if (current) {
      current.command(msg);
    }
  });
  post({ type: "ready", gameId: def.manifest.id, version: def.manifest.version });
}

let current: Run | null = null;

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function formatTime(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

class Run {
  private session: Session;
  private game: GameModule;
  private trials: TrialEvent[] = [];
  private levels: LevelHistoryRow[] = [];
  private lifeLostCbs: Array<(n: number | null) => void> = [];
  private endCbs: Array<(s: ResultEnvelope["status"]) => void> = [];
  private startedAt: string | null = null;
  private finished = false;
  private practiceCompleted = false;
  private livesStart: number | null;
  private rafId = 0;
  private heartbeat = 0;
  private blurTimer = 0;
  private timerUi!: TimerLayout;
  private lang: "en" | "he";
  private reducedMotion: boolean;
  private els!: { root: HTMLElement; stage: HTMLElement; timer: HTMLElement; segs: SVGElement[][]; fill: HTMLElement | null; time: HTMLElement; hearts: HTMLElement; overlay: HTMLElement; freeze: HTMLElement; glow: HTMLElement; chip: HTMLElement; pause: HTMLButtonElement };

  constructor(
    private readonly def: GameDefinition,
    private readonly sessionId: string,
    private readonly params: LaunchParams,
    private readonly demo: boolean,
    private readonly post: (m: FrameToHost) => void,
    private readonly win: Window,
  ) {
    current = this;
    const mode = params.session_mode;
    const cfg: SessionRulesConfig = { mode };
    if (mode !== "lives") cfg.durationS = params.duration_s ?? 300;
    if (mode !== "timed") cfg.lives = params.lives ?? 3;
    this.session = new Session(cfg);
    this.livesStart = typeof cfg.lives === "number" ? cfg.lives : null;
    this.game = def.create();
    this.lang = params.lang === "he" ? "he" : "en";
    this.reducedMotion =
      params.reduce_motion === "on" || (params.reduce_motion !== "off" && win.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
  }

  private t(key: RuntimeKey, vars?: Record<string, string | number>) {
    return fill(runtimeStrings[this.lang][key], vars);
  }
  private gt(key: string, vars?: Record<string, string | number>) {
    const table = this.def.strings[this.lang] ?? this.def.strings.en;
    return fill(table[key] ?? this.def.strings.en[key] ?? key, vars);
  }
  private now() {
    return this.win.performance.now();
  }

  async start() {
    this.buildDom();
    const palette = this.params.hemisphere === "right" ? "cold" : "warm";
    const api = this.sessionApi();
    const mono = this.monochrome();
    await this.game.init({
      params: this.params,
      assets: null,
      rng: seeded(this.params.seed ?? 1),
      t: (k, v) => this.gt(k, v),
      session: api,
      mount: this.els.stage,
      reducedMotion: this.reducedMotion,
      palette,
      tokens: { ...PALETTES[mono ? "mono" : palette] },
      monochrome: mono,
    });
    this.watchFocus();
    this.heartbeat = this.win.setInterval(() => this.post({ type: "heartbeat", activeMs: Math.round(this.session.tick(this.now()).activeMs), phase: this.session.tick(this.now()).phase }), 1000);
    this.loop();
    this.showInstructions(async () => {
      const wantPractice = this.params.practice !== "off" && this.def.manifest.capabilities.practice && !!this.game.startPractice;
      if (wantPractice) {
        this.els.chip.textContent = this.t("practice");
        this.els.chip.hidden = false;
        await this.game.startPractice!();
        this.practiceCompleted = true;
        this.els.chip.hidden = true;
        await this.flash(this.t("practiceDone"));
      }
      this.game.start(); // the clock still waits for the game's qualifying interaction
    });
  }

  command(msg: HostToFrame) {
    if (this.finished) return;
    if (msg.type === "pause") this.pause("therapist_hold");
    else if (msg.type === "resume") this.resumeNow();
    else if (msg.type === "quit") this.quit("therapist");
  }

  // ---------------------------------------------------------------- session API given to the game

  private sessionApi(): SessionApi {
    const self = this;
    return {
      qualifyingInteraction() {
        if (self.session.snapshot().phase !== "ready") return;
        self.session.qualifyingInteraction(self.now());
        self.startedAt = new Date().toISOString();
        self.post({ type: "started" });
      },
      trial(t) {
        if (self.trials.length < MAX_TRIALS && !self.finished) self.trials.push(t);
      },
      lifeLossEvent(_id) {
        const before = self.session.snapshot().livesRemaining;
        const outcome = self.session.lifeLossEvent(self.now());
        if (outcome === "life_lost") self.onLifeLost(before);
        self.checkEnd();
      },
      levelComplete(row) {
        self.levels.push(row);
      },
      contentExhausted(reason) {
        self.session.contentExhausted(self.now(), reason ?? "content_exhausted");
        self.checkEnd();
      },
      log() {
        /* event log is part of the trials stream for now */
      },
      onLifeLost(cb) {
        self.lifeLostCbs.push(cb);
      },
      onTrialWindow() {
        /* games draw their own trial-window bar */
      },
      onEnd(cb) {
        self.endCbs.push(cb);
      },
      get state() {
        const s = self.session.snapshot();
        return { activeMs: s.activeMs, livesRemaining: s.livesRemaining, mode: s.mode, paused: s.phase === "paused" };
      },
    };
  }

  // ---------------------------------------------------------------- loop, pause, end

  private loop = () => {
    const snap = this.session.tick(this.now());
    this.renderHud(snap);
    if (snap.phase === "ended") this.finish(snap);
    else this.rafId = this.win.requestAnimationFrame(this.loop);
  };

  private checkEnd() {
    const snap = this.session.snapshot();
    if (snap.phase === "ended") this.finish(snap);
  }

  private pause(reason: PauseReason) {
    const phase = this.session.snapshot().phase;
    if (this.finished || phase === "ended") return;
    if (phase === "playing") this.session.pause(this.now(), reason);
    this.game.pause(reason);
    this.checkEnd();
    if (!this.finished) this.showPaused();
  }

  private resumeNow() {
    this.closeOverlay();
    if (this.session.snapshot().phase === "paused") this.session.resume(this.now());
    this.checkEnd(); // a pause longer than abandon_after_s abandons the session
    if (!this.finished) this.game.resume();
  }

  private quit(by: "player" | "therapist") {
    this.session.quit(this.now(), by);
    this.checkEnd();
  }

  private watchFocus() {
    this.win.document.addEventListener("visibilitychange", () => {
      if (this.win.document.visibilityState === "hidden") this.pause("app_hidden");
    });
    this.win.addEventListener("blur", () => {
      this.blurTimer = this.win.setTimeout(() => this.pause("focus_lost"), 500);
    });
    this.win.addEventListener("focus", () => this.win.clearTimeout(this.blurTimer));
  }

  private finish(snap: SessionSnapshot) {
    if (this.finished) return;
    this.finished = true;
    this.win.cancelAnimationFrame(this.rafId);
    this.win.clearInterval(this.heartbeat);
    const status = snap.status!;
    const reason = snap.endReason as EndReason;
    let metrics: Record<string, unknown> = {};
    try {
      metrics = this.game.end(status, reason);
    } catch {
      metrics = {};
    }
    for (const cb of this.endCbs) cb(status);
    const std = stdMetrics(this.trials);
    const envelope: ResultEnvelope = {
      envelope_version: "1",
      session_id: this.sessionId,
      game_id: this.def.manifest.id,
      game_version: this.def.manifest.version,
      demo: this.demo,
      started_at: this.startedAt,
      ended_at: new Date().toISOString(),
      status,
      end_reason: reason,
      mode: snap.mode,
      params: this.params,
      active_ms: Math.round(snap.activeMs),
      paused_ms: Math.round(snap.pausedMs),
      lives_start: this.livesStart,
      lives_lost: snap.livesLost,
      lives_remaining: snap.livesRemaining,
      life_loss_events: snap.lifeLossEvents,
      difficulty_start: this.params.difficulty,
      levels: this.levels,
      std,
      metrics,
      trials: this.trials,
      practice_completed: this.practiceCompleted,
    };
    this.post({ type: "ended", envelope });
    this.showSummary(status, std.accuracy, typeof metrics.best_streak === "number" ? metrics.best_streak : null);
  }

  // ---------------------------------------------------------------- DOM

  private buildDom() {
    const d = this.win.document;
    const palette = this.params.hemisphere === "right" ? "cold" : "warm";
    const mono = this.monochrome();
    const p = PALETTES[mono ? "mono" : palette];
    const hc = this.params.high_contrast;
    d.documentElement.lang = this.lang;
    d.documentElement.dir = this.lang === "he" ? "rtl" : "ltr";
    const style = d.createElement("style");
    style.textContent = css({
      hc,
      timer: mono ? TIMER_MONO : TIMER,
      hudBg: hc ? HIGH_CONTRAST.hudBg : p.hudBg,
      hudFg: hc ? HIGH_CONTRAST.hudFg : p.hudFg,
      hudAccent: p.hudAccent,
      hudWarning: p.hudWarning,
      btn: p.btn,
      btnText: p.btnText,
      heart: p.heart,
      surface: p.g50,
      ink: p.g900,
      outline: hc ? HIGH_CONTRAST.outline : "transparent",
      reduced: this.reducedMotion,
    });
    d.head.appendChild(style);
    const root = d.createElement("div");
    root.className = "emb-root";
    // The timer goes in the corner opposite the trained hemisphere, styled by its palette (ADR 0008):
    // left (warm) → top right, digital clock; right (cold) → top left, emptying bar.
    // The side is clinical, so it is physical and never mirrored in RTL (§7.8).
    const ui = (this.timerUi = timerLayout(this.params.hemisphere === "right" ? "right" : "left"));
    const face =
      ui.style === "digital"
        ? `<svg class="lcd" viewBox="0 0 ${LCD_W} 44" aria-hidden="true">${[0, 1, 2, 3].map((i) => digitSvg(i)).join("")}<circle class="colon" cx="${LCD_COLON}" cy="15" r="2.6"/><circle class="colon" cx="${LCD_COLON}" cy="29" r="2.6"/></svg>`
        : `<span class="bar" aria-hidden="true"><span class="fill"></span></span>`;
    root.innerHTML = `
      <div class="stage" aria-hidden="true"></div>
      <div class="hud" dir="ltr">
        <div class="hud-timer t-${ui.style} side-${ui.side}" role="timer" aria-live="off">
          ${face}
          <span class="time vh"></span>
        </div>
        <div class="hud-hearts side-${ui.side === "right" ? "left" : "right"}" role="img"></div>
        <button class="hud-pause" type="button"><span aria-hidden="true">❚❚</span></button>
        <div class="hud-chip" hidden></div>
        ${this.demo ? `<div class="hud-demo">${this.t("demo")}</div>` : ""}
      </div>
      <div class="glow" aria-hidden="true"></div>
      <div class="freeze" hidden></div>
      <div class="overlay" hidden role="dialog" aria-modal="true"></div>`;
    d.body.appendChild(root);
    const q = <T extends Element>(s: string) => root.querySelector(s) as T;
    this.els = {
      root,
      stage: q(".stage"),
      timer: q(".hud-timer"),
      segs: [...root.querySelectorAll(".lcd .digit")].map((g) => [...g.querySelectorAll<SVGElement>(".seg")]),
      fill: root.querySelector<HTMLElement>(".bar .fill"),
      time: q(".time"),
      hearts: q(".hud-hearts"),
      overlay: q(".overlay"),
      freeze: q(".freeze"),
      glow: q(".glow"),
      chip: q(".hud-chip"),
      pause: q(".hud-pause"),
    };
    this.els.pause.setAttribute("aria-label", this.t("pause"));
    this.els.pause.addEventListener("click", () => this.pause("manual"));
    if (this.session.snapshot().remainingMs === null) this.els.timer.hidden = true;
    if (!timerShown(this.params.timer_position)) this.els.timer.hidden = true;
  }

  /** Lights the seven-segment digits of the MM:SS clock. */
  private setDigits(digits: string) {
    [...digits].forEach((ch, i) => {
      const on = SEGMENTS[Number(ch)] ?? "";
      this.els.segs[i]?.forEach((seg, k) => seg.classList.toggle("on", on.includes("abcdefg"[k]!)));
    });
  }

  /** Black and white, when the step asks for it and the game supports it (ADR 0009). */
  private monochrome(): boolean {
    return this.params.monochrome === true && this.def.manifest.capabilities.monochrome === true;
  }

  private renderHud(s: SessionSnapshot) {
    const total = (this.session.config.durationS ?? 0) * 1000;
    if (s.remainingMs !== null && !this.els.timer.hidden) {
      const frac = total ? Math.max(0, Math.min(1, s.remainingMs / total)) : 0;
      if (this.els.fill) this.els.fill.style.transform = `scaleX(${frac})`;
      const label = formatTime(s.remainingMs);
      if (this.els.time.textContent !== label) {
        this.els.time.textContent = label;
        if (this.timerUi.style === "digital") this.setDigits(clockDigits(s.remainingMs));
        this.els.timer.setAttribute("aria-label", s.phase === "ready" ? this.t("timeTotal", { time: label }) : this.t("timeLeft", { time: label }));
      }
      this.els.timer.classList.toggle("warning", s.timerWarning);
    }
    if (this.livesStart !== null) {
      const left = s.livesRemaining ?? 0;
      if (this.els.hearts.dataset.left !== String(left)) {
        this.els.hearts.dataset.left = String(left);
        this.els.hearts.setAttribute("aria-label", this.t("hearts", { n: left }));
        const compact = this.livesStart > 5 && this.win.innerWidth < 600;
        this.els.hearts.innerHTML = compact
          ? `<span class="heart full">${HEART}</span><span class="count">×${left}</span>`
          : Array.from({ length: this.livesStart }, (_, i) => `<span class="heart ${i < left ? "full" : "empty"}">${HEART}</span>`).join("");
      }
    } else {
      this.els.hearts.hidden = true;
    }
  }

  /** The shared life-lost moment: the heart cracks and drops, the edge glows, input freezes for 400 ms. */
  private onLifeLost(before: number | null) {
    const left = this.session.snapshot().livesRemaining;
    if (before !== null && !this.reducedMotion) {
      const hearts = this.els.hearts.querySelectorAll(".heart");
      const lost = hearts[before - 1] as HTMLElement | undefined;
      if (lost) {
        const clone = lost.cloneNode(true) as HTMLElement;
        clone.classList.add("falling");
        lost.appendChild(clone);
      }
    }
    this.els.glow.classList.remove("on");
    void this.els.glow.offsetWidth;
    this.els.glow.classList.add("on");
    this.els.freeze.hidden = false;
    this.win.setTimeout(() => (this.els.freeze.hidden = true), FREEZE_AFTER_LIFE_LOSS_MS);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(40);
    for (const cb of this.lifeLostCbs) cb(left);
  }

  // ---------------------------------------------------------------- overlays

  private open(html: string) {
    this.els.overlay.innerHTML = html;
    this.els.overlay.hidden = false;
    (this.els.overlay.querySelector("[data-autofocus]") as HTMLElement | null)?.focus();
  }
  private closeOverlay() {
    this.els.overlay.hidden = true;
    this.els.overlay.innerHTML = "";
  }

  private showInstructions(onPlay: () => void) {
    const dual = this.def.strings.en["instructions.dual"] ? `<p class="sub">${this.gt("instructions.dual")}</p>` : "";
    this.open(`
      <div class="card">
        <h1>${this.gt("instructions.title")}</h1>
        <p class="lead">${this.gt("instructions.text")}</p>
        ${dual}
        <button class="big" type="button" data-autofocus data-play>${this.t("play")}</button>
      </div>`);
    this.els.overlay.querySelector("[data-play]")!.addEventListener("click", () => {
      this.closeOverlay();
      onPlay();
    });
  }

  private flash(text: string): Promise<void> {
    return new Promise((resolve) => {
      this.open(`<div class="card flash"><p class="lead">${text}</p></div>`);
      this.win.setTimeout(() => {
        this.closeOverlay();
        resolve();
      }, 1500);
    });
  }

  private showPaused() {
    this.open(`
      <div class="card">
        <h1>${this.t("paused")}</h1>
        <button class="big" type="button" data-autofocus data-resume>${this.t("resume")}</button>
        <div class="row">
          <button class="small" type="button" data-how>${this.t("howToPlay")}</button>
          <button class="small hold" type="button" data-quit><span class="fill"></span><span class="label">${this.t("holdToQuit")}</span></button>
        </div>
        <p class="sub how" hidden>${this.gt("instructions.text")}</p>
      </div>`);
    const o = this.els.overlay;
    o.querySelector("[data-resume]")!.addEventListener("click", () => this.countdown());
    o.querySelector("[data-how]")!.addEventListener("click", () => ((o.querySelector(".how") as HTMLElement).hidden = false));
    // Quitting needs a 2-second hold, so a child can't end the session by accident (§8.1).
    const quit = o.querySelector("[data-quit]") as HTMLButtonElement;
    let timer = 0;
    const start = () => {
      quit.classList.add("holding");
      timer = this.win.setTimeout(() => this.quit("player"), 2000);
    };
    const cancel = () => {
      quit.classList.remove("holding");
      this.win.clearTimeout(timer);
    };
    quit.addEventListener("pointerdown", start);
    quit.addEventListener("pointerup", cancel);
    quit.addEventListener("pointerleave", cancel);
    quit.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.repeat) start();
    });
    quit.addEventListener("keyup", cancel);
  }

  /** 3-2-1 before play resumes; the countdown isn't play time. Reduced motion: a static "Ready?" and a tap. */
  private countdown() {
    if (this.reducedMotion) {
      this.open(`<div class="card"><h1>${this.t("ready")}</h1><button class="big" type="button" data-autofocus data-go>${this.t("play")}</button></div>`);
      this.els.overlay.querySelector("[data-go]")!.addEventListener("click", () => this.resumeNow());
      return;
    }
    let n = 3;
    const tick = () => {
      if (n === 0) return this.resumeNow();
      this.open(`<div class="card flash"><p class="count">${n}</p></div>`);
      n -= 1;
      this.win.setTimeout(tick, 1000);
    };
    tick();
  }

  private showSummary(status: ResultEnvelope["status"], accuracy: number | null, bestStreak: number | null) {
    const n = stars(accuracy);
    // The child never sees "Game over": running out of hearts is "Great effort!" (§8.1).
    const line = status === "out_of_lives" || status === "abandoned" ? this.t("great") : n === 3 ? this.t("amazing") : this.t("good");
    const starsHtml = [1, 2, 3].map((i) => `<span class="star ${i <= n ? "on" : ""}">${STAR}</span>`).join("");
    this.open(`
      <div class="card summary">
        <div class="stars" role="img" aria-label="${this.t("stars", { n })}">${starsHtml}</div>
        <h1>${line}</h1>
        ${bestStreak ? `<p class="sub">${this.t("bestStreak", { n: bestStreak })}</p>` : ""}
        <button class="big" type="button" data-autofocus data-done>${this.t("done")}</button>
      </div>`);
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      this.game.destroy();
      this.post({ type: "closed" });
    };
    this.els.overlay.querySelector("[data-done]")!.addEventListener("click", close);
    this.win.setTimeout(close, 10_000); // auto-advance after 10 s
  }
}

/** Timer colours (ADR 0008): warm amber digits for the clock, cold blues for the bar. Warnings stay in the same family. */
interface TimerColours {
  warm: { bg: string; rim: string; on: string; off: string; glow: string; warn: string };
  cold: { bg: string; rim: string; track: string; from: string; to: string; warn: string };
}
const TIMER: TimerColours = {
  warm: { bg: "#2A0E0B", rim: "#7A2420", on: "#FFB547", off: "rgb(255 181 71 / .12)", glow: "rgb(255 143 61 / .55)", warn: "#F5C431" },
  cold: { bg: "rgb(14 21 48 / .9)", rim: "#232C6B", track: "rgb(108 196 232 / .16)", from: "#2FB3C8", to: "#6CC4E8", warn: "#B39BFF" },
} as const;

/** The same two timers in greys, for black and white (ADR 0009). */
const TIMER_MONO: TimerColours = {
  warm: { bg: "#141414", rim: "#5F5F5F", on: "#F7F7F7", off: "rgb(247 247 247 / .1)", glow: "rgb(255 255 255 / .35)", warn: "#FFFFFF" },
  cold: { bg: "rgb(20 20 20 / .9)", rim: "#444444", track: "rgb(255 255 255 / .14)", from: "#9A9A9A", to: "#E9E9E9", warn: "#FFFFFF" },
};

/** Seven-segment digits: which of a–g are lit for 0–9. */
const SEGMENTS = ["abcdef", "bc", "abdeg", "abcdg", "bcfg", "acdfg", "acdefg", "abc", "abcdefg", "abcdfg"];
const DIGIT_X = [2, 26, 56, 80]; // MM:SS, with the colon between the second and third digit
const LCD_W = 104;
const LCD_COLON = 51;

/** One seven-segment digit in a 20 × 40 cell, its segments in a–g order (top, upper right, lower right, bottom, lower left, upper left, middle). */
function digitSvg(i: number): string {
  const x = DIGIT_X[i]!;
  const hz = (y: number) => { const x1 = x + 3, x2 = x + 17; return `M${x1} ${y}L${x1 + 2} ${y - 2}H${x2 - 2}L${x2} ${y}L${x2 - 2} ${y + 2}H${x1 + 2}Z`; };
  const vt = (xx: number, y1: number, y2: number) => `M${xx} ${y1}L${xx + 2} ${y1 + 2}V${y2 - 2}L${xx} ${y2}L${xx - 2} ${y2 - 2}V${y1 + 2}Z`;
  const l = x + 2, r = x + 18;
  const segs = [hz(4), vt(r, 5, 21), vt(r, 23, 39), hz(40), vt(l, 23, 39), vt(l, 5, 21), hz(22)];
  return `<g class="digit">${segs.map((d) => `<path class="seg" d="${d}"/>`).join("")}</g>`;
}

/** MM:SS as four digits, rounded up like the spoken time (a clock never shows 00:00 while time remains). */
function clockDigits(ms: number): string {
  const total = Math.min(99 * 60 + 59, Math.ceil(Math.max(0, ms) / 1000));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}${String(total % 60).padStart(2, "0")}`;
}

const HEART = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.7 4.5c2.1 0 3.6 1.2 4.3 2.4.7-1.2 2.2-2.4 4.3-2.4 3.7 0 5.8 3.9 4.3 7.3C19.5 16.4 12 21 12 21z"/></svg>`;
const STAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17.3l-5.9 3.3 1.3-6.6-4.9-4.6 6.6-.8z"/></svg>`;

function css(v: { hc: boolean; timer: TimerColours; hudBg: string; hudFg: string; hudAccent: string; hudWarning: string; btn: string; btnText: string; heart: string; surface: string; ink: string; outline: string; reduced: boolean }) {
  return `
  *{box-sizing:border-box}
  [hidden]{display:none!important}
  html,body{margin:0;height:100%;overflow:hidden;background:${v.surface};font-family:ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif;-webkit-user-select:none;user-select:none;touch-action:manipulation}
  .emb-root,.stage{position:fixed;inset:0}
  .stage canvas{display:block}
  .hud{position:fixed;inset:0;pointer-events:none}
  .hud>*{pointer-events:auto}
  /* physical-ok: the timer side follows the hemisphere and is never mirrored */
  .side-left{position:absolute;top:16px;left:24px}
  .side-right{position:absolute;top:16px;right:24px}
  .vh{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
  /* Left hemisphere: a warm four-digit digital clock (MM:SS), top right. */
  .t-digital{display:grid;place-items:center;padding:8px 12px;border-radius:12px;background:${v.hc ? "#000" : v.timer.warm.bg};border:2px solid ${v.timer.warm.rim};outline:3px solid ${v.outline}}
  .t-digital .lcd{display:block;width:${LCD_W * 1.25}px;height:55px}
  .t-digital .seg{fill:${v.timer.warm.off}}
  .t-digital .seg.on,.t-digital .colon{fill:${v.timer.warm.on}}
  .t-digital .lcd{filter:drop-shadow(0 0 4px ${v.timer.warm.glow})}
  .t-digital.warning .seg.on,.t-digital.warning .colon{fill:${v.timer.warm.warn}}
  /* Right hemisphere: a cold bar that empties as time runs out, top left. */
  .t-bar{display:block;width:min(36vw,300px);padding:5px;border-radius:999px;background:${v.hc ? "#000" : v.timer.cold.bg};border:2px solid ${v.timer.cold.rim};outline:3px solid ${v.outline}}
  .t-bar .bar{display:block;height:22px;border-radius:999px;background:${v.timer.cold.track};overflow:hidden}
  .t-bar .fill{display:block;height:100%;border-radius:999px;background:linear-gradient(90deg,${v.timer.cold.from},${v.timer.cold.to});transform-origin:0 50%;${v.reduced ? "" : "transition:transform .25s linear,background .3s"}}
  .t-bar.warning .fill{background:${v.timer.cold.warn}}
  ${v.reduced ? "" : `.hud-timer.warning{animation:pulse 1s ease-in-out infinite}`}
  @keyframes pulse{50%{transform:scale(1.06)}}
  .hud-hearts{display:flex;gap:6px;align-items:center;padding:10px 14px;border-radius:999px;background:${v.hudBg};color:${v.hudFg};outline:3px solid ${v.outline}}
  .heart{position:relative;width:30px;height:30px;display:inline-block}
  .heart svg{width:100%;height:100%;fill:${v.heart};stroke:${v.hudFg};stroke-width:1.2}
  .heart.empty svg{fill:transparent;stroke:rgb(255 255 255 / .55)}
  .heart .falling{position:absolute;inset:0;animation:fall .6s ease-in forwards}
  @keyframes fall{0%{transform:none;opacity:1}30%{transform:rotate(-12deg) scale(1.1)}100%{transform:translateY(40px) rotate(20deg);opacity:0}}
  .hud-hearts .count{font-size:20px;font-weight:700}
  .hud-pause{position:absolute;top:16px;left:50%;transform:translateX(-50%);width:56px;height:56px;border:0;border-radius:50%;background:${v.hudBg};color:${v.hudFg};font-size:18px;cursor:pointer;outline:3px solid ${v.outline}}
  .hud-chip,.hud-demo{position:absolute;top:80px;left:50%;transform:translateX(-50%);padding:6px 16px;border-radius:999px;background:${v.hudBg};color:${v.hudFg};font-weight:700;font-size:16px;white-space:nowrap}
  .hud-demo{top:auto;bottom:12px;font-size:13px;font-weight:600;opacity:.9}
  .glow{position:fixed;inset:0;pointer-events:none;box-shadow:inset 0 0 0 0 transparent}
  .glow.on{animation:glow .3s ease-out}
  @keyframes glow{0%{box-shadow:inset 0 0 60px 20px color-mix(in srgb, ${v.hudWarning} 30%, transparent)}100%{box-shadow:inset 0 0 0 0 transparent}}
  .freeze{position:fixed;inset:0;z-index:5}
  .overlay{position:fixed;inset:0;z-index:10;display:grid;place-items:center;padding:24px;background:rgb(0 0 0 / .35)}
  .overlay[hidden]{display:none}
  .card{display:grid;justify-items:center;gap:16px;max-width:560px;width:100%;padding:36px 32px;border-radius:24px;background:${v.surface};color:${v.ink};text-align:center;box-shadow:0 20px 50px rgb(0 0 0 / .25)}
  .card h1{margin:0;font-size:40px;line-height:1.15}
  .card .lead{margin:0;font-size:26px;line-height:1.35}
  .card .sub{margin:0;font-size:20px;opacity:.85}
  .card .count{margin:0;font-size:96px;font-weight:800}
  .card.flash{background:${v.surface}}
  .big{min-height:88px;min-width:240px;padding:0 40px;border:0;border-radius:24px;background:${v.btn};color:${v.btnText};font:inherit;font-size:30px;font-weight:800;cursor:pointer}
  .row{display:flex;gap:12px;flex-wrap:wrap;justify-content:center}
  .small{position:relative;overflow:hidden;min-height:56px;padding:0 20px;border:2px solid ${v.ink};border-radius:16px;background:transparent;color:${v.ink};font:inherit;font-size:18px;font-weight:700;cursor:pointer}
  .hold .fill{position:absolute;inset:0;width:0;background:color-mix(in srgb, ${v.btn} 25%, transparent)}
  .hold.holding .fill{width:100%;transition:width 2s linear}
  .hold .label{position:relative}
  .stars{display:flex;gap:10px}
  .star{width:64px;height:64px}
  .star svg{width:100%;height:100%;fill:rgb(0 0 0 / .12)}
  .star.on svg{fill:#F5C431;stroke:${v.ink};stroke-width:.6}
  button:focus-visible{outline:4px solid ${v.hudWarning};outline-offset:3px}
  `;
}
