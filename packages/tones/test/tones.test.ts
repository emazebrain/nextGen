import { describe, expect, it } from "vitest";
import {
  ageInYears,
  autoAgeGroup,
  findAgeGroup,
  toneParams,
  toneParamsForPatient,
  TONE_AGE_GROUPS,
  RIGHT_EAR_CARRIER_HZ,
  LEFT_EAR_CARRIER_HZ,
} from "../src/index.ts";

describe("ageInYears", () => {
  it("computes age correctly", () => {
    expect(ageInYears("2020-06-15", "2026-11-21")).toBe(6);
    expect(ageInYears("2020-12-01", "2026-11-21")).toBe(5); // birthday not yet
    expect(ageInYears("2026-01-01", "2026-11-21")).toBe(0);
  });

  it("handles exact birthday", () => {
    expect(ageInYears("2020-11-21", "2026-11-21")).toBe(6);
  });
});

describe("autoAgeGroup", () => {
  it("matches 1-year-old to group 2", () => {
    expect(autoAgeGroup(1)?.id).toBe(2);
  });

  it("matches 0-year-old to group 2 (1 year)", () => {
    expect(autoAgeGroup(0)?.id).toBe(2);
  });

  it("matches 2-year-old to group 3", () => {
    expect(autoAgeGroup(2)?.id).toBe(3);
  });

  it("matches 4-year-old to group 5", () => {
    expect(autoAgeGroup(4)?.id).toBe(5);
  });

  it("matches 5-year-old to group 6", () => {
    expect(autoAgeGroup(5)?.id).toBe(6);
  });

  it("matches 7-year-old to group 8", () => {
    expect(autoAgeGroup(7)?.id).toBe(8);
  });

  it("matches 10-year-old to group 9", () => {
    expect(autoAgeGroup(10)?.id).toBe(9);
  });

  it("matches 15-year-old to group 12", () => {
    expect(autoAgeGroup(15)?.id).toBe(12);
  });

  it("matches 18-year-old to group 14", () => {
    expect(autoAgeGroup(18)?.id).toBe(14);
  });

  it("matches 30-year-old to group 15", () => {
    expect(autoAgeGroup(30)?.id).toBe(15);
  });

  it("never auto-selects special groups (severe tics)", () => {
    // 17+ could match group 17 (severe tics) but auto should pick group 14
    const g = autoAgeGroup(17);
    expect(g?.id).toBe(14);
    expect(g?.special).toBeUndefined();
  });
});

describe("toneParams", () => {
  it("returns correct pulse rates for right brain deficit, group 8", () => {
    const p = toneParams(8, "right");
    expect(p).not.toBeNull();
    expect(p!.leftPulseRate).toBe(7);
    expect(p!.rightPulseRate).toBe(2);
    expect(p!.leftCarrierHz).toBe(LEFT_EAR_CARRIER_HZ);
    expect(p!.rightCarrierHz).toBe(RIGHT_EAR_CARRIER_HZ);
  });

  it("returns correct pulse rates for left brain deficit, group 12", () => {
    const p = toneParams(12, "left");
    expect(p).not.toBeNull();
    expect(p!.leftPulseRate).toBe(4);
    expect(p!.rightPulseRate).toBe(25);
  });

  it("returns null for group 17 with left hemisphere (not supported)", () => {
    expect(toneParams(17, "left")).toBeNull();
  });

  it("returns values for group 17 with right hemisphere", () => {
    const p = toneParams(17, "right");
    expect(p).not.toBeNull();
    expect(p!.leftPulseRate).toBe(30);
    expect(p!.rightPulseRate).toBe(1);
  });

  it("returns null for invalid group", () => {
    expect(toneParams(99, "left")).toBeNull();
  });
});

describe("toneParamsForPatient", () => {
  it("auto-selects age group from DOB", () => {
    // 6-year-old → group 8 → right deficit
    const p = toneParamsForPatient("2020-06-15", "right", null, "2026-11-21");
    expect(p).not.toBeNull();
    expect(p!.leftPulseRate).toBe(7);
    expect(p!.rightPulseRate).toBe(2);
  });

  it("uses override group when provided", () => {
    // Age would be group 14 (17-21), but override to group 17 (severe tics)
    const p = toneParamsForPatient("2008-01-01", "right", 17, "2026-11-21");
    expect(p).not.toBeNull();
    expect(p!.leftPulseRate).toBe(30);
    expect(p!.rightPulseRate).toBe(1);
  });
});

describe("TONE_AGE_GROUPS", () => {
  it("has 11 groups", () => {
    expect(TONE_AGE_GROUPS).toHaveLength(11);
  });

  it("every non-special group has both hemispheres", () => {
    for (const g of TONE_AGE_GROUPS) {
      if (!g.special) {
        expect(g.hemispheres).toContain("left");
        expect(g.hemispheres).toContain("right");
      }
    }
  });

  it("every group has tone params for its supported hemispheres", () => {
    for (const g of TONE_AGE_GROUPS) {
      for (const h of g.hemispheres) {
        const p = toneParams(g.id, h);
        expect(p, `group ${g.id} hemisphere ${h}`).not.toBeNull();
      }
    }
  });

  it("carriers are always 440 (right) and 128 (left)", () => {
    for (const g of TONE_AGE_GROUPS) {
      for (const h of g.hemispheres) {
        const p = toneParams(g.id, h)!;
        expect(p.rightCarrierHz).toBe(440);
        expect(p.leftCarrierHz).toBe(128);
      }
    }
  });
});

describe("findAgeGroup", () => {
  it("finds by id", () => {
    expect(findAgeGroup(17)?.label).toBe("17+ severe tics");
  });

  it("returns undefined for unknown id", () => {
    expect(findAgeGroup(99)).toBeUndefined();
  });
});
