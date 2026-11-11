import { describe, expect, it } from "vitest";
import { MAX_LEVEL, rotationRange, timeLimit, bodyPartsForLevel, nextLevel, clamp } from "../src/config.ts";

describe("rotationRange", () => {
  it("levels 1-5 cap at 15°", () => {
    for (let l = 1; l <= 5; l++) expect(rotationRange(l)).toBe(15);
  });
  it("levels 6-10 cap at 45°", () => {
    expect(rotationRange(6)).toBe(45);
    expect(rotationRange(10)).toBe(45);
  });
  it("levels 26-30 cap at 180°", () => {
    expect(rotationRange(30)).toBe(180);
  });
});

describe("timeLimit", () => {
  it("levels 1-5 give 8000ms", () => {
    expect(timeLimit(1, 0)).toBe(8000);
  });
  it("levels 26-30 give 3000ms", () => {
    expect(timeLimit(30, 0)).toBe(3000);
  });
  it("override replaces auto, clamped to 2000-10000", () => {
    expect(timeLimit(1, 5000)).toBe(5000);
    expect(timeLimit(1, 500)).toBe(2000);
    expect(timeLimit(1, 99999)).toBe(10000);
  });
});

describe("bodyPartsForLevel", () => {
  it("levels 1-5: hands only", () => {
    expect(bodyPartsForLevel(1)).toEqual(["hand"]);
  });
  it("levels 6-10: hands + feet", () => {
    expect(bodyPartsForLevel(6)).toEqual(expect.arrayContaining(["hand", "foot"]));
    expect(bodyPartsForLevel(6)).not.toContain("ear");
  });
  it("levels 16+: all body parts", () => {
    expect(bodyPartsForLevel(16)).toEqual(expect.arrayContaining(["hand", "arm", "foot", "ear"]));
  });
});

describe("nextLevel (2-up/2-down staircase)", () => {
  it("two correct in a row → up", () => {
    expect(nextLevel(5, [true, true])).toBe(6);
  });
  it("two wrong in a row → down", () => {
    expect(nextLevel(5, [false, false])).toBe(4);
  });
  it("mixed → same", () => {
    expect(nextLevel(5, [true, false])).toBe(5);
  });
  it("clamps at 1 (Review Focus #3)", () => {
    expect(nextLevel(1, [false, false])).toBe(1);
  });
  it("clamps at 30 (Review Focus #3)", () => {
    expect(nextLevel(30, [true, true])).toBe(30);
  });
  it("needs at least 2 results", () => {
    expect(nextLevel(5, [true])).toBe(5);
    expect(nextLevel(5, [])).toBe(5);
  });
});
