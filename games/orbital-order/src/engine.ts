/**
 * Orbital Order flow (design doc §8.4), pure and clock-free: the renderer
 * passes `now` (pause-adjusted ms) into every call.
 *
 * Segments: practice (3, unscored, lenient) → motor baseline (5 single taps,
 * unscored) → probe (5, scored, difficulty 3, even placement) → rule blocks
 * (scored; a rule lasts 5–8 trials, then switches). v1 skipped straight to the
 * rule blocks, so its practice, motor baseline and probe never ran (ADR 0013).
 *
 * A trial: the rule shows (reveal; a tap skips it) → the child taps the chain.
 * Each target has a response window; a wrong tap or a window running out ends a
 * scored trial and is reported to Session Rules as a life-loss event.
 */
import { BLOCK_MAX, BLOCK_MIN, CHAIN_BONUS, COMPREHENSION_PASS, DIFFICULTY, MOTOR_TRIALS, PRACTICE_TRIALS, PROBE_DIFFICULTY, PROBE_TRIALS, SCORE_PER_TAP, type Difficulty, type GlyphType } from "./config.ts";
import { OrbitalMetrics, type TrialRecord } from "./metrics.ts";
import { classifyTap, makeSpheres, nextRule, randInt, sessionPool, solveChain, type ErrorClass, type Rule, type Sphere } from "./rules.ts";

export type Segment = "practice" | "motor" | "probe" | "rules" | "done";
export type Phase = "reveal" | "response" | "feedback";

export interface EngineConfig {
  difficulty: Difficulty;
  palette: "warm" | "cold";
  glyphType: GlyphType;
  hemisphere: "left" | "right";
  /** Unscored single taps before the probe, to measure plain tapping speed. */
  motorBaseline: boolean;
  /** Rule trials before the session completes; null = no cap (timed modes). */
  maxRuleTrials: number | null;
  /** Response window per target; null = the difficulty table. */
  windowOverrideMs: number | null;
  rng: () => number;
}

export interface Trial {
  segment: Segment;
  index: number;
  difficulty: Difficulty;
  rule: Rule | null;
  /** Which parts of the rule changed on a switch trial. */
  changed: Array<"ordering" | "skip">;
  switchTrial: boolean;
  spheres: Sphere[];
  chain: string[];
  committed: string[];
  /** Motor baseline: the one sphere to tap. */
  lit: string | null;
}

export type TapResult =
  | { kind: "ignored" }
  | { kind: "skipReveal" }
  | { kind: "motor" }
  | { kind: "correct"; chainDone: boolean; points: number }
  | { kind: "wrong"; error: Exclude<ErrorClass, "timeout">; expected: string | null; retry: boolean };

export class OrbitalEngine {
  readonly metrics = new OrbitalMetrics();
  readonly pool: number[];
  segment: Segment = "practice";
  phase: Phase = "reveal";
  trial: Trial | null = null;
  score = 0;
  effectiveDifficulty: Difficulty;
  ruleTrials = 0;
  private rule: Rule | null = null;
  private history: Rule[] = [];
  private block = 0;
  private inBlock = 0;
  private blockLength = 0;
  private pendingSwitch: Array<"ordering" | "skip"> | null = null;
  private practiceRight = 0;
  private practiceTried = 0;
  private trialStart = 0;
  private responseStart = 0;
  private lastTap = 0;
  private peekStart: number | null = null;
  private peekMs = 0;
  private peeks = 0;
  private firstTapMs: number | null = null;
  private gaps: number[] = [];
  private run = 0;
  private trialErrored = false;

  constructor(private readonly cfg: EngineConfig) {
    this.pool = sessionPool(cfg.palette, cfg.rng);
    this.effectiveDifficulty = cfg.difficulty;
  }

  private get lean(): -1 | 1 {
    return this.cfg.hemisphere === "left" ? 1 : -1;
  }

  /** Per-target response window for the current trial. */
  get windowMs(): number {
    return this.cfg.windowOverrideMs ?? DIFFICULTY[this.trial?.difficulty ?? this.cfg.difficulty].windowMs;
  }

  get revealMs(): number {
    return DIFFICULTY[this.trial?.difficulty ?? this.cfg.difficulty].revealMs;
  }

  get currentRule(): Rule | null {
    return this.trial?.rule ?? null;
  }

  get scored(): boolean {
    return this.segment === "probe" || this.segment === "rules";
  }

  // ---------------------------------------------------------------- segments

  startPractice(now: number): Trial {
    this.segment = "practice";
    this.rule = nextRule([], this.cfg.difficulty, this.pool, this.cfg.rng);
    return this.newTrial(0, now);
  }

  /** After practice (or without it): motor baseline if on, then the probe. */
  startScored(now: number): Trial {
    if (this.practiceTried > 0 && this.practiceRight < COMPREHENSION_PASS) this.effectiveDifficulty = 1;
    if (this.cfg.motorBaseline) {
      this.segment = "motor";
      return this.newTrial(0, now);
    }
    return this.startProbe(now);
  }

  private startProbe(now: number): Trial {
    this.segment = "probe";
    this.history = [];
    this.rule = nextRule([], PROBE_DIFFICULTY, this.pool, this.cfg.rng);
    return this.newTrial(0, now);
  }

  private startRules(now: number): Trial {
    this.segment = "rules";
    this.history = [];
    this.rule = nextRule([], this.effectiveDifficulty, this.pool, this.cfg.rng);
    this.history.push(this.rule);
    this.block = 1;
    this.inBlock = 0;
    this.blockLength = randInt(BLOCK_MIN, BLOCK_MAX, this.cfg.rng);
    return this.newTrial(0, now);
  }

  private difficultyFor(seg: Segment): Difficulty {
    if (seg === "probe") return PROBE_DIFFICULTY;
    if (seg === "practice" || seg === "motor") return Math.min(this.cfg.difficulty, 2) as Difficulty;
    return this.effectiveDifficulty;
  }

  private newTrial(index: number, now: number): Trial {
    const seg = this.segment;
    const difficulty = this.difficultyFor(seg);
    const changed = seg === "rules" && this.pendingSwitch ? this.pendingSwitch : [];
    const switchTrial = seg === "rules" && this.pendingSwitch !== null;
    this.pendingSwitch = null;
    let spheres: Sphere[];
    let lit: string | null = null;
    if (seg === "motor") {
      // Plain tapping: one sphere lights up, tap it. Same board for all 5, even placement.
      spheres = this.trial?.segment === "motor" ? this.trial.spheres : makeSpheres({ ordering: "up", skip: this.pool[0]! }, { difficulty, glyphType: this.cfg.glyphType, pool: this.pool, lean: null, rng: this.cfg.rng });
      lit = spheres[Math.floor(this.cfg.rng() * spheres.length)]!.id;
    } else {
      spheres = makeSpheres(this.rule!, { difficulty, glyphType: this.cfg.glyphType, pool: this.pool, lean: seg === "rules" ? this.lean : null, rng: this.cfg.rng });
    }
    this.trial = {
      segment: seg,
      index,
      difficulty,
      rule: seg === "motor" ? null : this.rule,
      changed,
      switchTrial,
      spheres,
      chain: seg === "motor" ? [lit!] : solveChain(this.rule!, spheres, this.cfg.glyphType),
      committed: [],
      lit,
    };
    this.trialStart = now;
    this.firstTapMs = null;
    this.gaps = [];
    this.run = 0;
    this.peeks = 0;
    this.peekMs = 0;
    this.trialErrored = false;
    this.phase = seg === "motor" ? "response" : "reveal";
    if (seg === "motor") this.responseStart = this.lastTap = now;
    return this.trial;
  }

  /** The rule has been shown: the child may tap. */
  beginResponse(now: number) {
    if (this.phase !== "reveal") return;
    this.phase = "response";
    this.responseStart = this.lastTap = now;
  }

  // ---------------------------------------------------------------- taps

  tap(id: string, now: number): TapResult {
    const t = this.trial;
    if (!t) return { kind: "ignored" };
    if (this.phase === "reveal") {
      this.beginResponse(now);
      return { kind: "skipReveal" };
    }
    if (this.phase !== "response" || t.committed.includes(id)) return { kind: "ignored" };
    const sphere = t.spheres.find((s) => s.id === id);
    if (!sphere) return { kind: "ignored" };

    if (t.segment === "motor") {
      if (id !== t.lit) return { kind: "ignored" };
      this.metrics.motorTap(now - this.responseStart);
      this.phase = "feedback";
      return { kind: "motor" };
    }

    const sinceLast = now - this.lastTap;
    if (this.firstTapMs === null) this.firstTapMs = now - this.responseStart;
    else this.gaps.push(sinceLast);
    this.lastTap = now;
    const expected = t.chain[t.committed.length] ?? null;
    if (id === expected) {
      t.committed.push(id);
      this.run += 1;
      let points = 0;
      if (this.scored) {
        points += SCORE_PER_TAP;
        this.score += SCORE_PER_TAP;
      }
      const chainDone = t.committed.length >= t.chain.length;
      if (chainDone) {
        if (this.scored) {
          points += CHAIN_BONUS;
          this.score += CHAIN_BONUS;
        }
        this.finishTrial(this.trialErrored ? "incorrect" : "correct", null, now);
      }
      return { kind: "correct", chainDone, points };
    }
    const error = classifyTap(sphere, t.rule!);
    if (t.segment === "practice") {
      // Lenient: show the right sphere and let them carry on (v1). The trial no longer counts as right.
      this.trialErrored = true;
      return { kind: "wrong", error, expected, retry: true };
    }
    this.finishTrial("incorrect", error, now);
    return { kind: "wrong", error, expected, retry: false };
  }

  /** The response window for the next target ran out. */
  timeout(now: number): boolean {
    if (this.phase !== "response" || !this.trial || this.trial.segment === "motor" || this.trial.segment === "practice") return false;
    this.finishTrial("incorrect", "timeout", now);
    return true;
  }

  /** The child opened the rule again ("?"). The window waits while it's open. */
  peek(now: number) {
    if (this.peekStart !== null || this.phase !== "response") return;
    this.peekStart = now;
    this.peeks += 1;
  }

  peekEnd(now: number): number {
    if (this.peekStart === null) return 0;
    const d = now - this.peekStart;
    this.peekMs += d;
    this.peekStart = null;
    return d;
  }

  get peeking(): boolean {
    return this.peekStart !== null;
  }

  private finishTrial(outcome: "correct" | "incorrect", error: ErrorClass | null, now: number) {
    const t = this.trial!;
    if (this.peekStart !== null) this.peekEnd(now);
    this.phase = "feedback";
    if (t.segment === "practice") {
      this.practiceTried += 1;
      if (outcome === "correct") this.practiceRight += 1;
    }
    const rec: TrialRecord = {
      segment: t.segment as TrialRecord["segment"],
      index: t.index,
      block: t.segment === "rules" ? this.block : 0,
      switchTrial: t.switchTrial,
      difficulty: t.difficulty,
      chainLength: t.chain.length,
      correctTaps: t.committed.length,
      longestRun: this.run,
      outcome,
      error,
      firstTapMs: this.firstTapMs,
      gapsMs: this.gaps,
      totalMs: now - this.trialStart,
      rechecks: this.peeks,
      recheckMs: Math.round(this.peekMs),
    };
    this.metrics.addTrial(rec);
  }

  // ---------------------------------------------------------------- next

  /** After a trial's feedback: the next trial, or null when the session's content is done. */
  next(now: number): Trial | null {
    const t = this.trial!;
    const idx = t.index + 1;
    if (t.segment === "practice") return idx < PRACTICE_TRIALS ? this.newTrial(idx, now) : null;
    if (t.segment === "motor") return idx < MOTOR_TRIALS ? this.newTrial(idx, now) : this.startProbe(now);
    if (t.segment === "probe") return idx < PROBE_TRIALS ? this.newTrial(idx, now) : this.startRules(now);
    if (t.segment === "rules") {
      this.ruleTrials += 1;
      this.inBlock += 1;
      if (this.cfg.maxRuleTrials !== null && this.ruleTrials >= this.cfg.maxRuleTrials) {
        this.segment = "done";
        return null;
      }
      if (this.inBlock >= this.blockLength) {
        const old = this.rule!;
        const rule = nextRule(this.history, this.effectiveDifficulty, this.pool, this.cfg.rng);
        this.pendingSwitch = [...(rule.ordering !== old.ordering ? (["ordering"] as const) : []), ...(rule.skip !== old.skip ? (["skip"] as const) : [])];
        this.rule = rule;
        this.history.push(rule);
        this.block += 1;
        this.inBlock = 0;
        this.blockLength = randInt(BLOCK_MIN, BLOCK_MAX, this.cfg.rng);
      }
      return this.newTrial(idx, now);
    }
    return null;
  }

  /** Practice results, for the comprehension gate. */
  get practice() {
    return { tried: this.practiceTried, right: this.practiceRight };
  }
}
