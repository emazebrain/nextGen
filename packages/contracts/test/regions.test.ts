import { describe, expect, it } from "vitest";
import {
  gameRegionError,
  regionCatalog,
  resolveRegion,
  seededIndex,
  tableConsistencyErrors,
  type BrainRegion,
  type RegionSettingView,
} from "../src/index.ts";

const cold = (over: Partial<RegionSettingView> = {}): RegionSettingView => ({
  bg_temperature: "cold",
  bg_types: ["textured"],
  motion: [{ movement_types: [0, 3], directions: ["ltr", "tldbr"] }],
  target_locations: ["W", "SW", "S"],
  rotation: "cw",
  clinical_status: "draft",
  revision: 1,
  ...over,
});
const warm = (over: Partial<RegionSettingView> = {}): RegionSettingView =>
  cold({ bg_temperature: "warm", target_locations: ["E", "SE", "NE", "N", "S"], rotation: "ccw", ...over });

let n = 0;
const ids = new Map<string, string>();
const id = (path: string) => {
  if (!ids.has(path)) ids.set(path, `00000000-0000-7000-8000-${String(++n).padStart(12, "0")}`);
  return ids.get(path)!;
};
function node(path: string, kind: BrainRegion["kind"], extra: Partial<BrainRegion> = {}): BrainRegion {
  const parts = path.split(".");
  return {
    id: id(path),
    kind,
    code: parts[parts.length - 1]!,
    path,
    parent_id: parts.length > 1 ? id(parts.slice(0, -1).join(".")) : null,
    label: path,
    sort: 1,
    sublobe_id: null,
    setting: null,
    ...extra,
  };
}

const REGIONS: BrainRegion[] = [
  node("right", "hemisphere"),
  node("right.frontal", "lobe"),
  node("right.frontal.dlpfc", "sublobe", { setting: cold() }),
  node("right.frontal.orbitofrontal", "sublobe", { setting: cold({ bg_types: ["solid"], target_locations: ["W", "NW", "N"] }) }),
  node("right.frontal.ba46", "area", { sublobe_id: id("right.frontal.dlpfc") }),
  node("right.frontal.ba44", "area"),
  node("right.subcortical", "lobe"),
  node("right.subcortical.pons", "sublobe", { setting: cold({ target_locations: ["W", "SW", "NW"] }) }),
  node("right.subcortical.cerebellum", "sublobe", { setting: warm() }),
  node("right.occipital", "lobe"),
  node("right.occipital.ba17", "area"),
];
const cat = regionCatalog(REGIONS);

describe("resolveRegion", () => {
  it("resolves a sub-lobe to its row", () => {
    const r = resolveRegion(cat, id("right.frontal.dlpfc"), 7)!;
    expect(r.param.sublobe).toBe("right.frontal.dlpfc");
    expect(r.param.path).toBe("right.frontal.dlpfc");
    expect(r.param.drawn).toBe(false);
    expect(r.param.bg_types).toEqual(["textured"]);
    expect(r.hemisphere).toBe("right");
  });

  it("resolves a Brodmann area to its sub-lobe's row", () => {
    const r = resolveRegion(cat, id("right.frontal.ba46"), 7)!;
    expect(r.param.path).toBe("right.frontal.ba46");
    expect(r.param.sublobe).toBe("right.frontal.dlpfc");
    expect(r.param.drawn).toBe(false);
  });

  it("a lobe draws one of its sub-lobes from the seed", () => {
    const a = resolveRegion(cat, id("right.frontal"), 42)!;
    expect(a.param.drawn).toBe(true);
    expect(a.param.path).toBe("right.frontal");
    expect(resolveRegion(cat, id("right.frontal"), 42)!.param.sublobe).toBe(a.param.sublobe);
    const seen = new Set<string>();
    for (let s = 1; s <= 200; s++) seen.add(resolveRegion(cat, id("right.frontal"), s)!.param.sublobe);
    expect([...seen].sort()).toEqual(["right.frontal.dlpfc", "right.frontal.orbitofrontal"]);
  });

  it("a warm row runs as the left hemisphere", () => {
    let found = false;
    for (let s = 1; s <= 200; s++) {
      const r = resolveRegion(cat, id("right.subcortical"), s)!;
      expect(r.hemisphere).toBe(r.param.sublobe === "right.subcortical.cerebellum" ? "left" : "right");
      if (r.param.sublobe === "right.subcortical.cerebellum") found = true;
    }
    expect(found).toBe(true);
  });

  it("returns null for a region a game can't use", () => {
    expect(resolveRegion(cat, id("right.frontal.ba44"), 1)).toBeNull();
    expect(resolveRegion(cat, id("right.occipital"), 1)).toBeNull();
  });
});

describe("gameRegionError", () => {
  it("says which regions games can use", () => {
    expect(gameRegionError(cat, id("right.frontal.ba44"))).toBe("not_for_games");
    expect(gameRegionError(cat, id("right.occipital"))).toBe("not_for_games");
    expect(gameRegionError(cat, id("right.occipital.ba17"))).toBe("not_for_games");
    expect(gameRegionError(cat, id("right"))).toBe("not_for_games");
    expect(gameRegionError(cat, "0192f3a4-5b6c-7d8e-9f01-23456789abcd")).toBe("unknown");
    expect(gameRegionError(cat, id("right.frontal.dlpfc"))).toBeNull();
    expect(gameRegionError(cat, id("right.frontal.ba46"))).toBeNull();
    expect(gameRegionError(cat, id("right.frontal"))).toBeNull();
  });
});

describe("seededIndex", () => {
  it("stays in range and is deterministic", () => {
    for (const k of [1, 2, 7]) {
      for (let s = 0; s < 100; s++) {
        const i = seededIndex(s, "bg", k);
        expect(i).toBeGreaterThanOrEqual(0);
        expect(i).toBeLessThan(k);
        expect(seededIndex(s, "bg", k)).toBe(i);
      }
    }
  });
});

describe("tableConsistencyErrors", () => {
  it("accepts the cold/west/clockwise and warm/east/counter-clockwise patterns", () => {
    expect(tableConsistencyErrors([{ path: "a", ...cold() }, { path: "b", ...warm() }])).toEqual([]);
  });

  it("names a row that breaks the pattern", () => {
    const e1 = tableConsistencyErrors([{ path: "right.x", ...cold({ target_locations: ["E"] }) }]);
    expect(e1).toHaveLength(1);
    expect(e1[0]).toContain("right.x");
    expect(tableConsistencyErrors([{ path: "left.y", ...cold({ rotation: "ccw" }) }])[0]).toContain("left.y");
    expect(tableConsistencyErrors([{ path: "left.z", ...warm({ target_locations: ["W"] }) }])[0]).toContain("left.z");
  });
});

describe("ageBand (picture-line game spec 2026-11-10)", () => {
  it("bands a child's age on a given day, 12 years when unknown", async () => {
    const { ageBand } = await import("../src/index.ts");
    const on = new Date("2026-11-10T12:00:00Z");
    expect(ageBand("2019-11-11", on)).toBe("4-6"); // 6 years 364 days
    expect(ageBand("2019-11-10", on)).toBe("7-9"); // 7 today
    expect(ageBand("2016-11-11", on)).toBe("7-9");
    expect(ageBand("2016-11-10", on)).toBe("10-12");
    expect(ageBand("2014-11-10", on)).toBe("10-12"); // 12
    expect(ageBand("2013-11-10", on)).toBe("13+");
    expect(ageBand("2023-01-01", on)).toBe("4-6"); // younger children use the youngest set
    expect(ageBand(null, on)).toBe("10-12");
  });
});
