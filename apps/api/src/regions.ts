/**
 * The brain-region tree with the product owner's settings rows (spec 2026-11-09, migration 0018), read under the
 * request's user like every other query. Retired nodes (the old cerebellum lobe) are left out.
 */
import type pg from "pg";
import { regionCatalog, type BrainRegion, type RegionCatalog } from "../../../packages/contracts/src/index.ts";
import { pick } from "./modules/videos/routes.ts";

export async function loadRegions(db: pg.PoolClient, lang = "en"): Promise<BrainRegion[]> {
  const { rows } = await db.query<Omit<BrainRegion, "label" | "setting"> & { labels: Record<string, string>; setting: BrainRegion["setting"] }>(
    `SELECT b.id, b.parent_id, b.kind, b.code, b.path, b.labels, b.sort, b.sublobe_id,
            CASE WHEN s.sublobe_id IS NULL THEN NULL ELSE jsonb_build_object(
              'bg_temperature', s.bg_temperature, 'bg_types', to_jsonb(s.bg_types), 'motion', s.motion,
              'target_locations', to_jsonb(s.target_locations), 'rotation', s.rotation,
              'clinical_status', s.clinical_status, 'revision', s.revision) END AS setting
       FROM app.brain_region b LEFT JOIN app.region_setting s ON s.sublobe_id = b.id
      WHERE b.retired_at IS NULL
      ORDER BY b.path`,
  );
  return rows.map(({ labels, ...rest }) => ({ ...rest, label: pick(labels, lang) ?? rest.code }));
}

export async function loadRegionCatalog(db: pg.PoolClient): Promise<RegionCatalog> {
  return regionCatalog(await loadRegions(db));
}
