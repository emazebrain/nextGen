import { describe, expect, it } from "vitest";
import { coverage, judge, legMs, roundMs, spotShare, viewAt, type RoundPlan } from "../src/engine.ts";
import { legsFor } from "../src/motion.ts";

const plan = (type: number, over: Partial<RoundPlan> = {}): RoundPlan => ({
  legs: legsFor(type),
  target: 0.6,
  glideMs: 5000,
  sizeShare: 0.2,
  spots: 10,
  dwellMs: 400,
  targetSpot: 6,
  spotStep: 0.08,
  ...over,
});

describe("glide", () => {
  const p = plan(0);
  it("moves at a constant speed from A to B and re-enters at A", () => {
    expect(viewAt(p, 0)).toMatchObject({ leg: 0, kind: "glide", share: 0, visible: true });
    expect(viewAt(p, 2500)!.share).toBeCloseTo(0.5);
    expect(viewAt(p, 5000)).toMatchObject({ leg: 1, share: 0 });
    expect(viewAt(p, 12500)).toMatchObject({ leg: 2 });
    expect(viewAt(p, 15000)).toBeNull();
  });

  it("is on time within 15% of the picture's length, early before and late after", () => {
    // Exactly on the outline at 3000 ms; the zone is ±0.15 × 0.2 × 5000 = ±150 ms.
    expect(judge(p, 3000)).toMatchObject({ cls: "on_time", leg: 1, kind: "glide", errorMs: 0, offset: 0 });
    expect(judge(p, 3000 - 150).cls).toBe("on_time");
    expect(judge(p, 3000 + 150).cls).toBe("on_time");
    const early = judge(p, 3000 - 151);
    expect(early.cls).toBe("early");
    expect(early.errorMs).toBe(-151);
    expect(early.offset).toBeLessThan(-0.15);
    const late = judge(p, 3000 + 400);
    expect(late.cls).toBe("late");
    expect(late.offset).toBeCloseTo(0.4);
  });

  it("judges the same error the same on every leg", () => {
    expect(judge(p, 5000 + 3100)).toMatchObject({ cls: "on_time", leg: 2, errorMs: 100 });
    expect(judge(p, 10000 + 2000)).toMatchObject({ cls: "early", leg: 3, errorMs: -1000 });
  });

  it("is a no-stop once three legs have passed", () => {
    expect(judge(p, 15000)).toMatchObject({ cls: "no_stop", leg: null, share: null });
    expect(roundMs(p)).toBe(15000);
  });

  it("comes back from B on a return leg, reaching the outline from the other side", () => {
    const back = plan(2);
    expect(viewAt(back, 5000)).toMatchObject({ leg: 1, reverse: true, share: 1 });
    // On the way back the outline (at 0.6 from A) is 0.4 of the way: 2000 ms into the leg.
    expect(judge(back, 5000 + 2000)).toMatchObject({ cls: "on_time", leg: 2, errorMs: 0 });
    expect(judge(back, 5000 + 2000)!.share).toBeCloseTo(0.6);
    expect(judge(back, 5000 + 1000).cls).toBe("early");
    expect(judge(back, 5000 + 3000).cls).toBe("late");
  });
});

describe("jump", () => {
  const p = plan(1);
  it("shows the picture on each spot in turn and blinks off between them", () => {
    expect(legMs(p, p.legs[0]!)).toBe(4000);
    expect(viewAt(p, 0)).toMatchObject({ kind: "jump", visible: true });
    expect(viewAt(p, 0)!.share).toBeCloseTo(spotShare(p, 0));
    expect(viewAt(p, 399)!.visible).toBe(false);
    expect(viewAt(p, 400)!.share).toBeCloseTo(spotShare(p, 1));
    expect(viewAt(p, 400)!.visible).toBe(true);
  });

  it("puts one spot exactly on the outline", () => {
    expect(spotShare(p, p.targetSpot)).toBe(p.target);
  });

  it("is on time on the outline's spot, early before it and late after it", () => {
    expect(judge(p, 6 * 400)).toMatchObject({ cls: "on_time", kind: "jump", spotsOff: 0, errorMs: null });
    expect(judge(p, 6 * 400 + 399).cls).toBe("on_time");
    expect(judge(p, 5 * 400 + 399)).toMatchObject({ cls: "early", spotsOff: -1 });
    expect(judge(p, 8 * 400)).toMatchObject({ cls: "late", spotsOff: 2 });
    expect(judge(p, 6 * 400).share).toBe(p.target);
  });

  it("visits the spots in reverse on a return leg", () => {
    const back = plan(5);
    const leg2 = 4000;
    expect(viewAt(back, leg2)!.share).toBeCloseTo(spotShare(back, 9));
    // Spot 6 from A is the 4th visited on the way back (9, 8, 7, 6).
    expect(judge(back, leg2 + 3 * 400)).toMatchObject({ cls: "on_time", leg: 2 });
    expect(judge(back, leg2 + 2 * 400)).toMatchObject({ cls: "early", spotsOff: -1 });
    expect(judge(back, leg2 + 4 * 400)).toMatchObject({ cls: "late", spotsOff: 1 });
  });

  it("mixes kinds per leg for the two-word types", () => {
    const mixed = plan(3);
    expect(viewAt(mixed, 100)!.kind).toBe("glide");
    expect(viewAt(mixed, 5100)).toMatchObject({ kind: "jump", reverse: true });
    expect(viewAt(mixed, 9100)).toMatchObject({ kind: "glide", reverse: false });
    expect(roundMs(mixed)).toBe(14000);
  });
});

describe("coverage", () => {
  const n = 20;
  const square = new Uint8Array(n * n).fill(1);
  it("is 100% when the picture sits on its outline and 85% for a solid shape off by 15%", () => {
    expect(coverage(square, n, 0, 0)).toBe(1);
    expect(coverage(square, n, 0.15, 0)).toBeCloseTo(0.85);
    expect(coverage(square, n, -0.5, 0)).toBeCloseTo(0.5);
    expect(coverage(square, n, 2, 0)).toBe(0);
  });
  it("falls faster for a thin shape, which is why right and wrong go by distance", () => {
    const bar = new Uint8Array(n * n);
    for (let y = 0; y < n; y++) bar[y * n + 10] = 1; // a vertical bar one cell wide
    expect(coverage(bar, n, 0.15, 0)).toBe(0);
    expect(coverage(bar, n, 0, 0.15)).toBeCloseTo(0.85);
  });
  it("is 0 for an empty shape", () => {
    expect(coverage(new Uint8Array(n * n), n, 0, 0)).toBe(0);
  });
});
