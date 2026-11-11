import type { BodyPart, Side } from "./assets.ts";
import type { RoundSpec } from "./rounds.ts";

export type Phase = "idle" | "showing" | "waiting" | "feedback" | "done";

export interface RoundRecord {
  bodyPart: BodyPart;
  pose: string;
  correctSide: Side;
  chosenSide: Side | null;
  rotationDeg: number;
  rotationDir: "cw" | "ccw";
  rt_ms: number | null;
  level: number;
  outcome: "correct" | "wrong" | "omission";
}

export type EngineEvent =
  | { type: "show"; spec: RoundSpec; at: number }
  | { type: "ready"; at: number }
  | { type: "correct"; rt: number; at: number }
  | { type: "wrong"; at: number }
  | { type: "timeout"; at: number }
  | { type: "roundEnd"; record: RoundRecord; at: number };

/**
 * Pure, deterministic laterality-discrimination engine.
 *
 * State machine: idle → showing → waiting → feedback → idle
 * All time is passed in as `now`; no Date.now() or setTimeout.
 * Timer starts on imageReady(), never on startRound() (Review Focus #1).
 */
export class LateralityEngine {
  private _phase: Phase = "idle";
  private _active = false;

  private spec: RoundSpec | null = null;
  private level = 0;
  private timeLimitMs = 0;
  private readyAt = 0;
  private deadline = 0;

  get phase(): Phase {
    return this._phase;
  }

  get active(): boolean {
    return this._active;
  }

  /** Begin a new round. Emits "show". */
  startRound(
    spec: RoundSpec,
    level: number,
    timeLimit: number,
    now: number,
  ): EngineEvent[] {
    this.spec = spec;
    this.level = level;
    this.timeLimitMs = timeLimit;
    this._phase = "showing";
    this._active = true;
    this.readyAt = 0;
    this.deadline = 0;

    return [{ type: "show", spec, at: now }];
  }

  /** Image is fully visible — start the hidden per-question timer. */
  imageReady(now: number): EngineEvent[] {
    if (this._phase !== "showing") return [];

    this.readyAt = now;
    this.deadline = now + this.timeLimitMs;
    this._phase = "waiting";

    return [{ type: "ready", at: now }];
  }

  /** Player taps left or right. Only accepted in "waiting" phase. */
  answer(side: Side, now: number): EngineEvent[] {
    if (this._phase !== "waiting" || !this.spec) return [];

    const rt = now - this.readyAt;
    const correct = side === this.spec.correctSide;

    this._phase = "feedback";
    this._active = false;

    const record = this.buildRecord(
      correct ? side : side,
      correct ? "correct" : "wrong",
      rt,
    );

    const events: EngineEvent[] = correct
      ? [{ type: "correct", rt, at: now }]
      : [{ type: "wrong", at: now }];

    events.push({ type: "roundEnd", record, at: now });

    return events;
  }

  /** Called every frame. Checks timeout only in "waiting" phase. */
  tick(now: number): EngineEvent[] {
    if (this._phase !== "waiting" || !this.spec) return [];
    if (now < this.deadline) return [];

    this._phase = "feedback";
    this._active = false;

    const record = this.buildRecord(null, "omission", null);

    return [
      { type: "timeout", at: now },
      { type: "roundEnd", record, at: now },
    ];
  }

  /** Cancel the current round. */
  stop(): void {
    this._phase = "idle";
    this._active = false;
    this.spec = null;
  }

  private buildRecord(
    chosenSide: Side | null,
    outcome: "correct" | "wrong" | "omission",
    rt_ms: number | null,
  ): RoundRecord {
    const s = this.spec!;
    return {
      bodyPart: s.pose.bodyPart,
      pose: s.pose.id,
      correctSide: s.correctSide,
      chosenSide,
      rotationDeg: s.rotationDeg,
      rotationDir: s.rotationDir,
      rt_ms,
      level: this.level,
      outcome,
    };
  }
}
