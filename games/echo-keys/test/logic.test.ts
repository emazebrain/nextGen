import { describe, expect, it } from "vitest";
import { EchoEngine, PHRASE_FAIL_ERRORS, type EngineConfig } from "../src/engine.ts";
import { probit } from "../src/metrics.ts";
import { DIFFICULTY, fitShift, isBlack, KEYBOARDS, MELODIES, melodiesFor, phrases, type Difficulty } from "../src/music.ts";

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

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({ difficulty: 3, goNoGo: false, lean: null, rng: mulberry32(1), ...extra });

/** Plays perfectly: taps every note exactly on time, leaves balls alone. Returns the engine when the set is done. */
function playPerfect(e: EchoEngine, now = 0, errMs = 0) {
  e.begin(now);
  for (let guard = 0; guard < 200_000 && !e.done; guard++) {
    const due = e.objects.filter((o) => o.kind === "go" && o.result === null).sort((a, b) => a.t - b.t)[0];
    now = due ? Math.max(now, due.t + errMs) : now + 50;
    if (due) e.press(due.key, now);
    e.update(now + 1);
  }
  return e;
}

describe("music", () => {
  it("fits each melody on the keyboards it can, using black keys on the chromatic keyboard", () => {
    expect(melodiesFor(KEYBOARDS[5]).map((m) => m.id).sort()).toEqual(["au_clair", "hot_cross_buns", "mary_lamb", "ode_to_joy"]);
    expect(melodiesFor(KEYBOARDS[8])).toHaveLength(MELODIES.length);
    const chrom = melodiesFor(KEYBOARDS[13]);
    expect(chrom).toHaveLength(MELODIES.length);
    for (const m of chrom) {
      for (const [n] of m.notes) expect(KEYBOARDS[13]).toContain(n);
    }
    // Most melodies move to a key with black notes (Row Your Boat spans the whole octave, so it stays in C).
    expect(chrom.filter((m) => m.notes.some(([n]) => isBlack(n))).length).toBeGreaterThanOrEqual(5);
    expect(fitShift(MELODIES.find((m) => m.id === "twinkle")!, KEYBOARDS[5])).toBeNull();
  });

  it("splits melodies into phrases inside the difficulty's range", () => {
    for (const d of [1, 2, 3, 4, 5] as Difficulty[]) {
      const [lo, hi] = DIFFICULTY[d].phrase;
      for (const m of melodiesFor(KEYBOARDS[DIFFICULTY[d].keys])) {
        const ps = phrases(m, [lo, hi]);
        expect(ps.flat()).toEqual(m.notes);
        if (ps.length > 1) for (const p of ps) expect(p.length).toBeGreaterThanOrEqual(Math.min(lo, m.notes.length));
        for (const p of ps) expect(p.length).toBeLessThanOrEqual(Math.max(hi, Math.ceil(m.notes.length / ps.length)));
      }
    }
  });

  it("computes the normal quantile for d′", () => {
    expect(probit(0.5)).toBeCloseTo(0, 6);
    expect(probit(0.975)).toBeCloseTo(1.959964, 5);
    expect(probit(0.01)).toBeCloseTo(-2.326348, 5);
  });
});

describe("engine", () => {
  it("waits for the first key press, then plays every melody of the set", () => {
    const e = new EchoEngine(cfg());
    expect(e.update(10_000).phraseDone).toBeNull();
    expect(e.objects).toHaveLength(0);
    playPerfect(e);
    expect(e.done).toBe(true);
    const s = e.metrics.summary(false);
    expect(s.melodies_completed).toBe(MELODIES.length);
    expect(s.accuracy).toBe(1);
    expect(s.misses).toBe(0);
    expect(s.timing_error_ms_mean).toBe(0);
    expect(s.best_streak).toBe(s.notes);
  });

  it("judges a tap within ± the hit window as a hit, outside it as a wrong key", () => {
    const e = new EchoEngine(cfg({ difficulty: 1 }));
    e.begin(0);
    const first = e.objects[0]!;
    const w = DIFFICULTY[1].windowMs;
    // Before any note can be tapped, a tap is just a stray tap.
    expect(e.press(first.key, first.t - e.travelMs - w - 30).kind).toBe("idle");
    const r = e.press(first.key, first.t + w - 10);
    expect(r).toMatchObject({ kind: "hit", errMs: w - 10 });
    expect(e.score).toBe(10);
    // The same key again with nothing on it, during the phrase: a wrong note.
    expect(e.press(first.key, first.t + w + 30).kind).toBe("wrong");
    expect(e.metrics.wrongPresses).toBe(1);
  });

  it("counts a note missed when its window passes, and fails a phrase at 3 errors, playing it once more", () => {
    const e = new EchoEngine(cfg({ difficulty: 1 }));
    e.begin(0);
    const firstPhrase = e.objects.filter((o) => o.kind === "go");
    let now = 0;
    let done = null;
    while (!done) {
      now += 50;
      done = e.update(now).phraseDone;
    }
    expect(done.errors).toBe(firstPhrase.length);
    expect(done.errors).toBeGreaterThanOrEqual(PHRASE_FAIL_ERRORS);
    expect(done).toMatchObject({ failed: true, repeat: true, phrase: 0 });
    expect(e.phraseIdx).toBe(0); // the same phrase again
    // Failing it again moves on.
    done = null;
    while (!done) {
      now += 50;
      done = e.update(now).phraseDone;
    }
    expect(done).toMatchObject({ failed: true, repeat: false });
    expect(e.phraseIdx === 1 || e.melodyIdx === 1).toBe(true);
  });

  it("places no-go balls in the gaps, away from notes on the same key, about the difficulty's share", () => {
    for (const d of [1, 3, 5] as Difficulty[]) {
      const e = new EchoEngine(cfg({ difficulty: d, goNoGo: true, rng: mulberry32(d) }));
      let go = 0;
      let nogo = 0;
      e.begin(0);
      let now = 0;
      while (!e.done && now < 2_000_000) {
        for (const o of e.objects) {
          if (o.kind !== "nogo" || (o as { seen?: boolean }).seen) continue;
          (o as { seen?: boolean }).seen = true;
          nogo++;
          for (const g of e.objects) if (g.kind === "go" && g.key === o.key) expect(Math.abs(g.t - o.t)).toBeGreaterThanOrEqual(e.windowMs * 1.5);
        }
        const before = e.objects;
        now += 100;
        const ev = e.update(now);
        if (ev.phraseDone) go += before.filter((o) => o.kind === "go").length;
      }
      const share = nogo / (go + nogo);
      expect(share).toBeGreaterThan(DIFFICULTY[d].nogoRate * 0.4);
      expect(share).toBeLessThan(DIFFICULTY[d].nogoRate * 1.6);
    }
  });

  it("leans no-go balls towards the hemisphere's half of the keyboard", () => {
    const side = (lean: "L" | "R" | null) => {
      let r = 0;
      let n = 0;
      for (let seed = 1; seed <= 6; seed++) {
        const e = new EchoEngine(cfg({ difficulty: 5, goNoGo: true, lean, rng: mulberry32(seed) }));
        e.begin(0);
        let now = 0;
        while (!e.done && now < 2_000_000) {
          for (const o of e.objects) {
            if (o.kind !== "nogo" || (o as { seen?: boolean }).seen) continue;
            (o as { seen?: boolean }).seen = true;
            n++;
            if (o.key >= e.keys.length / 2) r++;
          }
          now += 100;
          e.update(now);
        }
      }
      return r / n;
    };
    expect(side("R")).toBeGreaterThan(0.65);
    expect(side("L")).toBeLessThan(0.35);
  });

  it("scores false alarms and correct rejections, and gives d′", () => {
    const e = new EchoEngine(cfg({ difficulty: 2, goNoGo: true, rng: mulberry32(9) }));
    e.begin(0);
    let now = 0;
    let pressedBall = false;
    while (!e.done && now < 2_000_000) {
      now += 20;
      for (const o of e.objects) {
        if (o.result !== null || Math.abs(now - o.t) > 10) continue;
        if (o.kind === "go") e.press(o.key, now);
        else if (!pressedBall) {
          expect(e.press(o.key, now).kind).toBe("false_alarm");
          pressedBall = true;
        }
      }
      e.update(now);
    }
    const s = e.metrics.summary(true) as unknown as Record<string, number>;
    expect(s.false_alarms).toBe(1);
    expect(s.correct_rejections).toBeGreaterThan(0);
    expect(s.d_prime).toBeGreaterThan(1.5);
  });

  it("is deterministic for a seed", () => {
    const run = () => {
      const e = new EchoEngine(cfg({ goNoGo: true, rng: mulberry32(77) }));
      e.begin(0);
      return JSON.stringify(e.melodies.map((m) => m.id).concat(e.objects.map((o) => `${o.kind}${o.key}@${Math.round(o.t)}`)));
    };
    expect(run()).toBe(run());
  });

  it("practice is the slow scale with no balls and no failures", () => {
    const e = new EchoEngine(cfg({ practice: true, goNoGo: true }));
    expect(e.melodies.map((m) => m.id)).toEqual(["practice"]);
    expect(e.bpm).toBe(50);
    e.begin(0);
    expect(e.objects.every((o) => o.kind === "go")).toBe(true);
    let now = 0;
    let ev;
    do {
      now += 50;
      ev = e.update(now);
    } while (!ev.setDone);
    expect(ev.phraseDone!.failed).toBe(false);
    expect(e.score).toBe(0);
  });
});
