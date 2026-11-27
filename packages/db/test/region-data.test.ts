/** Brain-region filters (spec 2026-11-09): the sub-lobes, Brodmann links and the product owner's settings sheet as data. */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AREAS, AREA_SUBLOBE, LOBES, SUBCORTICAL, SUBLOBES, SUBLOBES_0018 } from "../src/brain-regions.ts";
import { parseSettingsCsv, REGION_SETTINGS, REGION_SETTINGS_0018 } from "../src/region-settings.ts";
import { motionRuleErrors, tableConsistencyErrors } from "../../contracts/src/regions.ts";

const csvPath = fileURLToPath(new URL("../src/region-settings.csv", import.meta.url));
const firstCsvPath = fileURLToPath(new URL("../src/region-settings.0018.csv", import.meta.url));

describe("region settings sheet", () => {
  it("REGION_SETTINGS matches the committed CSV", () => {
    expect(REGION_SETTINGS).toEqual(parseSettingsCsv(readFileSync(csvPath, "utf8")));
    expect(REGION_SETTINGS_0018).toEqual(parseSettingsCsv(readFileSync(firstCsvPath, "utf8")));
    expect(REGION_SETTINGS_0018).toHaveLength(20);
  });

  it("has 24 rows, one per side × sub-lobe, each under its own lobe", () => {
    expect(REGION_SETTINGS).toHaveLength(24);
    const keys = new Set(REGION_SETTINGS.map((r) => `${r.side}.${r.lobe}.${r.sublobe}`));
    expect(keys.size).toBe(24);
    for (const r of REGION_SETTINGS) expect(SUBLOBES.find((s) => s.code === r.sublobe)?.lobe, r.sublobe).toBe(r.lobe);
  });

  it("right DLPFC has two motion entries and left cerebellum is cold, clockwise, west", () => {
    const dlpfc = REGION_SETTINGS.find((r) => r.side === "right" && r.sublobe === "dlpfc")!;
    expect(dlpfc.motion).toEqual([
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [1, 4], directions: ["rtl", "brdtl"] },
    ]);
    expect(dlpfc.bg_types).toEqual(["textured"]);
    const cb = REGION_SETTINGS.find((r) => r.side === "left" && r.sublobe === "cerebellum")!;
    expect(cb).toMatchObject({ lobe: "subcortical", bg_temperature: "cold", rotation: "cw", bg_types: ["textured", "solid"], target_locations: ["W", "SW", "NW", "N", "S"] });
  });

  it("keeps values as given, duplicates included; the 2026-11-27 table corrected right orbitofrontal", () => {
    const first = REGION_SETTINGS_0018.find((r) => r.side === "right" && r.sublobe === "orbitofrontal")!;
    expect(first.motion[0]!.directions).toEqual(["ltr", "ltr"]);
    const now = REGION_SETTINGS.find((r) => r.side === "right" && r.sublobe === "orbitofrontal")!;
    expect(now.motion).toEqual([{ movement_types: [0, 3], directions: ["ltr", "tldbr"] }, { movement_types: [1, 4], directions: ["rtl", "brdtl"] }]);
  });

  it("the 2026-11-27 table: basal ganglia on both sides, and no row uses movement types 2 or 5", () => {
    const bg = (side: string, code: string) => REGION_SETTINGS.find((r) => r.side === side && r.sublobe === code)!;
    expect(bg("right", "basal_ganglia_direct").motion).toEqual([
      { movement_types: [1, 4], directions: ["rtl", "brdtl"] },
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [0, 1], directions: ["ttb"] },
    ]);
    // Left direct pathway: the mirror of the right one — continuous heads left (RTL, TRDBL), intervals head right.
    expect(bg("left", "basal_ganglia_direct").motion).toEqual([
      { movement_types: [1, 4], directions: ["ltr", "bldtr"] },
      { movement_types: [0, 3], directions: ["rtl", "trdbl"] },
      { movement_types: [0, 1], directions: ["btt"] },
    ]);
    // As typed in the correction (LTR, TRDBL for intervals; RTL, BLDTR for continuous) it would break the rule.
    expect(motionRuleErrors([{ path: "as typed", bg_temperature: "warm", motion: [{ movement_types: [1, 4], directions: ["ltr", "trdbl"] }, { movement_types: [0, 3], directions: ["rtl", "bldtr"] }] }]).length).toBeGreaterThan(0);
    expect(bg("left", "basal_ganglia_indirect")).toMatchObject({ bg_temperature: "warm", rotation: "ccw", motion: [{ movement_types: [1], directions: ["ltr", "bldtr"] }, { movement_types: [1], directions: ["btt"] }] });
    // As typed in the spreadsheet (intervals LTR, TRDBL) both left basal-ganglia rows would break the rule.
    expect(motionRuleErrors([{ path: "as typed", bg_temperature: "warm", motion: [{ movement_types: [1], directions: ["ltr", "trdbl"] }] }])).toHaveLength(1);
    const used = new Set(REGION_SETTINGS.flatMap((r) => r.motion.flatMap((m) => m.movement_types)));
    expect([...used].sort()).toEqual([0, 1, 3, 4]);
    // Left frontal rows gained their diagonals in the spreadsheet of 2026-11-27.
    expect(bg("left", "dlpfc").motion).toEqual([{ movement_types: [0, 3], directions: ["rtl", "trdbl"] }, { movement_types: [1, 4], directions: ["ltr", "bldtr"] }]);
    expect(bg("left", "orbitofrontal").motion).toEqual(bg("left", "dlpfc").motion);
    // The first table obeys the rule too.
    expect(motionRuleErrors(REGION_SETTINGS_0018.map((r) => ({ ...r, path: `${r.side}.${r.lobe}.${r.sublobe}` })))).toEqual([]);
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
    expect(cb.motion).toEqual([{ movement_types: [0, 3], directions: ["tldbr"] }, { movement_types: [1, 4], directions: ["brdtl"] }]);
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
    expect(Object.keys(AREA_SUBLOBE)).toHaveLength(14); // 19 in the first table; the 2026-11-27 sheet lists five fewer
  });

  it("every sub-lobe has English and Hebrew labels, and the subcortical lobe is new", () => {
    expect(SUBLOBES_0018).toHaveLength(10);
    expect(SUBLOBES).toHaveLength(12);
    expect(SUBLOBES.slice(0, 10).map((x) => x.code)).toEqual(SUBLOBES_0018.map((x) => x.code)); // sort order is stable
    for (const s of SUBLOBES) {
      expect(s.en.trim(), s.code).not.toBe("");
      expect(s.he, s.code).toMatch(/[֐-׿]/);
    }
    expect(SUBCORTICAL.code).toBe("subcortical");
    expect(LOBES.some((l) => l.code === "subcortical")).toBe(false);
  });
});
