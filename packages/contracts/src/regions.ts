/**
 * Brain-region filters (spec 2026-11-09-brain-region-filters-design.md). Pure: no clock, no I/O.
 * Shared by the API (launch parameters, step validation) and the app (protocol builder, demo).
 *
 * The product owner's table is the absolute truth: a step filtered to a lobe, sub-lobe or Brodmann area runs with
 * the table's row for that sub-lobe. A lobe with no sub-lobe chosen draws one of its sub-lobes per launch, from the
 * launch's seed. The row's background colour decides the hemisphere the game runs as (cold → right, warm → left).
 */
import type { BrainRegion } from "./videos.ts";

export type Direction = "ltr" | "rtl" | "ttb" | "btt" | "tldbr" | "brdtl" | "trdbl" | "bldtr";
export const DIRECTIONS: Direction[] = ["ltr", "rtl", "ttb", "btt", "tldbr", "brdtl", "trdbl", "bldtr"];
export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export const COMPASS: Compass[] = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];

export interface RegionSettingView {
  bg_temperature: "warm" | "cold";
  bg_types: ("solid" | "textured")[];
  motion: { movement_types: number[]; directions: Direction[] }[];
  target_locations: Compass[];
  rotation: "cw" | "ccw";
  clinical_status: "draft" | "approved";
  revision: number;
}

/** The `region` platform parameter: the chosen node, the sub-lobe whose row applies, and that row. */
export interface RegionParam extends RegionSettingView {
  path: string;
  sublobe: string;
  /** True when `path` is a lobe and this launch's sub-lobe was drawn from it. */
  drawn: boolean;
}

export interface RegionCatalog {
  byId: Map<string, BrainRegion>;
  byPath: Map<string, BrainRegion>;
  children: Map<string, BrainRegion[]>;
}

export function regionCatalog(regions: BrainRegion[]): RegionCatalog {
  const byId = new Map<string, BrainRegion>();
  const byPath = new Map<string, BrainRegion>();
  const children = new Map<string, BrainRegion[]>();
  for (const r of regions) {
    byId.set(r.id, r);
    byPath.set(r.path, r);
  }
  for (const r of [...regions].sort((a, b) => a.sort - b.sort || a.path.localeCompare(b.path))) {
    if (!r.parent_id) continue;
    const list = children.get(r.parent_id) ?? [];
    list.push(r);
    children.set(r.parent_id, list);
  }
  return { byId, byPath, children };
}

export const hemisphereForSetting = (s: Pick<RegionSettingView, "bg_temperature">): "left" | "right" => (s.bg_temperature === "cold" ? "right" : "left");
export const sideOf = (r: Pick<BrainRegion, "path">): "left" | "right" => (r.path.split(".")[0] === "right" ? "right" : "left");

/** The sub-lobes with a settings row under a lobe, in display order. */
export function lobeSublobes(cat: RegionCatalog, lobeId: string): BrainRegion[] {
  return (cat.children.get(lobeId) ?? []).filter((c) => c.kind === "sublobe" && c.setting !== null);
}

/** The sub-lobes a node can run as: one for a sub-lobe or linked area, several for a lobe, none otherwise. */
export function sublobesFor(cat: RegionCatalog, id: string): BrainRegion[] {
  const r = cat.byId.get(id);
  if (!r) return [];
  if (r.kind === "sublobe") return r.setting ? [r] : [];
  if (r.kind === "area") {
    const s = r.sublobe_id ? cat.byId.get(r.sublobe_id) : undefined;
    return s?.setting ? [s] : [];
  }
  if (r.kind === "lobe") return lobeSublobes(cat, r.id);
  return [];
}

export function gameRegionError(cat: RegionCatalog, id: string): null | "unknown" | "not_for_games" {
  if (!cat.byId.has(id)) return "unknown";
  return sublobesFor(cat, id).length > 0 ? null : "not_for_games";
}

/** Deterministic 0 ≤ i < n from a seed and a salt (FNV-1a of the salt, xor the seed, one mulberry32 step). */
export function seededIndex(seed: number, salt: string, n: number): number {
  if (n <= 1) return 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  let t = ((h ^ seed) + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const x = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return Math.min(n - 1, Math.floor(x * n));
}

export function resolveRegion(cat: RegionCatalog, id: string, seed: number): { param: RegionParam; hemisphere: "left" | "right" } | null {
  const node = cat.byId.get(id);
  const options = sublobesFor(cat, id);
  if (!node || options.length === 0) return null;
  const drawn = node.kind === "lobe";
  const sub = drawn ? options[seededIndex(seed, node.path, options.length)]! : options[0]!;
  const s = sub.setting!;
  const param: RegionParam = {
    path: node.path,
    sublobe: sub.path,
    drawn,
    bg_temperature: s.bg_temperature,
    bg_types: [...s.bg_types],
    motion: s.motion.map((m) => ({ movement_types: [...m.movement_types], directions: [...m.directions] })),
    target_locations: [...s.target_locations],
    rotation: s.rotation,
    clinical_status: s.clinical_status,
    revision: s.revision,
  };
  return { param, hemisphere: hemisphereForSetting(s) };
}

const WEST: ReadonlySet<Compass> = new Set(["N", "S", "W", "SW", "NW"]);
const EAST: ReadonlySet<Compass> = new Set(["N", "S", "E", "SE", "NE"]);

/**
 * The table's pattern, which lets the background colour decide the hemisphere: a cold row places objects on the
 * west side and turns clockwise; a warm row the east side and counter-clockwise. Returns one message per row that breaks it.
 */
export function tableConsistencyErrors(rows: Array<{ path: string } & Pick<RegionSettingView, "bg_temperature" | "target_locations" | "rotation">>): string[] {
  const out: string[] = [];
  for (const r of rows) {
    const side = r.bg_temperature === "cold" ? WEST : EAST;
    const rot = r.bg_temperature === "cold" ? "cw" : "ccw";
    const bad = r.target_locations.filter((t) => !side.has(t));
    if (bad.length || r.rotation !== rot)
      out.push(`${r.path}: ${r.bg_temperature} row needs targets in ${[...side].join("/")} and rotation ${rot} (has ${r.target_locations.join(",")}; ${r.rotation})`);
  }
  return out;
}
