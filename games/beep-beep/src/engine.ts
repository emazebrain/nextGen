/**
 * Beep Beep flow (ported from v1 `BeepBeep.jsx`), pure: the renderer passes `now` (pause-adjusted ms) into every
 * call. One board at a time: moves, undo/redo, reset, the four-step hint ladder, the move budget, and the next
 * board when one is cleared or failed.
 *
 * Fixed from v1 (ADR 0015): a replacement board after a failure is recorded as its own attempt with its own
 * shortest solution and budget (v1 kept the failed board's numbers); moves made before a reset still count in
 * the move-quality measures (v1 dropped them).
 */
import { apply, bestMove, blockersToExit, classify, distance, isGoal, slideRange, solve, type Board, type Move, type MoveClass, type Solution, type State } from "./board.ts";
import { awardFor, boardFor, bucket, budgetFor, MAX_LEVEL, type Difficulty } from "./levels.ts";
import { BeepMetrics } from "./metrics.ts";

export interface EngineConfig {
  pack: Board[];
  difficulty: Difficulty;
  startLevel: number;
  maxLevel: number;
  /** Lives modes: going over the move budget fails the board. Timed mode only counts moves (v1 lives = 0). */
  enforceBudget: boolean;
  rng: () => number;
}

export type MoveResult =
  | { kind: "ignored" }
  | { kind: "moved"; cls: MoveClass; solved: boolean; overBudget: boolean };

export class BeepEngine {
  readonly metrics = new BeepMetrics();
  board!: Board;
  sol: Solution | null = null;
  state!: State;
  level: number;
  moveCount = 0;
  budget = 0;
  streak = 0;
  score = 0;
  hintRung = 0;
  solved = false;
  failed = false;
  /** Whether going over the budget fails the board (off in timed mode and during practice). */
  budgetOn: boolean;
  private undoStack: Move[] = [];
  private redoStack: Move[] = [];
  private dist = Infinity;
  private seen = new Set<string>();
  private boardStart = 0;

  constructor(private readonly cfg: EngineConfig) {
    this.level = Math.max(1, Math.min(cfg.maxLevel, cfg.startLevel));
    this.budgetOn = cfg.enforceBudget;
  }

  get maxLevel() {
    return Math.min(MAX_LEVEL, this.cfg.maxLevel);
  }
  get canUndo() {
    return this.undoStack.length > 0 && !this.solved && !this.failed;
  }
  get canRedo() {
    return this.redoStack.length > 0 && !this.solved && !this.failed;
  }
  get distance() {
    return this.dist;
  }

  /** The first board of the session (or of the current level after a clear). */
  startLevel(now: number): Board {
    this.seen.clear();
    return this.load(boardFor(this.cfg.pack, this.level, this.cfg.difficulty, this.cfg.rng, this.seen), now, false);
  }

  /** A specific board (practice). */
  load(b: Board, now: number, replacement: boolean): Board {
    this.board = b;
    this.seen.add(b.id);
    this.sol = solve(b);
    this.state = b.start.slice();
    this.dist = distance(this.sol, this.state);
    this.moveCount = 0;
    this.budget = budgetFor(b.optimal, this.cfg.difficulty);
    this.undoStack = [];
    this.redoStack = [];
    this.hintRung = 0;
    this.solved = false;
    this.failed = false;
    this.boardStart = now;
    this.metrics.startBoard({ level: this.level, board: b, budget: this.budget, replacement, now });
    return b;
  }

  range(idx: number) {
    return slideRange(this.board, this.state, idx);
  }

  move(idx: number, to: number, now: number, viaHint = false): MoveResult {
    if (this.solved || this.failed) return { kind: "ignored" };
    const from = this.state[idx]!;
    const { min, max } = this.range(idx);
    if (to === from || to < min || to > max) return { kind: "ignored" };
    const next = apply(this.state, { idx, from, to });
    const after = distance(this.sol, next);
    const cls = classify(this.dist, after);
    this.metrics.move({ idx, from, to, cls, now, viaHint });
    this.state = next;
    this.dist = after;
    this.moveCount += 1;
    this.undoStack.push({ idx, from, to });
    this.redoStack = [];
    this.hintRung = 0;
    if (isGoal(this.board, this.state)) {
      this.solved = true;
      const seconds = (now - this.boardStart) / 1000;
      const award = awardFor(this.board.n, this.cfg.difficulty, seconds, this.streak, this.board.optimal, this.moveCount);
      this.score += award;
      this.streak += 1;
      this.metrics.endBoard({ completed: true, failReason: null, score: award, movesUsed: this.moveCount, now });
      return { kind: "moved", cls, solved: true, overBudget: false };
    }
    const overBudget = this.budgetOn && this.moveCount >= this.budget;
    if (overBudget) this.fail("budget", now);
    return { kind: "moved", cls, solved: false, overBudget };
  }

  undo(now: number): boolean {
    if (!this.canUndo) return false;
    const m = this.undoStack.pop()!;
    this.state = apply(this.state, { idx: m.idx, from: m.to, to: m.from });
    this.dist = distance(this.sol, this.state);
    this.redoStack.push(m);
    this.moveCount = Math.max(0, this.moveCount - 1);
    this.hintRung = 0;
    this.metrics.undo(now);
    return true;
  }

  redo(now: number): MoveResult {
    if (!this.canRedo) return { kind: "ignored" };
    const m = this.redoStack.pop()!;
    const keep = this.redoStack;
    const r = this.move(m.idx, m.to, now);
    this.redoStack = keep; // a redo keeps the rest of the redo trail
    this.metrics.redo();
    return r;
  }

  reset(now: number): boolean {
    if (this.solved || this.failed || (this.moveCount === 0 && !this.undoStack.length)) return false;
    this.state = this.board.start.slice();
    this.dist = distance(this.sol, this.state);
    this.moveCount = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.hintRung = 0;
    this.metrics.reset(now);
    return true;
  }

  /** The next step of the hint ladder (v1): 1 blockers, 2 the piece to move, 3 where it goes, 4 make the move. */
  hint(now: number): { rung: number; blockers: Set<number>; move: Move | null; result?: MoveResult } {
    if (this.solved || this.failed) return { rung: 0, blockers: new Set(), move: null };
    const move = bestMove(this.board, this.sol, this.state);
    this.hintRung = Math.min(4, this.hintRung + 1);
    this.metrics.hint(this.hintRung);
    if (this.hintRung === 4 && move) {
      const result = this.move(move.idx, move.to, now, true);
      return { rung: 4, blockers: new Set(), move, result };
    }
    return { rung: this.hintRung, blockers: blockersToExit(this.board, this.state), move };
  }

  blockers(): Set<number> {
    return blockersToExit(this.board, this.state);
  }

  bestMove(): Move | null {
    return bestMove(this.board, this.sol, this.state);
  }

  /** The board failed: over the move budget, or out of time when a time limit is set. */
  fail(reason: "budget" | "time", now: number) {
    if (this.solved || this.failed) return;
    this.failed = true;
    this.streak = 0;
    this.metrics.endBoard({ completed: false, failReason: reason, score: 0, movesUsed: this.moveCount, now });
  }

  /** A fresh board of the same size and depth after a failure (v1 `findReplacement`). */
  replacement(now: number): Board {
    const list = bucket(this.cfg.pack, this.board.n, this.board.optimal);
    const fresh = list.filter((b) => !this.seen.has(b.id));
    const from = fresh.length ? fresh : list.filter((b) => b.id !== this.board.id);
    const b = from.length ? from[Math.floor(this.cfg.rng() * from.length)]! : this.board;
    return this.load(b, now, true);
  }

  /** After a cleared board: the next level, or null when the last level is done. */
  nextLevel(now: number): Board | null {
    if (this.level >= this.maxLevel) return null;
    this.level += 1;
    return this.startLevel(now);
  }

  /** Board time so far (for a time limit). */
  elapsed(now: number) {
    return now - this.boardStart;
  }
}
