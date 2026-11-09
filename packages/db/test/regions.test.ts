/** Migration 0018, brain-region filters (spec 2026-11-09): sub-lobes, the settings table, one filter per game step. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { randomUUID } from "node:crypto";
import { copyFile, mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";
import { migrate } from "../src/migrate.ts";
import { regionExpandSql } from "../src/brain-regions.ts";
import { REGION_SETTINGS, settingSeedSql } from "../src/region-settings.ts";

const MIGRATIONS = fileURLToPath(new URL("../migrations/", import.meta.url));
const MIGRATION = join(MIGRATIONS, "0018_brain_region_filters.sql");

const ids = { org: randomUUID(), clinic: randomUUID(), admin: randomUUID(), platformOrg: randomUUID(), yael: randomUUID(), template: randomUUID() };

describe.skipIf(!ADMIN_URL)("brain-region filters (0018)", () => {
  let db: pg.Client;
  let drop: () => Promise<void>;
  const idOf = async (path: string) => (await db.query<{ id: string }>(`SELECT id FROM app.brain_region WHERE path = $1`, [path])).rows[0]!.id;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'eMazeBrain','il'), ($2,'Org','il')`, [ids.platformOrg, ids.org]);
    await db.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$2,'One','IL','Asia/Jerusalem')`, [ids.clinic, ids.org]);
    for (const [id, n] of [[ids.admin, "admin"], [ids.yael, "yael"]] as const)
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$2,'staff','active')`, [id, `${n}@synthetic.test`]);
    await db.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$3,NULL,'platform_admin'), ($2,$4,$5,'therapist')`, [ids.admin, ids.yael, ids.platformOrg, ids.org, ids.clinic]);
    await db.query(`INSERT INTO app.protocol_template (id, name, weeks, sessions_per_week, visibility) VALUES ($1,'T',4,2,'platform')`, [ids.template]);
  });
  afterAll(async () => drop?.());

  it("the migration seeds what the data module generates", async () => {
    const sql = await readFile(MIGRATION, "utf8");
    expect(sql).toContain(regionExpandSql());
    expect(sql).toContain(settingSeedSql(REGION_SETTINGS));
    const count = async (where: string) => (await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.brain_region WHERE ${where}`)).rows[0]!.n;
    expect(await count(`kind = 'sublobe'`)).toBe(20);
    expect(await count(`kind = 'area' AND sublobe_id IS NOT NULL`)).toBe(38);
    expect(await count(`kind = 'lobe' AND code = 'subcortical'`)).toBe(2);
    const settings = await db.query<{ n: number; drafts: number }>(`SELECT count(*)::int AS n, count(*) FILTER (WHERE clinical_status = 'draft' AND revision = 1)::int AS drafts FROM app.region_setting`);
    expect(settings.rows[0]).toEqual({ n: 20, drafts: 20 });
    const st = await db.query(`SELECT s.bg_temperature, s.bg_types, s.target_locations, s.rotation, s.motion FROM app.region_setting s JOIN app.brain_region b ON b.id = s.sublobe_id WHERE b.path = 'right.frontal.dlpfc'`);
    expect(st.rows[0]).toEqual({
      bg_temperature: "cold", bg_types: ["textured"], target_locations: ["W", "SW", "S"], rotation: "cw",
      motion: [{ movement_types: [0, 3], directions: ["ltr", "tldbr"] }, { movement_types: [1], directions: ["rtl", "brdtl"] }],
    });
  });

  it("sub-lobes sit under their lobe and areas link inside their lobe", async () => {
    const r = await db.query<{ parent: string }>(`SELECT p.path AS parent FROM app.brain_region s JOIN app.brain_region p ON p.id = s.parent_id WHERE s.path = 'left.subcortical.pons'`);
    expect(r.rows[0]!.parent).toBe("left.subcortical");
    const linked = await db.query<{ sub: string }>(`SELECT s.path AS sub FROM app.brain_region a JOIN app.brain_region s ON s.id = a.sublobe_id WHERE a.path = 'left.frontal.ba46'`);
    expect(linked.rows[0]!.sub).toBe("left.frontal.dlpfc");
    await expect(db.query(`UPDATE app.brain_region SET sublobe_id = $1 WHERE path = 'left.frontal.ba9'`, [await idOf("left.temporal.superior_temporal")])).rejects.toThrow(/region_sublobe_link/);
    await expect(db.query(`UPDATE app.brain_region SET sublobe_id = $1 WHERE path = 'left.frontal'`, [await idOf("left.frontal.dlpfc")])).rejects.toThrow(/region_sublobe_link/);
  });

  it("the old cerebellum nodes are retired and untagged", async () => {
    const old = await db.query<{ path: string; retired: boolean }>(`SELECT path, retired_at IS NOT NULL AS retired FROM app.brain_region WHERE path IN ('left.cerebellum', 'left.cerebellum.cerebellum') ORDER BY path`);
    expect(old.rows).toEqual([{ path: "left.cerebellum", retired: true }, { path: "left.cerebellum.cerebellum", retired: true }]);
  });

  it("region_setting is read-only for therapists", async () => {
    expect(await asUser(db, ids.yael, async (c) => (await c.query(`SELECT 1 FROM app.region_setting`)).rowCount, { rollback: true })).toBe(20);
    expect(await asUser(db, ids.yael, async (c) => (await c.query(`UPDATE app.region_setting SET rotation = 'ccw'`)).rowCount, { rollback: true })).toBe(0);
    expect(await asUser(db, ids.admin, async (c) => (await c.query(`UPDATE app.region_setting SET revision = revision`)).rowCount, { rollback: true })).toBe(20);
  });

  const insertStep = async (ordinal: number, regionPath: string | null, hemisphere: "left" | "right", stepType: "game" | "video" = "game") =>
    stepType === "game"
      ? db.query(
          `INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s, hemisphere, region_id) VALUES ($1,$2,'catch-me-if-you-can','timed',60,$3,$4)`,
          [ids.template, ordinal, hemisphere, regionPath ? await idOf(regionPath) : null],
        )
      : db.query(`INSERT INTO app.template_step (template_id, ordinal, step_type, video_id, region_id) VALUES ($1,$2,'video',$3,$4)`, [ids.template, ordinal, randomUUID(), regionPath ? await idOf(regionPath) : null]);

  it("a game step accepts a sub-lobe, an area with a sub-lobe and a lobe with rows", async () => {
    await insertStep(1, "right.temporal.superior_temporal", "right");
    await insertStep(2, "right.temporal.ba22", "right");
    await insertStep(3, "left.frontal", "left");
    await insertStep(4, "left.subcortical.cerebellum", "left");
    await insertStep(5, null, "right");
  });

  it("rejects regions a game can't use", async () => {
    await expect(insertStep(10, "right.frontal.ba44", "right")).rejects.toThrow(/step_region_invalid/);
    await expect(insertStep(11, "right.occipital", "right")).rejects.toThrow(/step_region_invalid/);
    await expect(insertStep(12, "right.cerebellum.cerebellum", "right")).rejects.toThrow(/step_region_invalid/);
    await expect(insertStep(13, "right", "right")).rejects.toThrow(/step_region_invalid/);
    await expect(insertStep(14, "right.temporal.superior_temporal", "left")).rejects.toThrow(/step_region_side/);
    await expect(insertStep(15, "left.temporal.superior_temporal", "left", "video")).rejects.toThrow(/step_region_invalid/);
  });
});

describe.skipIf(!ADMIN_URL)("0018 moves old cerebellum tags", () => {
  it("a video tagged on the old cerebellum leaf is tagged on the subcortical cerebellum afterwards", async () => {
    const name = `emb_test_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`CREATE DATABASE ${name}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${name}`;
    const db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    const before = await mkdtemp(join(tmpdir(), "emb-mig-"));
    try {
      for (const f of (await readdir(MIGRATIONS)).filter((f) => f.endsWith(".sql") && f < "0018")) await copyFile(join(MIGRATIONS, f), join(before, f));
      await migrate(db, before);
      const video = randomUUID();
      await db.query(`INSERT INTO app.video (id, source, youtube_id, status) VALUES ($1,'youtube','abcdefghijk','published')`, [video]);
      await db.query(`INSERT INTO app.video_region (video_id, region_id) SELECT $1, id FROM app.brain_region WHERE path IN ('left.cerebellum.cerebellum', 'right.cerebellum')`, [video]);
      await migrate(db);
      const tags = await db.query<{ path: string }>(`SELECT b.path FROM app.video_region vr JOIN app.brain_region b ON b.id = vr.region_id WHERE vr.video_id = $1 ORDER BY b.path`, [video]);
      expect(tags.rows.map((r) => r.path)).toEqual(["left.subcortical.cerebellum", "right.subcortical.cerebellum"]);
    } finally {
      await db.end();
      await rm(before, { recursive: true, force: true });
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    }
  });
});
