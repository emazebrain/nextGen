import { describe, expect, it } from "vitest";
import { biasFor, buildBoard, buildCells, neighbourMap, sideOfCell } from "../src/board.ts";
import { BOARDS, boardForLevel, computeAward, copyPartition, heartBudgetFor, kForLevel, PROBE_LEVELS, studySeconds, type Difficulty } from "../src/config.ts";
import { MAX_ATTEMPTS, PeekPeekEngine, type EngineConfig } from "../src/engine.ts";
import { V1_AWARDS, V1_LEVELS } from "./v1-fixture.ts";

const cfg = (extra: Partial<EngineConfig> = {}): EngineConfig => ({
  difficulty: 3,
  startLevel: 1,
  maxLevel: 50,
  lives: "board",
  hemisphere: "left",
  packFor: () => ({ name: "marine", size: 14 }),
  seed: 42,
  studyOverrideS: null,
  ...extra,
});

/** Taps every copy of the current picture until the level is done. */
function clearBoard(e: PeekPeekEngine, now = 1000) {
  e.beginHunt(now);
  let last = null;
  while (e.phase === "hunt") {
    const slot = e.target!;
    const hex = e.board!.cells.find((c) => e.board!.assignment[c.id] === slot && !e.found.has(c.id))!.id;
    last = e.tap(hex, (now += 400));
  }
  return last;
}
const wrongHex = (e: PeekPeekEngine) => e.board!.cells.find((c) => e.board!.assignment[c.id] !== e.target && !e.found.has(c.id))!.id;

describe("progression matches v1", () => {
  it("K, copy partition and heart budget for every level and difficulty", () => {
    for (const [d, L, T, K, part, budget] of V1_LEVELS) {
      const dd = d as Difficulty;
      expect(boardForLevel(L).T).toBe(T);
      expect(kForLevel(L, dd, 14)).toBe(K);
      const p = copyPartition(T, K, L, dd);
      expect(p.join(".")).toBe(part);
      expect(p.reduce((a, b) => a + b, 0)).toBe(T);
      expect(heartBudgetFor(dd, p)).toBe(budget);
    }
  });

  it("study time follows the formula (v1 computed it but always used 3 s)", () => {
    for (const [, L, , , , , s] of V1_LEVELS) expect(studySeconds(L)).toBe(s);
    expect(studySeconds(1)).toBe(3);
    expect(studySeconds(6)).toBe(4); // relief level: 3.5 + 0.5
    expect(studySeconds(50)).toBe(9.5);
  });

  it("scores like v1", () => {
    expect([computeAward(19, 3, 42.5, 4, 5, 7), computeAward(7, 1, 10, 0, 3, 3), computeAward(35, 5, 200, 12, 1, 9)]).toEqual(V1_AWARDS);
  });
});

describe("boards", () => {
  it("interlock boards are mirror-symmetric hex tilings; every cell has 2–6 neighbours", () => {
    for (const shape of BOARDS) {
      const cells = buildCells(shape.rows, shape.family);
      const nmap = neighbourMap(cells);
      expect(cells).toHaveLength(shape.T);
      for (const c of cells) expect(nmap[c.id]!.length).toBeGreaterThanOrEqual(2);
      for (const c of cells) expect(nmap[c.id]!.length).toBeLessThanOrEqual(6);
      if (shape.family === "interlock") {
        for (const c of cells) expect(cells.some((m) => Math.abs(m.cx + c.cx) < 1e-6 && Math.abs(m.cy - c.cy) < 1e-6)).toBe(true);
      }
      const xs = cells.map((c) => c.cx);
      expect(Math.abs(Math.min(...xs) + Math.max(...xs))).toBeLessThan(1e-6); // centred
    }
  });

  it("places every copy, is replayable from the seed, and a retry gets a fresh placement", () => {
    const o = { level: 9, attempt: 1, difficulty: 3 as const, packSize: 14, hemisphere: "left" as const, seed: 7, studyOverrideS: null };
    const a = buildBoard(o);
    expect(buildBoard(o)).toEqual(a);
    expect(Object.keys(a.assignment)).toHaveLength(a.T);
    for (let slot = 0; slot < a.K; slot++) expect(Object.values(a.assignment).filter((v) => v === slot)).toHaveLength(a.partition[slot]!);
    expect(new Set(a.pictureIds).size).toBe(a.K);
    expect(buildBoard({ ...o, attempt: 2 }).assignment).not.toEqual(a.assignment);
  });

  it("the first pictures asked for lean towards the side the hemisphere sees; probe levels stay even", () => {
    expect(biasFor("left").early).toBe(1);
    expect(biasFor("right").early).toBe(-1);
    for (const hemisphere of ["left", "right"] as const) {
      let toward = 0;
      let away = 0;
      for (let seed = 1; seed <= 60; seed++) {
        const b = buildBoard({ level: 26, attempt: 1, difficulty: 3, packSize: 14, hemisphere, seed, studyOverrideS: null });
        expect(b.isProbe).toBe(false);
        const early = new Set(b.tray.slice(0, Math.ceil(b.K / 2)));
        for (const c of b.cells) {
          if (!early.has(b.assignment[c.id]!)) continue;
          const s = sideOfCell(c);
          if (s === biasFor(hemisphere).early) toward++;
          else if (s !== 0) away++;
        }
      }
      expect(toward / (toward + away)).toBeGreaterThan(0.6);
    }
    for (const L of PROBE_LEVELS) {
      const b = buildBoard({ level: L, attempt: 1, difficulty: 3, packSize: 14, hemisphere: "left", seed: 3, studyOverrideS: null });
      expect(b.isProbe).toBe(boardForLevel(L).family === "interlock");
    }
  });

  it("uses the study-time override when given", () => {
    expect(buildBoard({ level: 30, attempt: 1, difficulty: 3, packSize: 14, hemisphere: "left", seed: 1, studyOverrideS: 4 }).studySeconds).toBe(4);
  });
});

describe("game flow", () => {
  it("study → find each picture's copies in tray order → next level, with a score", () => {
    const e = new PeekPeekEngine(cfg());
    const b = e.start(0);
    expect(e.phase).toBe("study");
    expect(e.tap(b.cells[0]!.id, 10).kind).toBe("ignored"); // no taps while studying
    const last = clearBoard(e);
    expect(last).toMatchObject({ kind: "correct", levelDone: true });
    expect(e.score).toBeGreaterThan(0);
    const next = e.next(5000);
    expect(next).toMatchObject({ kind: "board", retry: false });
    expect(e.level).toBe(2);
    expect(e.metrics.levels[0]).toMatchObject({ level: 1, completed: true });
  });

  it("found tiles can't be tapped again", () => {
    const e = new PeekPeekEngine(cfg());
    e.start(0);
    e.beginHunt(0);
    const hex = e.board!.cells.find((c) => e.board!.assignment[c.id] === e.target)!.id;
    expect(e.tap(hex, 100).kind).toBe("correct");
    expect(e.tap(hex, 600).kind).toBe("ignored");
  });

  it("lives = auto: an empty board budget fails the board; a fresh board follows; after 5 failures the game moves on", () => {
    const e = new PeekPeekEngine(cfg({ startLevel: 3 }));
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      expect(e.board?.attempt ?? 1).toBe(attempt);
      if (attempt === 1) e.start(0);
      e.beginHunt(0);
      const budget = e.hearts!;
      let r = null;
      for (let i = 0; i < budget; i++) r = e.tap(wrongHex(e), 100 + i * 300);
      expect(r).toMatchObject({ kind: "wrong", boardFailed: true, heartsLeft: 0 });
      const next = e.next(9000);
      if (attempt < MAX_ATTEMPTS) expect(next).toMatchObject({ kind: "board", retry: true, skipped: false });
      else expect(next).toMatchObject({ kind: "board", retry: false, skipped: true });
    }
    expect(e.level).toBe(4);
    expect(e.metrics.levels.filter((l) => !l.completed)).toHaveLength(MAX_ATTEMPTS);
  });

  it("lives = N or timed: boards never fail on wrong taps (Session Rules owns the session counter)", () => {
    for (const lives of ["session", "none"] as const) {
      const e = new PeekPeekEngine(cfg({ lives }));
      e.start(0);
      e.beginHunt(0);
      for (let i = 0; i < 20; i++) expect(e.tap(wrongHex(e), 100 + i * 300)).toMatchObject({ kind: "wrong", boardFailed: false, heartsLeft: null });
      expect(e.phase).toBe("hunt");
    }
  });

  it("clearing the max level finishes", () => {
    const e = new PeekPeekEngine(cfg({ startLevel: 2, maxLevel: 2 }));
    e.start(0);
    clearBoard(e);
    expect(e.next(1).kind).toBe("finished");
  });

  it("the control trial is a face-up board outside the levels", () => {
    const e = new PeekPeekEngine(cfg());
    const b = e.startControl(0);
    const slot = b.tray[0]!;
    const wrong = b.cells.find((c) => b.assignment[c.id] !== slot)!.id;
    expect(e.controlTap(wrong, 200)).toEqual({ correct: false, done: false });
    const hits = b.cells.filter((c) => b.assignment[c.id] === slot);
    let r = null;
    for (const [i, c] of hits.entries()) r = e.controlTap(c.id, 500 + i * 300);
    expect(r).toEqual({ correct: true, done: true });
    expect(e.metrics.levels).toHaveLength(0);
    expect(e.metrics.summary({ maxLevel: 50, highestLevel: 1, hemisphere: "left", pack: "marine", hiddenCount: false, studyOverrideS: null }).control_trial_completed).toBe(1);
  });
});

describe("measures", () => {
  it("tells within, between and novel errors apart (v1 classed every miss as within)", () => {
    const e = new PeekPeekEngine(cfg({ startLevel: 9, lives: "none" }));
    e.start(0);
    e.beginHunt(0);
    const a = wrongHex(e);
    e.tap(a, 100); // novel
    e.tap(a, 400); // within: same tile, same picture
    // finish this picture, then tap `a` again for the next picture: between
    while (e.roundIndex === 0) e.tap(e.board!.cells.find((c) => e.board!.assignment[c.id] === e.target && !e.found.has(c.id))!.id, 1000);
    if (e.board!.assignment[a] !== e.target) e.tap(a, 1500);
    e.cutShort(2000, "time_up");
    const m = e.metrics.summary({ maxLevel: 50, highestLevel: 9, hemisphere: "left", pack: "marine", hiddenCount: false, studyOverrideS: null });
    expect(m.novel_hex_errors).toBe(1);
    expect(m.within_search_errors).toBe(1);
    expect(m.between_search_errors).toBe(e.board!.assignment[a] !== e.board!.tray[1] ? 1 : 0);
    expect(m.perseveration_rate).toBeLessThan(1);
  });

  it("left/right measures come only from probe levels", () => {
    const e = new PeekPeekEngine(cfg({ startLevel: 4, maxLevel: 5 }));
    e.start(0);
    expect(e.board!.isProbe).toBe(true);
    clearBoard(e);
    e.next(1);
    clearBoard(e, 20000);
    const m = e.metrics.summary({ maxLevel: 5, highestLevel: 5, hemisphere: "left", pack: "marine", hiddenCount: false, studyOverrideS: null });
    expect(m.probe_levels_used).toEqual([4]);
    expect(m.probe_count).toBe(1);
    expect(m.find_order_index).not.toBeNull();
    expect(m.levels_completed).toBe(2);
    expect(m.first_attempt_accuracy).toBe(1);
    expect(m.capacity_estimate).toBe(5);
  });

  it("accidental taps (too fast) are kept out of the error measures", () => {
    const e = new PeekPeekEngine(cfg({ lives: "none" }));
    e.start(0);
    e.beginHunt(0);
    e.tap(wrongHex(e), 100, true);
    e.cutShort(500, "time_up");
    const m = e.metrics.summary({ maxLevel: 50, highestLevel: 1, hemisphere: "left", pack: "marine", hiddenCount: false, studyOverrideS: null });
    expect(m.suspected_accidental_taps).toBe(1);
    expect(m.total_errors).toBe(0);
  });

  it("learning slope compares misses with chance, round by round", () => {
    const e = new PeekPeekEngine(cfg({ startLevel: 9, lives: "none" }));
    e.start(0);
    e.beginHunt(0);
    // Many misses in round 1, none after: getting better relative to chance → negative slope.
    for (let i = 0; i < 4; i++) e.tap(wrongHex(e), 100 + i * 300);
    while (e.phase === "hunt") e.tap(e.board!.cells.find((c) => e.board!.assignment[c.id] === e.target && !e.found.has(c.id))!.id, 5000);
    const m = e.metrics.summary({ maxLevel: 50, highestLevel: 9, hemisphere: "left", pack: "marine", hiddenCount: false, studyOverrideS: null });
    expect(m.learning_slope!).toBeLessThan(0);
    expect(m.learning_slope_levels).toBe(1);
  });
});
