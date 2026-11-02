/**
 * @emb/session-rules — the one module that owns time, lives and end conditions
 * for every eMazeBrain game (design doc §8.1).
 *
 * Pure and deterministic: no Date.now(), no timers. The host passes `now`
 * (milliseconds from a monotonic clock such as performance.now()) into every
 * call, so the same inputs always produce the same session. Games never run
 * their own clock or life counter; they report events and this module decides.
 */

export type SessionMode = "timed" | "lives" | "timed_lives";

export type SessionStatus = "completed" | "time_up" | "out_of_lives" | "abandoned";

export type EndReason =
  | "content_exhausted"
  | "max_level"
  | "trial_cap"
  | "safety_cap"
  | "duration_elapsed"
  | "lives_depleted"
  | "quit_by_player"
  | "quit_by_therapist"
  | "background_timeout"
  | "app_killed"
  | "crash";

export type Phase = "ready" | "playing" | "paused" | "ended";

export type PauseReason = "app_hidden" | "manual" | "instructions" | "therapist_hold" | "focus_lost";

export interface SessionRulesConfig {
  mode: SessionMode;
  /** Session length in seconds, 30–1800. Required when the mode includes time. */
  durationS?: number;
  /** 1–9, or "auto" when the game manages a per-board budget (Peek Peek). Required when the mode includes lives. */
  lives?: number | "auto";
  /** Hard stop for modes without a clock. Default 1800 s. */
  safetyCapS?: number;
  /** Paused longer than this abandons the session. Default 600 s, range 60–3600. */
  abandonAfterS?: number;
  /** No second life loss within this window (continuous games). Default 0, range 0–3000. */
  lifeLossGraceMs?: number;
}

export interface SessionSnapshot {
  phase: Phase;
  mode: SessionMode;
  /** Play time with pauses excluded. */
  activeMs: number;
  pausedMs: number;
  /** null when the mode has no clock. */
  remainingMs: number | null;
  /** null when the mode has no lives, or when lives are game-managed ("auto"). */
  livesRemaining: number | null;
  livesLost: number;
  /** Mistakes reported by the game, whether or not they cost a life. */
  lifeLossEvents: number;
  status: SessionStatus | null;
  endReason: EndReason | null;
  /** True for the last 10 s of a timed session (HUD warning state). */
  timerWarning: boolean;
}

export type LifeLossOutcome =
  /** A life was consumed. */
  | "life_lost"
  /** Timed mode: recorded as an error, no life involved. */
  | "recorded_only"
  /** Inside the grace window after a previous loss. */
  | "ignored_grace"
  /** lives = "auto": the game applies its own board budget. */
  | "game_managed"
  /** Session not in the playing phase. */
  | "ignored_not_playing";

export class SessionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SessionConfigError";
  }
}

const DEFAULTS = {
  safetyCapS: 1800,
  abandonAfterS: 600,
  lifeLossGraceMs: 0,
} as const;

const WARNING_MS = 10_000;

const usesTime = (m: SessionMode) => m === "timed" || m === "timed_lives";
const usesLives = (m: SessionMode) => m === "lives" || m === "timed_lives";

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

/** Throws SessionConfigError on any invalid combination; returns a normalised config. */
export function validateConfig(config: SessionRulesConfig): Required<Omit<SessionRulesConfig, "durationS" | "lives">> &
  Pick<SessionRulesConfig, "durationS" | "lives"> {
  const { mode } = config;
  if (mode !== "timed" && mode !== "lives" && mode !== "timed_lives") {
    throw new SessionConfigError(`Unknown session mode: ${String(mode)}`);
  }
  if (usesTime(mode)) {
    if (config.durationS === undefined || !inRange(config.durationS, 30, 1800)) {
      throw new SessionConfigError(`Mode "${mode}" needs durationS between 30 and 1800`);
    }
  }
  if (usesLives(mode)) {
    const l = config.lives;
    if (l === undefined || (l !== "auto" && !(Number.isInteger(l) && inRange(l, 1, 9)))) {
      throw new SessionConfigError(`Mode "${mode}" needs lives between 1 and 9, or "auto"`);
    }
  }
  const safetyCapS = config.safetyCapS ?? DEFAULTS.safetyCapS;
  const abandonAfterS = config.abandonAfterS ?? DEFAULTS.abandonAfterS;
  const lifeLossGraceMs = config.lifeLossGraceMs ?? DEFAULTS.lifeLossGraceMs;
  if (!inRange(safetyCapS, 60, 7200)) throw new SessionConfigError("safetyCapS must be 60–7200");
  if (!inRange(abandonAfterS, 60, 3600)) throw new SessionConfigError("abandonAfterS must be 60–3600");
  if (!inRange(lifeLossGraceMs, 0, 3000)) throw new SessionConfigError("lifeLossGraceMs must be 0–3000");
  return {
    mode,
    durationS: usesTime(mode) ? config.durationS : undefined,
    lives: usesLives(mode) ? config.lives : undefined,
    safetyCapS,
    abandonAfterS,
    lifeLossGraceMs,
  } as ReturnType<typeof validateConfig>;
}

export class Session {
  readonly config: ReturnType<typeof validateConfig>;

  private phase: Phase = "ready";
  private activeMs = 0;
  private pausedMs = 0;
  private lastTickAt: number | null = null;
  private pausedAt: number | null = null;
  private livesRemaining: number | null;
  private livesLost = 0;
  private lifeLossEvents = 0;
  private lastLifeLossAt: number | null = null;
  private status: SessionStatus | null = null;
  private endReason: EndReason | null = null;

  constructor(config: SessionRulesConfig) {
    this.config = validateConfig(config);
    const lives = this.config.lives;
    this.livesRemaining = typeof lives === "number" ? lives : null;
  }

  /** The first real input after instructions and practice. Starts the clock exactly once. */
  qualifyingInteraction(now: number): void {
    if (this.phase !== "ready") return;
    this.phase = "playing";
    this.lastTickAt = now;
  }

  /** Call every frame (or on any event). Accumulates play time and applies time-based endings. */
  tick(now: number): SessionSnapshot {
    if (this.phase === "playing") {
      this.accumulate(now);
      this.checkClockEndings();
    }
    return this.snapshot();
  }

  pause(now: number, _reason: PauseReason = "manual"): void {
    if (this.phase !== "playing") return; // idempotent
    this.accumulate(now);
    if (this.checkClockEndings()) return;
    this.phase = "paused";
    this.pausedAt = now;
  }

  /** Resume after a pause. If the pause lasted longer than abandonAfterS, the session is abandoned instead. */
  resume(now: number): void {
    if (this.phase !== "paused" || this.pausedAt === null) return;
    const away = Math.max(0, now - this.pausedAt);
    this.pausedMs += away;
    this.pausedAt = null;
    if (away > this.config.abandonAfterS * 1000) {
      this.end("abandoned", "background_timeout");
      return;
    }
    this.phase = "playing";
    this.lastTickAt = now;
  }

  /** A game-defined life-loss event (wrong tile, ball lost, collision…). The module decides what it costs. */
  lifeLossEvent(now: number): LifeLossOutcome {
    if (this.phase !== "playing") return "ignored_not_playing";
    this.accumulate(now);
    const timeUp = this.isTimeUp();
    this.lifeLossEvents += 1;

    let outcome: LifeLossOutcome;
    if (!usesLives(this.config.mode)) {
      outcome = "recorded_only";
    } else if (this.livesRemaining === null) {
      outcome = "game_managed";
    } else if (
      this.lastLifeLossAt !== null &&
      now - this.lastLifeLossAt < this.config.lifeLossGraceMs
    ) {
      outcome = "ignored_grace";
    } else {
      this.livesRemaining -= 1;
      this.livesLost += 1;
      this.lastLifeLossAt = now;
      outcome = "life_lost";
    }

    // Precedence within one frame: out_of_lives > time_up > completed.
    if (this.livesRemaining !== null && this.livesRemaining <= 0) {
      this.end("out_of_lives", "lives_depleted");
    } else if (timeUp) {
      this.end("time_up", "duration_elapsed");
    } else {
      this.checkClockEndings();
    }
    return outcome;
  }

  /** The game ran out of content (all levels, trial cap…). */
  contentExhausted(
    now: number,
    reason: Extract<EndReason, "content_exhausted" | "max_level" | "trial_cap"> = "content_exhausted",
  ): void {
    if (this.phase !== "playing") return;
    this.accumulate(now);
    if (this.isTimeUp()) {
      this.end("time_up", "duration_elapsed");
      return;
    }
    this.end("completed", reason);
  }

  quit(now: number, by: "player" | "therapist"): void {
    if (this.phase === "ended") return;
    if (this.phase === "playing") this.accumulate(now);
    if (this.phase === "paused" && this.pausedAt !== null) {
      this.pausedMs += Math.max(0, now - this.pausedAt);
      this.pausedAt = null;
    }
    this.end("abandoned", by === "player" ? "quit_by_player" : "quit_by_therapist");
  }

  /** Used on the next launch to close a session the OS killed. */
  markAppKilled(): void {
    if (this.phase === "ended") return;
    this.end("abandoned", "app_killed");
  }

  snapshot(): SessionSnapshot {
    const remainingMs = usesTime(this.config.mode)
      ? Math.max(0, (this.config.durationS ?? 0) * 1000 - this.activeMs)
      : null;
    return {
      phase: this.phase,
      mode: this.config.mode,
      activeMs: this.activeMs,
      pausedMs: this.pausedMs,
      remainingMs,
      livesRemaining: this.livesRemaining,
      livesLost: this.livesLost,
      lifeLossEvents: this.lifeLossEvents,
      status: this.status,
      endReason: this.endReason,
      timerWarning: remainingMs !== null && this.phase === "playing" && remainingMs <= WARNING_MS,
    };
  }

  // ---- internals ----

  private accumulate(now: number): void {
    if (this.lastTickAt === null) return;
    const delta = now - this.lastTickAt;
    if (delta > 0) this.activeMs += delta; // a clock that goes backwards never removes play time
    this.lastTickAt = now;
  }

  private isTimeUp(): boolean {
    return usesTime(this.config.mode) && this.activeMs >= (this.config.durationS ?? 0) * 1000;
  }

  /** Applies clock-based endings. Returns true if the session ended. */
  private checkClockEndings(): boolean {
    if (this.isTimeUp()) {
      this.end("time_up", "duration_elapsed");
      return true;
    }
    if (!usesTime(this.config.mode) && this.activeMs >= this.config.safetyCapS * 1000) {
      this.end("completed", "safety_cap");
      return true;
    }
    return false;
  }

  private end(status: SessionStatus, reason: EndReason): void {
    if (this.phase === "ended") return;
    if (usesTime(this.config.mode) && status === "time_up") {
      this.activeMs = Math.min(this.activeMs, (this.config.durationS ?? 0) * 1000);
    }
    this.phase = "ended";
    this.status = status;
    this.endReason = reason;
    this.lastTickAt = null;
  }
}

export function createSession(config: SessionRulesConfig): Session {
  return new Session(config);
}

// ---------------------------------------------------------------- timer display (ADR 0008)

export type Hemisphere = "left" | "right";
/** `digital`: a four-digit MM:SS clock in warm colours. `bar`: a bar in cold colours that empties as time runs out. */
export type TimerStyle = "digital" | "bar";
export interface TimerLayout {
  /** Physical top corner. Never mirrored in RTL: the side carries clinical meaning. */
  side: Hemisphere;
  style: TimerStyle;
  palette: "warm" | "cold";
}

/**
 * Where and how the countdown is shown for the hemisphere a step trains
 * (design doc §8.1 Timer rules; decided in ADR 0008): the timer goes in the
 * OPPOSITE top corner. Left (warm) → top right, digital clock. Right (cold) →
 * top left, emptying bar.
 */
export function timerLayout(hemisphere: Hemisphere): TimerLayout {
  return hemisphere === "left" ? { side: "right", style: "digital", palette: "warm" } : { side: "left", style: "bar", palette: "cold" };
}

/**
 * The value to store in a step's `timer_position`: the corner `timerLayout`
 * gives, or `hidden`. Older rows may hold the v1 same-side value; read them
 * through `timerShown` and `timerLayout`, never as a side.
 */
export function timerPositionFor(hemisphere: Hemisphere, shown: boolean): Hemisphere | "hidden" {
  return shown ? timerLayout(hemisphere).side : "hidden";
}

/** Whether a stored `timer_position` shows the timer at all. */
export function timerShown(position: Hemisphere | "hidden"): boolean {
  return position !== "hidden";
}
