import { describe, expect, it } from "vitest";
import { POSES, posesFor, type BodyPart, type AgeBand } from "../src/assets.ts";

describe("POSES catalogue", () => {
  it("has at least 19 hand poses", () => {
    const count = (bp: BodyPart) => POSES.filter(p => p.bodyPart === bp).length;
    expect(count("hand")).toBeGreaterThanOrEqual(19);
  });
  it("every pose has a unique id and an imageFile ending in .png", () => {
    const ids = POSES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of POSES) expect(p.imageFile).toMatch(/\.png$/);
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
  it("returns hands for all age bands (only hand poses currently)", () => {
    for (const band of ["4-6", "7-9", "10-12", "13+"] as AgeBand[]) {
      const ps = posesFor(band);
      expect(ps.length).toBeGreaterThan(0);
      for (const p of ps) expect(p.bodyPart).toBe("hand");
    }
  });
  it("filters by allowed body parts", () => {
    const ps = posesFor("13+", ["hand"]);
    for (const p of ps) expect(p.bodyPart).toBe("hand");
  });
  it("falls back to all eligible if filter leaves nothing (Review Focus #5)", () => {
    // No ear poses exist yet, so filtering to ear-only should fall back
    const ps = posesFor("4-6", ["ear"]);
    expect(ps.length).toBeGreaterThan(0);
    // fallback gives all eligible for the age band (hands)
    expect(ps[0]!.bodyPart).toBe("hand");
  });
});
