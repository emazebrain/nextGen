/**
 * The brain-region tree for the demo and tests, built from the same data the database is seeded from
 * (`@emb/db/brain-regions`, `@emb/db/region-settings`; migrations 0010 and 0018). Ids are stable: the original tree
 * keeps the ids it always had in the demo, and the nodes 0018 adds come after them. Retired nodes (the old cerebellum
 * lobe) are left out, as the API leaves them out.
 */
import type { BrainRegion, RegionSettingView } from "@emb/contracts";
import { AREAS, AREA_SUBLOBE, HEMISPHERES, LOBES, SUBCORTICAL, SUBLOBES } from "@emb/db/brain-regions";
import { REGION_SETTINGS } from "@emb/db/region-settings";

const id = (n: number) => `0192f3a0-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

export function demoRegions(lang: string): BrainRegion[] {
  const out: BrainRegion[] = [];
  const label = (x: { en: string; he: string }) => (lang === "he" ? x.he : x.en);
  const node = (n: number, kind: BrainRegion["kind"], code: string, path: string, parent: string | null, l: { en: string; he: string }, sort: number): BrainRegion => ({
    id: id(n), kind, code, path, parent_id: parent, label: label(l), sort, sublobe_id: null, setting: null,
  });
  let n = 0;
  const lobeIds = new Map<string, string>();
  HEMISPHERES.forEach((h, hi) => {
    const hid = id(++n);
    out.push(node(n, "hemisphere", h.code, h.code, null, h, hi + 1));
    LOBES.forEach((l, li) => {
      const lid = id(++n);
      const retired = l.code === "cerebellum";
      if (!retired) out.push(node(n, "lobe", l.code, `${h.code}.${l.code}`, hid, l, li + 1));
      lobeIds.set(`${h.code}.${l.code}`, lid);
      AREAS.filter((a) => a.lobe === l.code).forEach((a, ai) => {
        ++n;
        if (!retired) out.push(node(n, "area", a.code, `${h.code}.${l.code}.${a.code}`, lid, a, ai + 1));
      });
    });
  });
  // Added by migration 0018: the subcortical lobe, the sub-lobes with their rows, and the Brodmann links.
  for (const h of HEMISPHERES) {
    const hid = out.find((r) => r.path === h.code)!.id;
    ++n;
    out.push(node(n, "lobe", SUBCORTICAL.code, `${h.code}.${SUBCORTICAL.code}`, hid, SUBCORTICAL, LOBES.length + 1));
    lobeIds.set(`${h.code}.${SUBCORTICAL.code}`, id(n));
    SUBLOBES.forEach((s, i) => {
      ++n;
      const row = REGION_SETTINGS.find((r) => r.side === h.code && r.sublobe === s.code);
      const setting: RegionSettingView | null = row
        ? { bg_temperature: row.bg_temperature, bg_types: row.bg_types, motion: row.motion, target_locations: row.target_locations, rotation: row.rotation, clinical_status: "draft", revision: 1 }
        : null;
      out.push({ ...node(n, "sublobe", s.code, `${h.code}.${s.lobe}.${s.code}`, lobeIds.get(`${h.code}.${s.lobe}`)!, s, 100 + i), setting });
    });
    for (const [ba, sub] of Object.entries(AREA_SUBLOBE)) {
      const lobe = AREAS.find((a) => a.code === ba)!.lobe;
      const area = out.find((r) => r.path === `${h.code}.${lobe}.${ba}`)!;
      area.sublobe_id = out.find((r) => r.path === `${h.code}.${lobe}.${sub}`)!.id;
    }
  }
  return out;
}
