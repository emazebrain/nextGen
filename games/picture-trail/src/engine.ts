/**
 * Picture Trail: one round over time (spec 2026-11-10). Pure: the caller passes the time; nothing reads a clock.
 * Question run: each picture shows for `showMs`, then a gap of showMs/4. After the last question picture ALL answer
 * pictures appear at once (with a cue) for ANSWER_SHOW_MS. The child taps the match among the visible pictures;
 * a tap on the wrong picture is wrong (once per picture); the match not tapped within the time is a miss.
 */
import { ANSWER_SHOW_MS, gapMs } from "./config.ts";
import type { Picture } from "./pictures.ts";
import type { Round } from "./rounds.ts";

export type Phase = "question" | "answer";
export type RoundOutcome = "correct" | "commission" | "omission";
export type EngineEvent =
  | { type: "show"; phase: Phase; slot: number; picture: Picture; at: number }
  | { type: "hide"; phase: Phase; slot: number; at: number }
  | { type: "cue"; at: number }
  | { type: "correct"; slot: number; rt: number; at: number }
  | { type: "wrong"; slot: number; at: number }
  | { type: "miss"; at: number }
  | { type: "roundEnd"; outcome: RoundOutcome; rt: number | null; wrongTaps: number; answerShown: number; at: number };

export class TrailEngine {
  private round: Round | null = null;
  private show = 0;
  private phase: Phase = "question";
  private slot = 0;
  private visible = false;
  private nextAt = 0;
  private shownAt = 0;
  private wrongTaps = 0;
  private wrongSlots = new Set<number>();
  private answerShown = 0;
  /** True while all answer pictures are visible at once. */
  private answerAll = false;

  get active(): boolean {
    return this.round !== null;
  }

  startRound(round: Round, showMs: number, now: number): EngineEvent[] {
    this.round = round;
    this.show = showMs;
    this.phase = "question";
    this.slot = 0;
    this.wrongTaps = 0;
    this.wrongSlots.clear();
    this.answerShown = 0;
    this.answerAll = false;
    return [this.showSlot(now)];
  }

  /** Everything due up to `now`, in order. */
  tick(now: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    // Answer-all timeout: all pictures disappear, the round ends.
    if (this.answerAll && this.round && now >= this.nextAt) {
      const at = this.nextAt;
      out.push({ type: "miss", at });
      out.push(this.finish(this.wrongTaps ? "commission" : "omission", null, at));
      return out;
    }
    // Question phase: one picture at a time.
    while (this.round && !this.answerAll && now >= this.nextAt) {
      const at = this.nextAt;
      const r = this.round;
      if (this.visible) {
        this.visible = false;
        out.push({ type: "hide", phase: "question", slot: this.slot, at });
        if (this.slot === r.n - 1) {
          // All question pictures shown → show every answer picture at once.
          this.phase = "answer";
          this.answerAll = true;
          this.shownAt = at;
          this.answerShown = r.n;
          this.nextAt = at + ANSWER_SHOW_MS;
          out.push({ type: "cue", at });
          for (let i = 0; i < r.n; i++) {
            out.push({ type: "show", phase: "answer" as const, slot: i, picture: r.answer[i]!, at });
          }
          break;
        } else {
          this.nextAt = at + gapMs(this.show);
        }
      } else {
        this.slot += 1;
        out.push(this.showSlot(at));
      }
    }
    return out;
  }

  /** A tap during the answer phase. `slot` identifies which picture was tapped. */
  tap(now: number, slot?: number): EngineEvent[] {
    const r = this.round;
    if (!r || this.phase !== "answer" || !this.answerAll) return [];
    const s = slot ?? -1;
    if (s < 0 || s >= r.n) return [];
    if (s === r.matchA) {
      const rt = Math.round(now - this.shownAt);
      return [{ type: "correct", slot: s, rt, at: now }, this.finish("correct", rt, now)];
    }
    if (this.wrongSlots.has(s)) return [];
    this.wrongSlots.add(s);
    this.wrongTaps += 1;
    return [{ type: "wrong", slot: s, at: now }];
  }

  /** The session ended (time or lives): drop the round; nothing more is emitted. */
  stop(): void {
    this.round = null;
    this.visible = false;
    this.answerAll = false;
  }

  private showSlot(at: number): EngineEvent {
    const r = this.round!;
    this.visible = true;
    this.shownAt = at;
    this.nextAt = at + this.show;
    const picture = r.question[this.slot]!;
    return { type: "show", phase: "question", slot: this.slot, picture, at };
  }

  private finish(outcome: RoundOutcome, rt: number | null, at: number): EngineEvent {
    const e: EngineEvent = { type: "roundEnd", outcome, rt, wrongTaps: this.wrongTaps, answerShown: this.answerShown, at };
    this.round = null;
    this.visible = false;
    this.answerAll = false;
    return e;
  }
}
