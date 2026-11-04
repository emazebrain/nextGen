/**
 * Peek Peek game flow (design doc §8.4), pure and clock-free: the renderer
 * passes `now` (pause-adjusted ms) into every call.
 *
 * A level: study the board (all pictures shown) → the pictures hide → one round
 * per picture in tray order: find every copy of it. Lives (ADR 0012):
 * - "board" (lives = auto): each board gets its own heart budget; an empty
 *   budget fails the board and a fresh board of the same size follows; after
 *   5 failed attempts the game moves on to the next level.
 * - "session" (lives = N): every wrong tile is reported to Session Rules, which
 *   owns the one session-wide counter. Boards never fail.
 * - "none" (timed): wrong tiles are recorded only.
 */
import { buildBoard, sideOfCell, type Board } from "./board.ts";
import { clamp, computeAward, MAX_LEVEL, type Difficulty } from "./config.ts";
import { PeekPeekMetrics } from "./metrics.ts";

export type LivesModel = "board" | "session" | "none";
export const MAX_ATTEMPTS = 5;

export interface EngineConfig {
  difficulty: Difficulty;
  startLevel: number;
  maxLevel: number;
  lives: LivesModel;
  hemisphere: "left" | "right";
  /** The pack a level uses, and how many pictures it has. */
  packFor: (level: number) => { name: string; size: number };
  /** Session seed: one integer drawn from the host's seeded generator. */
  seed: number;
  /** 2–20 s, or null for the formula. */
  studyOverrideS: number | null;
  /** Even placement everywhere (practice). */
  even?: boolean;
}

export type Phase = "idle" | "study" | "hunt" | "between" | "control" | "done";

export type TapResult =
  | { kind: "ignored" }
  | { kind: "correct"; hex: string; roundDone: boolean; levelDone: boolean; award: number }
  | { kind: "wrong"; hex: string; heartsLeft: number | null; boardFailed: boolean };

export type NextStep = { kind: "board"; board: Board; retry: boolean; skipped: boolean } | { kind: "finished" };

export class PeekPeekEngine {
  readonly metrics = new PeekPeekMetrics();
  readonly maxLevel: number;
  phase: Phase = "idle";
  board: Board | null = null;
  level: number;
  roundIndex = 0;
  /** Tiles already found on this board (they stay open). */
  readonly found = new Set<string>();
  private foundInRound = 0;
  hearts: number | null = null;
  score = 0;
  /** Boards cleared in a row (feeds the score's streak multiplier). */
  streak = 0;
  highestLevel: number;
  private failedAttempts = 0;
  private lastOutcome: "cleared" | "failed" | null = null;
  private huntStart = 0;
  private maxAbs = 1;

  constructor(private readonly cfg: EngineConfig) {
    this.maxLevel = clamp(cfg.maxLevel, 1, MAX_LEVEL);
    this.level = clamp(cfg.startLevel, 1, this.maxLevel);
    this.highestLevel = this.level;
  }

  /** The first board. */
  start(now: number): Board {
    return this.newBoard(this.level, 1, now);
  }

  private newBoard(level: number, attempt: number, now: number, key = ""): Board {
    const pack = this.cfg.packFor(level);
    const b = buildBoard({
      level,
      attempt,
      difficulty: this.cfg.difficulty,
      packSize: pack.size,
      hemisphere: this.cfg.hemisphere,
      seed: key ? hashKey(`${this.cfg.seed}:${key}`) : this.cfg.seed,
      studyOverrideS: this.cfg.studyOverrideS,
      even: key !== "" || this.cfg.even === true,
    });
    this.board = b;
    this.level = level;
    this.highestLevel = Math.max(this.highestLevel, level);
    this.roundIndex = 0;
    this.foundInRound = 0;
    this.found.clear();
    this.hearts = this.cfg.lives === "board" ? b.heartBudget : null;
    this.maxAbs = Math.max(1e-6, ...b.cells.map((c) => Math.abs(c.cx)));
    this.phase = "study";
    if (!key) {
      this.metrics.startLevel(
        { level, boardId: b.boardId, T: b.T, K: b.K, partition: b.partition, realisedAdjacency: b.realisedAdjacency, studySeconds: b.studySeconds, heartBudget: b.heartBudget, isProbe: b.isProbe, pack: pack.name, attempt },
        b.nmap,
        now,
      );
    }
    return b;
  }

  /** The pictures hide: the first round begins. */
  beginHunt(now: number) {
    if (this.phase !== "study" || !this.board) return;
    this.phase = "hunt";
    this.huntStart = now;
    this.startRound(0, now);
  }

  private startRound(index: number, now: number) {
    const b = this.board!;
    this.roundIndex = index;
    this.foundInRound = 0;
    const slot = b.tray[index]!;
    this.metrics.startRound(slot, b.partition[slot]!, b.T - this.found.size, now);
  }

  /** The picture slot the child is looking for now. */
  get target(): number | null {
    return this.board && (this.phase === "hunt" || this.phase === "control") ? this.board.tray[this.roundIndex]! : null;
  }

  get copiesLeft(): number {
    const t = this.target;
    return t === null ? 0 : this.board!.partition[t]! - this.foundInRound;
  }

  /** −1…1 across the board, 0 at its centre (the hemifield reference). */
  xOf(hex: string): number {
    const c = this.board?.cellsById[hex];
    return c ? clamp(c.cx / this.maxAbs, -1, 1) : 0;
  }

  /** One tap on a hidden tile during a memory round. */
  tap(hex: string, now: number, accidental = false): TapResult {
    const b = this.board;
    if (this.phase !== "hunt" || !b || !b.cellsById[hex] || this.found.has(hex)) return { kind: "ignored" };
    const slot = b.tray[this.roundIndex]!;
    const correct = b.assignment[hex] === slot;
    this.metrics.tap(hex, correct, this.xOf(hex), accidental, now);
    if (correct) {
      this.found.add(hex);
      this.foundInRound += 1;
      const roundDone = this.foundInRound >= b.partition[slot]!;
      if (!roundDone) return { kind: "correct", hex, roundDone: false, levelDone: false, award: 0 };
      this.metrics.endRound();
      if (this.roundIndex + 1 < b.K) {
        this.startRound(this.roundIndex + 1, now);
        return { kind: "correct", hex, roundDone: true, levelDone: false, award: 0 };
      }
      const seconds = (now - this.huntStart) / 1000;
      const award = computeAward(b.T, this.cfg.difficulty, seconds, this.streak, this.hearts ?? b.heartBudget, b.heartBudget);
      this.score += award;
      this.streak += 1;
      this.metrics.endLevel(true, null, award, now);
      this.phase = "between";
      this.lastOutcome = "cleared";
      return { kind: "correct", hex, roundDone: true, levelDone: true, award };
    }
    if (this.hearts !== null) {
      this.hearts -= 1;
      if (this.hearts <= 0) {
        this.metrics.endLevel(false, "hearts", 0, now);
        this.streak = 0;
        this.phase = "between";
        this.lastOutcome = "failed";
        return { kind: "wrong", hex, heartsLeft: 0, boardFailed: true };
      }
    }
    return { kind: "wrong", hex, heartsLeft: this.hearts, boardFailed: false };
  }

  /** After a cleared or failed board: the next board, a fresh board of the same size, or the end. */
  next(now: number): NextStep {
    if (this.phase !== "between") return { kind: "finished" };
    if (this.lastOutcome === "failed") {
      this.failedAttempts += 1;
      if (this.failedAttempts < MAX_ATTEMPTS) return { kind: "board", board: this.newBoard(this.level, this.failedAttempts + 1, now), retry: true, skipped: false };
    }
    const skipped = this.lastOutcome === "failed";
    this.failedAttempts = 0;
    if (this.level >= this.maxLevel) {
      this.phase = "done";
      return { kind: "finished" };
    }
    return { kind: "board", board: this.newBoard(this.level + 1, 1, now), retry: false, skipped };
  }

  /** Time up or quit in the middle of a board: the partial level is kept in the results. */
  cutShort(now: number, reason: string) {
    if (this.metrics.inLevel) this.metrics.endLevel(false, reason, 0, now);
    this.phase = "done";
  }

  // ---------------------------------------------------------------- control trial and practice

  /** The control trial: a level-1 board left face up, with even placement. Find every copy of one picture. */
  startControl(now: number): Board {
    const b = this.newBoard(1, 1, now, "control");
    this.phase = "control";
    this.roundIndex = 0;
    this.metrics.startControl(b.partition[b.tray[0]!]!, now);
    return b;
  }

  /** A tap during the control trial. Returns whether the trial is over. */
  controlTap(hex: string, now: number): { correct: boolean; done: boolean } | null {
    const b = this.board;
    if (this.phase !== "control" || !b || !b.cellsById[hex] || this.found.has(hex)) return null;
    const slot = b.tray[0]!;
    const correct = b.assignment[hex] === slot;
    this.metrics.controlTap(correct, this.xOf(hex), now);
    if (correct) {
      this.found.add(hex);
      this.foundInRound += 1;
    }
    const done = this.foundInRound >= b.partition[slot]!;
    if (done) {
      this.metrics.endControl();
      this.phase = "idle";
      this.board = null;
    }
    return { correct, done };
  }

  /** Which side of the board a tile is on (−1, 0, +1). */
  sideOf(hex: string): -1 | 0 | 1 {
    const c = this.board?.cellsById[hex];
    return c ? sideOfCell(c) : 0;
  }
}

function hashKey(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
