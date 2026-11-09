/** Brain-region filters (spec 2026-11-09): the sub-lobes, Brodmann links and the product owner's settings sheet as data. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AREAS, AREA_SUBLOBE, LOBES, SUBCORTICAL, SUBLOBES } from "../src/brain-regions.ts";
import { parseSettingsCsv, REGION_SETTINGS } from "../src/region-settings.ts";
import { tableConsistencyErrors } from "../../contracts/src/regions.ts";

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
