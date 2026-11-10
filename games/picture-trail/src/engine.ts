/**
 * Picture Trail: one round over time (spec 2026-11-10). Pure: the caller passes the time; nothing reads a clock.
 * Question run: each picture shows for `showMs`, then a gap of showMs/4. After the last question picture the answer run
 * starts at once (with a cue). A tap on the match ends the round; a tap on another picture is wrong (once per picture);
 * the match passing untapped is a miss and the run goes on to its end.
 */
import { gapMs } from "./config.ts";
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
    return [this.showSlot(now)];
  }

  /** Everything due up to `now`, in order. */
  tick(now: number): EngineEvent[] {
    const out: EngineEvent[] = [];
    while (this.round && now >= this.nextAt) {
      const at = this.nextAt;
      const r = this.round;
      if (this.visible) {
        this.visible = false;
        out.push({ type: "hide", phase: this.phase, slot: this.slot, at });
        const last = this.slot === r.n - 1;
        if (this.phase === "answer" && this.slot === r.matchA) out.push({ type: "miss", at });
        if (this.phase === "question" && last) {
          // No pause: the answer run starts straight away, with the cue.
          this.phase = "answer";
          this.slot = 0;
          out.push({ type: "cue", at }, this.showSlot(at));
        } else if (this.phase === "answer" && last) {
          out.push(this.finish(this.wrongTaps ? "commission" : "omission", null, at));
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

  tap(now: number): EngineEvent[] {
    const r = this.round;
    if (!r || this.phase !== "answer" || !this.visible) return [];
    if (this.slot === r.matchA) {
      const rt = Math.round(now - this.shownAt);
      return [{ type: "correct", slot: this.slot, rt, at: now }, this.finish("correct", rt, now)];
    }
    if (this.wrongSlots.has(this.slot)) return [];
    this.wrongSlots.add(this.slot);
    this.wrongTaps += 1;
    return [{ type: "wrong", slot: this.slot, at: now }];
  }

  /** The session ended (time or lives): drop the round; nothing more is emitted. */
  stop(): void {
    this.round = null;
    this.visible = false;
  }

  private showSlot(at: number): EngineEvent {
    const r = this.round!;
    this.visible = true;
    this.shownAt = at;
    this.nextAt = at + this.show;
    if (this.phase === "answer") this.answerShown += 1;
    const picture = (this.phase === "question" ? r.question : r.answer)[this.slot]!;
    return { type: "show", phase: this.phase, slot: this.slot, picture, at };
  }

  private finish(outcome: RoundOutcome, rt: number | null, at: number): EngineEvent {
    const e: EngineEvent = { type: "roundEnd", outcome, rt, wrongTaps: this.wrongTaps, answerShown: this.answerShown, at };
    this.round = null;
    this.visible = false;
    return e;
  }
}
