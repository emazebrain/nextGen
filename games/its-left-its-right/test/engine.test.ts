import { describe, expect, it } from "vitest";
import { LateralityEngine, type EngineEvent, type RoundRecord } from "../src/engine.ts";
import type { RoundSpec } from "../src/rounds.ts";

const spec: RoundSpec = {
  pose: { id: "thumbsup", bodyPart: "hand", minBand: "4-6", svgFile: "hand-thumbsup-r.svg", canFlip: true },
  side: "left",
  rotationDeg: 30,
  rotationDir: "cw",
  correctSide: "left",
};
const kinds = (es: EngineEvent[]) => es.map(e => e.type);

describe("LateralityEngine", () => {
  it("startRound emits show; imageReady emits ready and starts the timer", () => {
    const e = new LateralityEngine();
    expect(kinds(e.startRound(spec, 5, 8000, 0))).toEqual(["show"]);
    expect(e.phase).toBe("showing");
    expect(kinds(e.imageReady(500))).toEqual(["ready"]);
    expect(e.phase).toBe("waiting");
  });

  it("correct answer emits correct + roundEnd with RT", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    const out = e.answer("left", 1200);
    expect(kinds(out)).toEqual(["correct", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.rt_ms).toBe(700); // 1200 - 500
    expect(rec.outcome).toBe("correct");
    expect(rec.correctSide).toBe("left");
    expect(rec.chosenSide).toBe("left");
  });

  it("wrong answer emits wrong + roundEnd", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    const out = e.answer("right", 1200);
    expect(kinds(out)).toEqual(["wrong", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.outcome).toBe("wrong");
    expect(rec.chosenSide).toBe("right");
  });

  it("timeout emits timeout + roundEnd when hidden timer expires", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    expect(kinds(e.tick(8499))).toEqual([]); // not yet
    const out = e.tick(8500); // 500 + 8000
    expect(kinds(out)).toEqual(["timeout", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.outcome).toBe("omission");
    expect(rec.rt_ms).toBeNull();
    expect(rec.chosenSide).toBeNull();
  });

  it("tick before imageReady never fires timeout (Review Focus #1)", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    // imageReady not called yet — engine is in "showing" phase
    expect(kinds(e.tick(20000))).toEqual([]);
    expect(e.phase).toBe("showing");
  });

  it("answer during showing phase is ignored", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    expect(e.answer("left", 100)).toEqual([]);
  });

  it("stop() cancels the round", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    e.stop();
    expect(e.active).toBe(false);
    expect(e.tick(20000)).toEqual([]);
  });

  it("roundEnd record has all fields from spec", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 12, 5000, 0);
    e.imageReady(100);
    const out = e.answer("left", 600);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.bodyPart).toBe("hand");
    expect(rec.pose).toBe("thumbsup");
    expect(rec.rotationDeg).toBe(30);
    expect(rec.rotationDir).toBe("cw");
    expect(rec.level).toBe(12);
  });
});
