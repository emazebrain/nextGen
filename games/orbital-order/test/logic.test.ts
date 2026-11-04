import { describe, expect, it } from "vitest";
import { DIFFICULTY, MOTOR_TRIALS, PRACTICE_TRIALS, PROBE_DIFFICULTY, PROBE_TRIALS, TOKENS, type Difficulty } from "../src/config.ts";
import { OrbitalEngine, type EngineConfig } from "../src/engine.ts";
import { OrbitalMetrics, type TrialRecord } from "../src/metrics.ts";
import { classifyTap, colourDistance, makeSpheres, nextRule, sessionPool, solveChain, type Rule } from "../src/rules.ts";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({
  difficulty: 3,
  palette: "cold",
  glyphType: "digits",
  hemisphere: "left",
  motorBaseline: true,
  maxRuleTrials: 24,
  windowOverrideMs: null,
  rng: mulberry32(7),
  ...extra,
});

/** Plays the current trial perfectly (skipping the reveal), returning the time. */
function solve(e: OrbitalEngine, now: number): number {
  const t = e.trial!;
  if (e.phase === "reveal") e.beginResponse(now);
  for (const id of t.chain) {
    now += 400;
    const r = e.tap(id, now);
    if (t.segment === "motor") expect(r.kind).toBe("motor");
    else expect(r.kind).toBe("correct");
  }
  return now;
}

describe("rules", () => {
  it("solves up and down chains without the skip colour", () => {
    const spheres = [
      { id: "a", token: 0, glyph: "5", x: 0.2, y: 0.2 },
      { id: "b", token: 1, glyph: "2", x: 0.4, y: 0.4 },
      { id: "c", token: 2, glyph: "9", x: 0.6, y: 0.6 },
      { id: "d", token: 0, glyph: "3", x: 0.8, y: 0.8 },
    ];
    expect(solveChain({ ordering: "up", skip: 1 }, spheres, "digits")).toEqual(["d", "a", "c"]);
    expect(solveChain({ ordering: "down", skip: 0 }, spheres, "digits")).toEqual(["c", "b"]);
    expect(classifyTap(spheres[1]!, { ordering: "up", skip: 1 })).toBe("inhibition");
    expect(classifyTap(spheres[2]!, { ordering: "up", skip: 1 })).toBe("order");
  });

  it("orders letters alphabetically", () => {
    const spheres = [
      { id: "a", token: 0, glyph: "M", x: 0.3, y: 0.3 },
      { id: "b", token: 0, glyph: "B", x: 0.5, y: 0.5 },
      { id: "c", token: 0, glyph: "Z", x: 0.7, y: 0.7 },
    ];
    expect(solveChain({ ordering: "up", skip: 3 }, spheres, "letters")).toEqual(["b", "a", "c"]);
  });

  it("changes at least one part of the rule (two from difficulty 3) and never repeats the last three", () => {
    const rng = mulberry32(3);
    const pool = [0, 2, 4, 5, 7];
    for (const d of [1, 3, 5] as Difficulty[]) {
      const h: Rule[] = [nextRule([], d, pool, rng)];
      for (let i = 0; i < 200; i++) {
        const r = nextRule(h, d, pool, rng);
        const prev = h[h.length - 1]!;
        const diffs = (r.ordering !== prev.ordering ? 1 : 0) + (r.skip !== prev.skip ? 1 : 0);
        expect(diffs).toBeGreaterThanOrEqual(d >= 3 ? 2 : 1);
        expect(h.slice(-3).some((x) => x.ordering === r.ordering && x.skip === r.skip)).toBe(false);
        expect(pool).toContain(r.skip);
        h.push(r);
      }
    }
  });

  it("picks a session pool of 5 well-separated colours", () => {
    for (const palette of ["warm", "cold"] as const) {
      for (let seed = 1; seed < 30; seed++) {
        const pool = sessionPool(palette, mulberry32(seed));
        expect(new Set(pool).size).toBe(5);
        const fills = pool.map((id) => TOKENS[palette][id]!.fill);
        let min = Infinity;
        for (let i = 0; i < fills.length; i++) for (let j = i + 1; j < fills.length; j++) min = Math.min(min, colourDistance(fills[i]!, fills[j]!));
        // Every pair is a clearly different colour (CIE76 > 10), unlike v1's random 5-of-8.
        expect(min).toBeGreaterThan(10);
      }
    }
  });

  it("makes spheres with unique glyphs and the skip colour in the minority", () => {
    const rng = mulberry32(11);
    const pool = sessionPool("warm", rng);
    for (const d of [1, 2, 3, 4, 5] as Difficulty[]) {
      for (let i = 0; i < 50; i++) {
        const rule = nextRule([], d, pool, rng);
        const s = makeSpheres(rule, { difficulty: d, glyphType: i % 2 ? "letters" : "digits", pool, lean: null, rng });
        expect(s).toHaveLength(DIFFICULTY[d].spheres);
        expect(new Set(s.map((x) => x.glyph)).size).toBe(s.length);
        const skips = s.filter((x) => x.token === rule.skip).length;
        expect(skips).toBeGreaterThanOrEqual(1);
        expect(skips).toBeLessThan(s.length - skips);
        for (const x of s) {
          expect(x.x).toBeGreaterThanOrEqual(0.12);
          expect(x.x).toBeLessThanOrEqual(0.88);
          expect(x.y).toBeGreaterThan(0.08);
          expect(x.y).toBeLessThan(0.92);
        }
      }
    }
  });

  it("leans the first half of the chain towards the hemisphere's side", () => {
    const count = (lean: -1 | 1 | null) => {
      const rng = mulberry32(5);
      const pool = sessionPool("cold", rng);
      let right = 0;
      let all = 0;
      for (let i = 0; i < 400; i++) {
        const rule = nextRule([], 3, pool, rng);
        const s = makeSpheres(rule, { difficulty: 3, glyphType: "digits", pool, lean, rng });
        const chain = solveChain(rule, s, "digits");
        for (const id of chain.slice(0, Math.ceil(chain.length / 2))) {
          all += 1;
          if (s.find((x) => x.id === id)!.x > 0.5) right += 1;
        }
      }
      return right / all;
    };
    expect(count(1)).toBeGreaterThan(0.75);
    expect(count(-1)).toBeLessThan(0.25);
    const even = count(null);
    expect(even).toBeGreaterThan(0.4);
    expect(even).toBeLessThan(0.6);
  });
});

describe("engine flow", () => {
  it("runs practice → motor → probe → rule blocks, with the probe at difficulty 3", () => {
    const e = new OrbitalEngine(cfg({ difficulty: 1 }));
    let now = 0;
    let t = e.startPractice(now);
    for (let i = 0; i < PRACTICE_TRIALS; i++) {
      expect(t.segment).toBe("practice");
      now = solve(e, now);
      const n = e.next(now);
      if (i < PRACTICE_TRIALS - 1) t = n!;
      else expect(n).toBeNull();
    }
    t = e.startScored(now);
    for (let i = 0; i < MOTOR_TRIALS; i++) {
      expect(t.segment).toBe("motor");
      expect(t.chain).toEqual([t.lit]);
      now = solve(e, now);
      t = e.next(now)!;
    }
    for (let i = 0; i < PROBE_TRIALS; i++) {
      expect(t.segment).toBe("probe");
      expect(t.difficulty).toBe(PROBE_DIFFICULTY);
      expect(t.spheres).toHaveLength(DIFFICULTY[3].spheres);
      now = solve(e, now);
      t = e.next(now)!;
    }
    expect(t.segment).toBe("rules");
    expect(t.difficulty).toBe(1);
    expect(e.metrics.motorMs).toHaveLength(MOTOR_TRIALS);
    expect(e.practice).toEqual({ tried: 3, right: 3 });
  });

  it("drops the rule blocks to difficulty 1 when practice is mostly wrong (comprehension gate)", () => {
    const e = new OrbitalEngine(cfg({ difficulty: 4, motorBaseline: false }));
    let now = 0;
    e.startPractice(now);
    for (let i = 0; i < PRACTICE_TRIALS; i++) {
      const t = e.trial!;
      e.beginResponse(now);
      // A wrong first tap (in practice the child carries on), then the right chain.
      const wrong = t.spheres.find((s) => s.id !== t.chain[0])!;
      const r = e.tap(wrong.id, (now += 300));
      expect(r.kind).toBe("wrong");
      if (r.kind === "wrong") expect(r.retry).toBe(true);
      for (const id of t.chain) e.tap(id, (now += 300));
      e.next(now);
    }
    expect(e.practice).toEqual({ tried: 3, right: 0 });
    let t = e.startScored(now);
    expect(t.segment).toBe("probe");
    while (t.segment === "probe") {
      now = solve(e, now);
      t = e.next(now)!;
    }
    expect(t.difficulty).toBe(1);
    expect(e.metrics.summary().comprehension_gate).toBe("failed");
  });

  it("ends a scored trial on a wrong tap and classifies it", () => {
    const e = new OrbitalEngine(cfg({ motorBaseline: false }));
    const t = e.startScored(0);
    e.beginResponse(0);
    const skip = t.spheres.find((s) => s.token === t.rule!.skip)!;
    const r = e.tap(skip.id, 500);
    expect(r).toMatchObject({ kind: "wrong", error: "inhibition", retry: false, expected: t.chain[0] });
    expect(e.phase).toBe("feedback");
    expect(e.tap(t.chain[0]!, 600).kind).toBe("ignored");
    expect(e.metrics.trials.at(-1)).toMatchObject({ segment: "probe", outcome: "incorrect", error: "inhibition", correctTaps: 0 });
  });

  it("times out only in scored segments", () => {
    const e = new OrbitalEngine(cfg({ motorBaseline: false }));
    e.startPractice(0);
    e.beginResponse(0);
    expect(e.timeout(9000)).toBe(false);
    const f = new OrbitalEngine(cfg({ motorBaseline: false }));
    const t = f.startScored(0);
    expect(f.timeout(10)).toBe(false); // still revealing the rule
    f.beginResponse(100);
    f.tap(t.chain[0]!, 400);
    expect(f.timeout(5000)).toBe(true);
    expect(f.metrics.trials.at(-1)).toMatchObject({ error: "timeout", correctTaps: 1, longestRun: 1 });
  });

  it("uses the difficulty window unless trial_window_ms overrides it", () => {
    const e = new OrbitalEngine(cfg({ difficulty: 5, motorBaseline: false }));
    e.startScored(0);
    expect(e.windowMs).toBe(DIFFICULTY[PROBE_DIFFICULTY].windowMs);
    const f = new OrbitalEngine(cfg({ difficulty: 5, motorBaseline: false, windowOverrideMs: 8000 }));
    f.startScored(0);
    expect(f.windowMs).toBe(8000);
  });

  it("scores 10 per correct tap plus 25 per chain, only in scored segments", () => {
    const e = new OrbitalEngine(cfg({ motorBaseline: false }));
    e.startPractice(0);
    solve(e, 0);
    expect(e.score).toBe(0);
    const t = e.startScored(0);
    solve(e, 0);
    expect(e.score).toBe(t.chain.length * 10 + 25);
  });

  it("switches the rule every 5–8 trials and flags switch trials", () => {
    const e = new OrbitalEngine(cfg({ motorBaseline: false, maxRuleTrials: null }));
    let now = 0;
    let t = e.startScored(now);
    while (t.segment !== "rules") {
      now = solve(e, now);
      t = e.next(now)!;
    }
    const runs: number[] = [];
    let run = 1;
    let prev = t.rule!;
    for (let i = 0; i < 80; i++) {
      now = solve(e, now);
      t = e.next(now)!;
      const changed = t.rule!.ordering !== prev.ordering || t.rule!.skip !== prev.skip;
      expect(t.switchTrial).toBe(changed);
      if (changed) {
        expect(t.changed.length).toBeGreaterThanOrEqual(2); // difficulty 3: both parts change
        runs.push(run);
        run = 1;
      } else run += 1;
      prev = t.rule!;
    }
    expect(runs.length).toBeGreaterThan(5);
    for (const r of runs) {
      expect(r).toBeGreaterThanOrEqual(5);
      expect(r).toBeLessThanOrEqual(8);
    }
  });

  it("stops after max_rule_trials in lives mode (trial_cap) and never in timed modes", () => {
    const play = (cap: number | null, limit: number) => {
      const e = new OrbitalEngine(cfg({ motorBaseline: false, maxRuleTrials: cap }));
      let now = 0;
      let t: ReturnType<typeof e.next> = e.startScored(now);
      let n = 0;
      while (t && n < limit) {
        now = solve(e, now);
        t = e.next(now);
        n += 1;
      }
      return { e, t };
    };
    const capped = play(10, 1000);
    expect(capped.t).toBeNull();
    expect(capped.e.ruleTrials).toBe(10);
    expect(capped.e.segment).toBe("done");
    const timed = play(null, 200);
    expect(timed.t).not.toBeNull();
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const e = new OrbitalEngine(cfg({ rng: mulberry32(99) }));
      e.startPractice(0);
      return JSON.stringify([e.pool, e.trial!.spheres, e.trial!.rule]);
    };
    expect(run()).toBe(run());
  });

  it("counts rule rechecks and their time", () => {
    const e = new OrbitalEngine(cfg({ motorBaseline: false }));
    const t = e.startScored(0);
    e.beginResponse(0);
    e.peek(100);
    expect(e.peeking).toBe(true);
    expect(e.peekEnd(1700)).toBe(1600);
    for (const id of t.chain) e.tap(id, 2000);
    expect(e.metrics.trials.at(-1)).toMatchObject({ rechecks: 1, recheckMs: 1600 });
  });
});

describe("metrics", () => {
  const rec = (x: Partial<TrialRecord>): TrialRecord => ({
    segment: "rules",
    index: 0,
    block: 1,
    switchTrial: false,
    difficulty: 3,
    chainLength: 4,
    correctTaps: 4,
    longestRun: 4,
    outcome: "correct",
    error: null,
    firstTapMs: 1000,
    gapsMs: [500, 500, 500],
    totalMs: 3000,
    rechecks: 0,
    recheckMs: 0,
    ...x,
  });

  it("counts partial chains in max_chain (v1 counted only finished ones)", () => {
    const m = new OrbitalMetrics();
    m.addTrial(rec({ chainLength: 7, correctTaps: 6, longestRun: 6, outcome: "incorrect", error: "order" }));
    m.addTrial(rec({ chainLength: 3, correctTaps: 3, longestRun: 3 }));
    expect(m.summary().max_chain).toBe(6);
  });

  it("leaves practice out of the scored measures", () => {
    const m = new OrbitalMetrics();
    m.addTrial(rec({ segment: "practice", outcome: "incorrect", error: "order", firstTapMs: 99999 }));
    m.addTrial(rec({}));
    const s = m.summary();
    expect(s.trials_offered).toBe(1);
    expect(s.chain_completion_rate).toBe(1);
    expect(s.first_tap_latency_ms).toBe(1000);
    expect(s.inhibition_index).toBeNull();
  });

  it("computes planning ratio, switch cost, error shares and probe accuracy", () => {
    const m = new OrbitalMetrics();
    m.addTrial(rec({ segment: "probe", outcome: "incorrect", error: "inhibition", correctTaps: 1, longestRun: 1 }));
    m.addTrial(rec({ segment: "probe" }));
    m.addTrial(rec({ firstTapMs: 1000 }));
    m.addTrial(rec({ switchTrial: true, firstTapMs: 1600 }));
    m.addTrial(rec({ outcome: "incorrect", error: "order" }));
    m.addTrial(rec({ outcome: "incorrect", error: "timeout" }));
    m.motorTap(300);
    m.motorTap(500);
    m.motorTap(400);
    const s = m.summary();
    expect(s.probe_accuracy).toBe(0.5);
    expect(s.planning_ratio).toBe(r3((1000 * 5 + 1600) / 6 / 500));
    expect(s.rule_switch_cost_ms).toBe(600);
    expect(s.inhibition_index).toBe(r3(1 / 3));
    expect(s.order_error_share).toBe(r3(1 / 3));
    expect(s.timeout_share).toBe(r3(1 / 3));
    expect(s.baseline_tap_latency_ms).toBe(400);
    expect(s.best_streak).toBe(3);
    expect(s.comprehension_gate).toBe("skipped");
  });
});

const r3 = (n: number) => Math.round(n * 1000) / 1000;
