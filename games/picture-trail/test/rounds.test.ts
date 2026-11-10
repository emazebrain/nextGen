/** Picture Trail: the pictures and how a round is built (spec 2026-11-10). */
import { describe, expect, it } from "vitest";
import { PICTURES } from "../src/pictures.ts";
import { buildRound, directionsFor, picturesFor, targetsFor } from "../src/rounds.ts";
import { alongSide } from "../src/geometry.ts";

function mulberry(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const region = (motion: Array<{ movement_types: number[]; directions: string[] }>, target_locations = ["W", "NW", "N"]) => ({ motion, target_locations });

describe("pictures", () => {
  it("has at least 48 pictures for 4–6 and at least 24 more for each older band", () => {
    expect(picturesFor("4-6").length).toBeGreaterThanOrEqual(48);
    expect(picturesFor("7-9").length - picturesFor("4-6").length).toBeGreaterThanOrEqual(24);
    expect(picturesFor("10-12").length - picturesFor("7-9").length).toBeGreaterThanOrEqual(24);
    expect(picturesFor("13+").length - picturesFor("10-12").length).toBeGreaterThanOrEqual(24);
    expect(picturesFor("13+")).toHaveLength(PICTURES.length);
    expect(picturesFor("4-6").every((p) => p.band === "4-6")).toBe(true);
  });

  it("has unique ids, real SVGs and nothing from the excluded kinds", () => {
    expect(new Set(PICTURES.map((p) => p.id)).size).toBe(PICTURES.length);
    for (const p of PICTURES) expect(p.svg.startsWith("<svg")).toBe(true);
    const banned = /flag|face|person|man|woman|hand|pig|bacon|wine|beer|knife|gun|sword|bomb|cross|church|mosque|synagogue/;
    for (const p of PICTURES) expect(p.id).not.toMatch(banned);
  });
});

describe("directions and targets", () => {
  it("takes the directions listed with movement type 0", () => {
    expect(directionsFor({ hemisphere: "right", region: region([{ movement_types: [0, 3], directions: ["ltr", "tldbr"] }, { movement_types: [1], directions: ["rtl", "brdtl"] }]) })).toEqual(["ltr", "tldbr"]);
  });

  it("falls back to the first motion entry", () => {
    expect(directionsFor({ hemisphere: "left", region: region([{ movement_types: [1], directions: ["bldtr"] }, { movement_types: [3], directions: ["ttb"] }]) })).toEqual(["bldtr"]);
  });

  it("without a filter: left to right for the right hemisphere, right to left for the left, or the step's fixed direction", () => {
    expect(directionsFor({ hemisphere: "right" })).toEqual(["ltr"]);
    expect(directionsFor({ hemisphere: "left" })).toEqual(["rtl"]);
    expect(directionsFor({ hemisphere: "left", direction: "ttb" })).toEqual(["ttb"]);
    expect(directionsFor({ hemisphere: "left", direction: "auto" })).toEqual(["rtl"]);
  });

  it("targets come from the filter; none without one", () => {
    expect(targetsFor({ hemisphere: "right", region: region([{ movement_types: [0], directions: ["ltr"] }], ["W", "SW"]) })).toEqual(["W", "SW"]);
    expect(targetsFor({ hemisphere: "right" })).toEqual([]);
  });
});

describe("buildRound", () => {
  const base = { level: 5, band: "7-9" as const, lures: false, directions: ["ltr" as const], targets: [] as never[], n: 5 };

  it("has no repeated picture and exactly one picture in both runs", () => {
    for (let s = 1; s <= 200; s++) {
      const r = buildRound(mulberry(s), { ...base, used: new Set() });
      expect(r.question).toHaveLength(5);
      expect(r.answer).toHaveLength(5);
      const q = new Set(r.question.map((p) => p.id));
      const a = r.answer.map((p) => p.id);
      expect(q.size).toBe(5);
      expect(new Set(a).size).toBe(5);
      expect(a.filter((id) => q.has(id))).toEqual([r.question[r.matchQ]!.id]);
      expect(r.answer[r.matchA]!.id).toBe(r.question[r.matchQ]!.id);
    }
  });

  it("puts the match in the half of the line nearest the target location", () => {
    let near = 0;
    for (let s = 1; s <= 500; s++) {
      const r = buildRound(mulberry(s), { ...base, n: 6, directions: ["ltr"], targets: ["W"], used: new Set() });
      expect(r.target).toBe("W");
      expect(alongSide(r.direction, "W")).toBe(-1);
      if (r.matchA < 3) near++;
    }
    expect(near / 500).toBeGreaterThan(0.7);
  });

  it("reuses only after the set is used up", () => {
    const used = new Set<string>();
    const rng = mulberry(9);
    const pool = picturesFor("4-6").length;
    const perRound = 2 * 3 - 1;
    const before = Math.floor(pool / perRound);
    const seen = new Set<string>();
    for (let i = 0; i < before; i++) {
      const r = buildRound(rng, { ...base, band: "4-6", n: 3, used });
      for (const p of [...r.question, ...r.answer]) {
        if (p.id !== r.question[r.matchQ]!.id) expect(seen.has(p.id)).toBe(false);
        seen.add(p.id);
      }
    }
    for (let i = 0; i < 5; i++) {
      const r = buildRound(rng, { ...base, band: "4-6", n: 3, used });
      expect(new Set([...r.question, ...r.answer].map((p) => p.id)).size).toBe(perRound);
    }
  });

  it("look-alike rounds fill at least half of the wrong answers from the match's category", () => {
    for (let s = 1; s <= 100; s++) {
      const r = buildRound(mulberry(s), { ...base, band: "13+", n: 5, lures: true, used: new Set() });
      expect(r.lure).toBe(true);
      const cat = r.question[r.matchQ]!.category;
      const others = r.answer.filter((_, i) => i !== r.matchA);
      expect(others.filter((p) => p.category === cat).length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("buildRound and the screen", () => {
  it("uses the picture count the screen allows for the chosen direction", () => {
    const r = buildRound(mulberry(3), { level: 25, band: "13+", lures: false, directions: ["tldbr"], targets: [], n: 8, nFor: (d) => (d === "tldbr" ? 6 : 8), used: new Set() });
    expect(r.n).toBe(6);
    expect(r.question).toHaveLength(6);
    expect(r.answer).toHaveLength(6);
  });
});
