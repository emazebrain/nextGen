/** Picture Trail: one round over time, and the session metrics (spec 2026-11-10). */
import { describe, expect, it } from "vitest";
import { TrailEngine, type EngineEvent } from "../src/engine.ts";
import { computeMetrics, type RoundRecord } from "../src/metrics.ts";
import type { Round } from "../src/rounds.ts";
import { picturesFor } from "../src/rounds.ts";

const P = picturesFor("4-6");
// question A B C; answer D B E (match B: question slot 1, answer slot 1)
const round: Round = { direction: "ltr", target: undefined, n: 3, question: [P[0]!, P[1]!, P[2]!], answer: [P[3]!, P[1]!, P[4]!], matchQ: 1, matchA: 1, lure: false };
const SHOW = 1000;
const GAP = 250;
const kinds = (es: EngineEvent[]) => es.map((e) => (e.type === "show" || e.type === "hide" ? `${e.type}:${e.phase}:${e.slot}` : e.type));

describe("TrailEngine", () => {
  it("shows the question run one picture at a time, then the answer run with no pause", () => {
    const e = new TrailEngine();
    expect(kinds(e.startRound(round, SHOW, 0))).toEqual(["show:question:0"]);
    expect(kinds(e.tick(999))).toEqual([]);
    expect(kinds(e.tick(1000))).toEqual(["hide:question:0"]);
    expect(kinds(e.tick(1250))).toEqual(["show:question:1"]);
    expect(kinds(e.tick(3500))).toEqual(["hide:question:1", "show:question:2", "hide:question:2", "cue", "show:answer:0"]);
  });

  it("a tap on the match ends the round as correct, with the time since the match appeared", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    e.tick(3500); // answer 0 showing since 3500
    e.tick(4750); // answer 1 (the match) shows at 4750
    const out = e.tap(5050);
    expect(kinds(out)).toEqual(["correct", "roundEnd"]);
    expect(out.find((x) => x.type === "roundEnd")).toMatchObject({ outcome: "correct", rt: 300, wrongTaps: 0, answerShown: 2 });
    expect(e.tick(9000)).toEqual([]);
  });

  it("wrong taps then the match: a life per wrong picture, the run goes on, and it still counts as correct", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    e.tick(3500);
    expect(kinds(e.tap(3600))).toEqual(["wrong"]);
    expect(kinds(e.tap(3700))).toEqual([]); // one life per picture, however many taps
    e.tick(4750);
    const out = e.tap(4800);
    expect(out.find((x) => x.type === "roundEnd")).toMatchObject({ outcome: "correct", wrongTaps: 1 });
  });

  it("the match passing untapped is a miss; the round ends when the run ends", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    e.tick(3500);
    expect(kinds(e.tick(5750))).toEqual(["hide:answer:0", "show:answer:1", "hide:answer:1", "miss"]);
    const end = e.tick(7000);
    expect(kinds(end)).toEqual(["show:answer:2", "hide:answer:2", "roundEnd"]);
    expect(end.at(-1)).toMatchObject({ outcome: "omission", rt: null, wrongTaps: 0, answerShown: 3 });
  });

  it("a wrong tap and no match is a commission", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    e.tick(3500);
    e.tap(3600);
    expect(e.tick(7000).at(-1)).toMatchObject({ outcome: "commission", wrongTaps: 1 });
  });

  it("taps between pictures and during the question run are ignored", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    expect(e.tap(500)).toEqual([]); // question run
    e.tick(4500);
    expect(e.tap(4600)).toEqual([]); // the gap after answer 0
  });

  it("ends mid-round cleanly", () => {
    const e = new TrailEngine();
    e.startRound(round, SHOW, 0);
    e.tick(3600);
    e.stop();
    expect(e.tick(9000)).toEqual([]);
    expect(e.tap(9001)).toEqual([]);
    expect(e.active).toBe(false);
  });
});

describe("computeMetrics", () => {
  const r = (level: number, n: number, outcome: RoundRecord["outcome"], rt: number | null, wrongTaps = 0): RoundRecord => ({ level, n, outcome, rt, wrongTaps, answerShown: n });
  it("summarises the rounds", () => {
    const rounds = [r(1, 3, "correct", 400), r(1, 3, "correct", 600), r(2, 3, "omission", null), r(2, 3, "commission", null, 2), r(7, 4, "correct", 500, 1), r(7, 4, "correct", 900), r(7, 4, "correct", 700)];
    expect(computeMetrics(rounds)).toEqual({
      rounds: 7,
      accuracy: 5 / 7,
      miss_rate: 1 / 7,
      wrong_tap_rate: 3 / 24,
      rt_correct_ms: 600,
      span: 4,
      best_streak: 3,
      highest_level: 7,
    });
  });
  it("is all zero with no rounds", () => {
    expect(computeMetrics([])).toEqual({ rounds: 0, accuracy: 0, miss_rate: 0, wrong_tap_rate: 0, rt_correct_ms: 0, span: 0, best_streak: 0, highest_level: 0 });
  });
});
