/**
 * Catch Me If You Can: the rules, with no drawing and no clock (design doc
 * §8.4, v1 CatchMeIfYouCan.jsx). Levels 2–9; level L has L stages. Stage 1
 * shows one L×L board; stages 2…L add a second board of that stage's size on
 * the other side of the midline. The colour difference ΔE shrinks with every
 * stage cleared (×0.95, floor 1.5). A wrong tile reshuffles the stage; in
 * timed mode ΔE also steps back one stage (1-up/1-down staircase).
 */
import { BACKGROUND_COLOURS, deltaE76, hexToLab, oddHex, TILE_COLOURS } from "./colors.ts";

export const LEVEL_MIN = 2;
export const LEVEL_MAX = 9;
export const DELTA_E_START: Record<number, number> = { 1: 30, 2: 24, 3: 19.2, 4: 15.4, 5: 12.3 };
export const DELTA_E_DECAY = 0.95;
export const DELTA_E_FLOOR = 1.5;
export const PRACTICE_DELTA_E = 40;
export const PRACTICE_STAGES = 3;

export type Side = "left" | "right" | "center";
export type Role = "anchor" | "companion";

export interface Board {
  role: Role;
  size: number;
  base: string;
  odd: string;
  oddIndex: number;
  side: Side;
}

export interface Stage {
  level: number;
  stage: number;
  /** Counts every stage cleared since the start (drives ΔE). */
  step: number;
  deltaE: number;
  boards: Board[];
  practice: boolean;
}

export interface PickResult {
  role: Role;
  index: number;
  correct: boolean;
  rtMs: number;
  quadrant: 1 | 2 | 3 | 4;
  hemifield: "L" | "R" | "C";
}

export type Outcome =
  | { kind: "pending"; pick: PickResult }
  | { kind: "correct"; picks: PickResult[] }
  | { kind: "wrong"; picks: PickResult[] };

export interface EngineConfig {
  difficulty: 1 | 2 | 3 | 4 | 5;
  startLevel?: number;
  maxLevel?: number;
  /** Tile colours; "mono" is black and white and always uses lightness-only differences (ADR 0009). */
  palette: "warm" | "cold" | "mono";
  cvdMode?: boolean;
  /** Timed mode: a wrong answer makes the next stage one step easier. */
  staircase?: boolean;
  /**
   * The brain side the step is set to activate (ADR 0011). On two-board stages the larger, anchor board goes
   * on the opposite side of the screen, the visual field that side of the brain sees: left → anchor on the
   * right, right → anchor on the left. The smaller companion board takes the other side.
   */
  hemisphere: "left" | "right";
  rng: () => number;
}

/** Where the anchor board goes on two-board stages: the side of the screen the chosen hemisphere sees. */
export function anchorSideFor(hemisphere: "left" | "right"): "left" | "right" {
  return hemisphere === "left" ? "right" : "left";
}

export function quadrantOf(index: number, size: number): 1 | 2 | 3 | 4 {
  const row = Math.floor(index / size);
  const col = index % size;
  const mid = size / 2;
  return (row < mid ? (col < mid ? 1 : 2) : col < mid ? 3 : 4) as 1 | 2 | 3 | 4;
}

function hemifieldOf(board: Board, index: number): "L" | "R" | "C" {
  if (board.side === "left") return "L";
  if (board.side === "right") return "R";
  const col = index % board.size;
  const mid = (board.size - 1) / 2;
  return col < mid ? "L" : col > mid ? "R" : "C";
}

/** Draws colours without replacement: two boards never share a colour, and no colour repeats from the previous stage. */
class ColourBag {
  private bag: string[] = [];
  private last: string[] = [];
  constructor(
    private readonly band: readonly string[],
    private readonly rng: () => number,
  ) {}
  private shuffle(): string[] {
    const a = [...this.band];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.rng() * (i + 1));
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  }
  draw(n: number): string[] {
    if (this.bag.length < n) {
      let next = this.shuffle();
      for (let tries = 0; tries < 50 && next.slice(0, n).some((c) => this.last.includes(c)); tries++) next = this.shuffle();
      this.bag = next;
    }
    const picked = this.bag.splice(0, n);
    this.last = picked;
    return picked;
  }
}

export class CatchMeEngine {
  readonly startLevel: number;
  readonly maxLevel: number;
  private level: number;
  private stageNo = 1;
  private step = 1;
  private readonly bag: ColourBag;
  private current!: Stage;
  private picks: PickResult[] = [];

  // Running results
  private streak = 0;
  bestStreak = 0;
  score = 0;
  stagesPlayed = 0;
  stagesCleared = 0;
  levelsCompleted = 0;
  highestLevel: number;
  lastFailedDeltaE: number | null = null;
  minClearedDeltaE: number | null = null;
  dualStages = 0;
  anchorFirst = 0;
  readonly allPicks: PickResult[] = [];

  constructor(private readonly cfg: EngineConfig) {
    this.maxLevel = Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, cfg.maxLevel ?? LEVEL_MAX));
    this.startLevel = Math.min(this.maxLevel, Math.max(LEVEL_MIN, cfg.startLevel ?? LEVEL_MIN));
    this.level = this.startLevel;
    this.highestLevel = this.startLevel;
    this.bag = new ColourBag(TILE_COLOURS[cfg.palette], cfg.rng);
  }

  get stage(): Stage {
    return this.current;
  }

  /** The level being played. */
  get currentLevel(): number {
    return this.level;
  }

  /** Whether clearing the current stage completes its level (for the level-up reward). */
  get completesLevel(): boolean {
    return !!this.current && !this.current.practice && this.stageNo >= this.level;
  }

  deltaE(step = this.step): number {
    const start = DELTA_E_START[this.cfg.difficulty] ?? DELTA_E_START[3]!;
    return Math.max(DELTA_E_FLOOR, start * DELTA_E_DECAY ** (step - 1));
  }

  private build(level: number, stage: number, deltaE: number, practice: boolean): Stage {
    const sizes = stage === 1 ? [level] : [level, stage];
    const colours = this.bag.draw(sizes.length);
    // Stage 1 shows the anchor alone, centred; from stage 2 its side follows the chosen hemisphere (ADR 0011).
    const anchorSide: Side = sizes.length === 1 ? "center" : anchorSideFor(this.cfg.hemisphere);
    const boards = sizes.map((size, i): Board => {
      return {
        role: i === 0 ? "anchor" : "companion",
        size,
        base: colours[i]!,
        odd: oddHex(colours[i]!, deltaE, this.cfg.rng, this.cfg.cvdMode || this.cfg.palette === "mono"),
        oddIndex: Math.floor(this.cfg.rng() * size * size),
        side: i === 0 ? anchorSide : anchorSide === "left" ? "right" : "left",
      };
    });
    this.picks = [];
    this.current = { level, stage, step: this.step, deltaE, boards, practice };
    return this.current;
  }

  /** A practice board: easy, unscored, single 2×2 grid. */
  practiceStage(): Stage {
    return this.build(LEVEL_MIN, 1, PRACTICE_DELTA_E, true);
  }

  /** The first scored stage. */
  start(): Stage {
    return this.build(this.level, this.stageNo, this.deltaE(), false);
  }

  /** A tap on a tile. Each board takes one pick; repeat taps on an answered board are ignored (returns null). */
  pick(role: Role, index: number, rtMs: number): Outcome | null {
    const board = this.current.boards.find((b) => b.role === role);
    if (!board || index < 0 || index >= board.size * board.size) return null;
    if (this.picks.some((p) => p.role === role)) return null;
    const pick: PickResult = {
      role,
      index,
      correct: index === board.oddIndex,
      rtMs,
      quadrant: quadrantOf(board.oddIndex, board.size),
      hemifield: hemifieldOf(board, index),
    };
    this.picks.push(pick);
    if (this.picks.length < this.current.boards.length) return { kind: "pending", pick };

    const picks = [...this.picks];
    const correct = picks.every((p) => p.correct);
    if (!this.current.practice) {
      this.allPicks.push(...picks);
      this.stagesPlayed += 1;
      if (this.current.boards.length === 2) {
        this.dualStages += 1;
        if (picks[0]!.role === "anchor") this.anchorFirst += 1;
      }
      if (correct) {
        this.stagesCleared += 1;
        this.score += 100 + this.level * 10 + this.streak * 5;
        this.streak += 1;
        this.bestStreak = Math.max(this.bestStreak, this.streak);
        this.minClearedDeltaE = Math.min(this.minClearedDeltaE ?? Infinity, this.current.deltaE);
      } else {
        this.streak = 0;
        this.lastFailedDeltaE = this.current.deltaE;
      }
    }
    return correct ? { kind: "correct", picks } : { kind: "wrong", picks };
  }

  /**
   * After a correct stage: the next stage, and whether a level was just
   * completed or the last level is done (the session then ends as completed).
   */
  advance(): { stage: Stage | null; levelCompleted: number | null; finished: boolean } {
    if (this.current.practice) return { stage: this.practiceStage(), levelCompleted: null, finished: false };
    this.step += 1;
    if (this.stageNo < this.level) {
      this.stageNo += 1;
      return { stage: this.build(this.level, this.stageNo, this.deltaE(), false), levelCompleted: null, finished: false };
    }
    const done = this.level;
    this.levelsCompleted += 1;
    if (this.level >= this.maxLevel) return { stage: null, levelCompleted: done, finished: true };
    this.level += 1;
    this.highestLevel = Math.max(this.highestLevel, this.level);
    this.stageNo = 1;
    return { stage: this.build(this.level, 1, this.deltaE(), false), levelCompleted: done, finished: false };
  }

  /** After a wrong answer or a timeout: the same stage reshuffled (one step easier in timed mode). */
  retry(): Stage {
    if (this.current.practice) return this.practiceStage();
    if (this.cfg.staircase) this.step = Math.max(1, this.step - 1);
    return this.build(this.level, this.stageNo, this.deltaE(), false);
  }

  /** Records a timed-out stage (trial window ran out) as a failure. */
  timeout(): void {
    if (this.current.practice) return;
    this.stagesPlayed += 1;
    this.streak = 0;
    this.lastFailedDeltaE = this.current.deltaE;
  }

  /** Game-specific metrics for the results envelope (design doc §8.4). */
  metrics(): Record<string, number | string | object | null> {
    const q = [1, 2, 3, 4].map((n) => this.allPicks.filter((p) => p.quadrant === n));
    const acc = (xs: PickResult[]) => (xs.length ? xs.filter((p) => p.correct).length / xs.length : null);
    return {
      score: this.score,
      final_jnd: this.lastFailedDeltaE !== null ? round(this.lastFailedDeltaE) : null,
      min_cleared_delta_e: this.minClearedDeltaE !== null ? round(this.minClearedDeltaE) : null,
      anchor_first_rate: this.dualStages ? round(this.anchorFirst / this.dualStages) : null,
      quadrant_accuracy: { q1: acc(q[0]!), q2: acc(q[1]!), q3: acc(q[2]!), q4: acc(q[3]!) },
      stage_count: this.stagesPlayed,
      stages_cleared: this.stagesCleared,
      best_streak: this.bestStreak,
      levels_completed: this.levelsCompleted,
      highest_level: this.highestLevel,
    };
  }

  /** For tests: the measured difference between a board's colours. */
  static measuredDeltaE(board: Board): number {
    return deltaE76(hexToLab(board.base), hexToLab(board.odd));
  }
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Seeded PRNG (mulberry32), same as the runtime's. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Picks one of `count` items at random, never one of the last `memory` picks
 * (the praise messages, ADR 0009), so the child doesn't see the same words twice in a row.
 */
export class NoRepeatPicker {
  private recent: number[] = [];
  constructor(
    private readonly count: number,
    private readonly rng: () => number,
    private readonly memory = 4,
  ) {}
  next(): number {
    const keep = Math.min(this.memory, this.count - 1);
    const choices = Array.from({ length: this.count }, (_, i) => i).filter((i) => !this.recent.includes(i));
    const pick = choices[Math.floor(this.rng() * choices.length)]!;
    this.recent.push(pick);
    if (this.recent.length > keep) this.recent.shift();
    return pick;
  }
}

export type BackgroundTone = "warm" | "cold" | "mono";

/** The background palette: black and white wins; "auto" follows the hemisphere (left warm, right cold). */
export function backgroundTone(setting: unknown, hemisphere: "left" | "right", monochrome: boolean): BackgroundTone {
  if (monochrome) return "mono";
  if (setting === "warm" || setting === "cold") return setting;
  return hemisphere === "left" ? "warm" : "cold";
}

/** One background colour for the session, drawn with the seeded random generator so a replay looks the same. */
export function pickBackground(tone: BackgroundTone, rng: () => number): string {
  const band = BACKGROUND_COLOURS[tone];
  return band[Math.floor(rng() * band.length)]!;
}
