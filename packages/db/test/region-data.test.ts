/** Brain-region filters (spec 2026-11-09): the sub-lobes, Brodmann links and the product owner's settings sheet as data. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AREAS, AREA_SUBLOBE, LOBES, SUBCORTICAL, SUBLOBES } from "../src/brain-regions.ts";
import { parseSettingsCsv, REGION_SETTINGS } from "../src/region-settings.ts";
import { motionRuleErrors, tableConsistencyErrors } from "../../contracts/src/regions.ts";

const csvPath = fileURLToPath(new URL("../src/region-settings.csv", import.meta.url));

describe("region settings sheet", () => {
  it("REGION_SETTINGS matches the committed CSV", () => {
    expect(REGION_SETTINGS).toEqual(parseSettingsCsv(readFileSync(csvPath, "utf8")));
  });

  it("has 20 rows, one per side × sub-lobe, each under its own lobe", () => {
    expect(REGION_SETTINGS).toHaveLength(20);
    const keys = new Set(REGION_SETTINGS.map((r) => `${r.side}.${r.lobe}.${r.sublobe}`));
    expect(keys.size).toBe(20);
    for (const r of REGION_SETTINGS) expect(SUBLOBES.find((s) => s.code === r.sublobe)?.lobe, r.sublobe).toBe(r.lobe);
  });

  it("right DLPFC has two motion entries and left cerebellum is cold, clockwise, west", () => {
    const dlpfc = REGION_SETTINGS.find((r) => r.side === "right" && r.sublobe === "dlpfc")!;
    expect(dlpfc.motion).toEqual([
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [1], directions: ["rtl", "brdtl"] },
    ]);
    expect(dlpfc.bg_types).toEqual(["textured"]);
    const cb = REGION_SETTINGS.find((r) => r.side === "left" && r.sublobe === "cerebellum")!;
    expect(cb).toMatchObject({ lobe: "subcortical", bg_temperature: "cold", rotation: "cw", bg_types: ["textured", "solid"], target_locations: ["W", "SW", "NW", "N", "S"] });
  });

  it("keeps values as given, duplicates included", () => {
    const of = REGION_SETTINGS.find((r) => r.side === "right" && r.sublobe === "orbitofrontal")!;
    expect(of.motion[0]!.directions).toEqual(["ltr", "ltr"]);
  });

  it("the table keeps the cold/warm pattern", () => {
    expect(tableConsistencyErrors(REGION_SETTINGS.map((r) => ({ ...r, path: `${r.side}.${r.lobe}.${r.sublobe}` })))).toEqual([]);
  });

  it("follows the eye-movement rule: continuous movement heads toward the hemisphere, intervals away from it", () => {
    const rows = REGION_SETTINGS.map((r) => ({ ...r, path: `${r.side}.${r.lobe}.${r.sublobe}` }));
    expect(motionRuleErrors(rows)).toEqual([]);
    // The owner's example: the left cerebellum runs as the right hemisphere — tracking goes top-left to bottom-right,
    // and bottom-right to top-left appears only with intervals.
    const cb = rows.find((r) => r.path === "left.subcortical.cerebellum")!;
    expect(cb.bg_temperature).toBe("cold");
    expect(cb.motion).toEqual([{ movement_types: [0, 3], directions: ["tldbr"] }, { movement_types: [1], directions: ["brdtl"] }]);
    // No row pairs one movement type with both a direction and its reverse.
    const reverse = { ltr: "rtl", rtl: "ltr", ttb: "btt", btt: "ttb", tldbr: "brdtl", brdtl: "tldbr", trdbl: "bldtr", bldtr: "trdbl" } as const;
    for (const r of rows) {
      const seen = new Set(r.motion.flatMap((m) => m.movement_types.flatMap((t) => m.directions.map((d) => `${t}:${d}`))));
      for (const key of seen) {
        const [t, d] = key.split(":") as [string, keyof typeof reverse];
        expect(seen.has(`${t}:${reverse[d]}`), `${r.path} ${key}`).toBe(false);
      }
    }
  });

  it("the rule checker catches a row that breaks it", () => {
    expect(motionRuleErrors([{ path: "x", bg_temperature: "cold", motion: [{ movement_types: [0], directions: ["brdtl"] }] }])).toHaveLength(1);
    expect(motionRuleErrors([{ path: "x", bg_temperature: "warm", motion: [{ movement_types: [2], directions: ["rtl"] }] }])).toHaveLength(1); // continuous both ways
    expect(motionRuleErrors([{ path: "x", bg_temperature: "warm", motion: [{ movement_types: [4], directions: ["ltr"] }, { movement_types: [0, 1], directions: ["btt"] }] }])).toEqual([]);
  });
});

describe("sub-lobes and Brodmann links", () => {
  it("every Brodmann link stays inside its lobe", () => {
    for (const [ba, sub] of Object.entries(AREA_SUBLOBE)) {
      const area = AREAS.find((a) => a.code === ba);
      expect(area, ba).toBeDefined();
      expect(SUBLOBES.find((s) => s.code === sub)?.lobe, `${ba} → ${sub}`).toBe(area!.lobe);
    }
    expect(Object.keys(AREA_SUBLOBE)).toHaveLength(19);
  });

  it("every sub-lobe has English and Hebrew labels, and the subcortical lobe is new", () => {
    expect(SUBLOBES).toHaveLength(10);
    for (const s of SUBLOBES) {
      expect(s.en.trim(), s.code).not.toBe("");
      expect(s.he, s.code).toMatch(/[֐-׿]/);
    }
    expect(SUBCORTICAL.code).toBe("subcortical");
    expect(LOBES.some((l) => l.code === "subcortical")).toBe(false);
  });
});
