import { describe, expect, it } from "vitest";
import { POSES, posesFor, type BodyPart, type AgeBand } from "../src/assets.ts";

describe("POSES catalogue", () => {
  it("has at least 8 hand poses, 4 arm, 3 foot, 3 ear", () => {
    const count = (bp: BodyPart) => POSES.filter(p => p.bodyPart === bp).length;
    expect(count("hand")).toBeGreaterThanOrEqual(8);
    expect(count("arm")).toBeGreaterThanOrEqual(4);
    expect(count("foot")).toBeGreaterThanOrEqual(3);
    expect(count("ear")).toBeGreaterThanOrEqual(3);
  });
  it("every pose has a unique id and a svgFile ending in .svg", () => {
    const ids = POSES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of POSES) expect(p.svgFile).toMatch(/\.svg$/);
  });
  it("all poses have canFlip = true (initial set)", () => {
    for (const p of POSES) expect(p.canFlip).toBe(true);
  });
});

describe("posesFor", () => {
  it("returns only hands for band 4-6", () => {
    const ps = posesFor("4-6");
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p.bodyPart).toBe("hand");
  });
  it("returns hands + arms + feet for band 7-9", () => {
    const ps = posesFor("7-9");
    const parts = new Set(ps.map(p => p.bodyPart));
    expect(parts).toContain("hand");
    expect(parts).toContain("arm");
    expect(parts).toContain("foot");
    expect(parts).not.toContain("ear");
  });
  it("returns all body parts for band 10-12 and 13+", () => {
    for (const band of ["10-12", "13+"] as AgeBand[]) {
      const parts = new Set(posesFor(band).map(p => p.bodyPart));
      expect(parts).toEqual(new Set(["hand", "arm", "foot", "ear"]));
    }
  });
  it("filters by allowed body parts", () => {
    const ps = posesFor("13+", ["foot", "ear"]);
    for (const p of ps) expect(["foot", "ear"]).toContain(p.bodyPart);
  });
  it("falls back to all eligible if filter leaves nothing (Review Focus #5)", () => {
    // ear requires 10+, so filtering to ear-only for 4-6 should fall back
    const ps = posesFor("4-6", ["ear"]);
    expect(ps.length).toBeGreaterThan(0);
    // fallback gives all eligible for the age band (hands)
    expect(ps[0]!.bodyPart).toBe("hand");
  });
});
