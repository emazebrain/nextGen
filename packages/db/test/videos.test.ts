/** Video library (design doc §7 brain_region / video / video_view, ADR 0018): who writes, who reads, and what a step may hold. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";
import { AREAS } from "../src/brain-regions.ts";

const ids = {
  platformOrg: randomUUID(), org: randomUUID(), clinic: randomUUID(), other: randomUUID(),
  admin: randomUUID(), yael: randomUUID(), outsider: randomUUID(),
  patient: randomUUID(), template: randomUUID(), assignment: randomUUID(), astep: randomUUID(), session: randomUUID(),
  published: randomUUID(), draft: randomUUID(),
};

describe.skipIf(!ADMIN_URL)("video library", () => {
  let db: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'eMazeBrain','il'), ($2,'Org','il')`, [ids.platformOrg, ids.org]);
    await db.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$3,'One','IL','Asia/Jerusalem'), ($2,$3,'Two','IL','Asia/Jerusalem')`, [ids.clinic, ids.other, ids.org]);
    for (const [id, n] of [[ids.admin, "admin"], [ids.yael, "yael"], [ids.outsider, "o"]] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$2,'staff','active')`, [id, `${n}@synthetic.test`]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$4,NULL,'platform_admin'), ($2,$5,$6,'therapist'), ($3,$5,$7,'therapist')`,
      [ids.admin, ids.yael, ids.outsider, ids.platformOrg, ids.org, ids.clinic, ids.other],
    );
    await db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','active')`, [ids.patient, ids.clinic]);
    await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.yael]);
  });
  afterAll(async () => drop?.());

  const addVideo = (c: pg.Client, id: string, status: string) =>
    c.query(`INSERT INTO app.video (id, source, youtube_id, status, created_by) VALUES ($1,'youtube','abcdefghijk',$2,app.current_user_id())`, [id, status]);

  it("seeds the Brodmann tree for both hemispheres", async () => {
    const { rows } = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.brain_region WHERE kind = 'area'`);
    expect(rows[0]!.n).toBe(2 * AREAS.length);
    const ba44 = await db.query<{ path: string; label: string }>(`SELECT path, labels->>'he' AS label FROM app.brain_region WHERE code = 'ba44' AND path LIKE 'left.%'`);
    expect(ba44.rows[0]).toEqual({ path: "left.frontal.ba44", label: expect.stringContaining("ברודמן") });
    const orphans = await db.query(`SELECT 1 FROM app.brain_region WHERE kind <> 'hemisphere' AND parent_id IS NULL`);
    expect(orphans.rowCount).toBe(0);
  });

  it("only platform admins write videos", async () => {
    await expect(asUser(db, ids.yael, (c) => addVideo(c, randomUUID(), "published"))).rejects.toThrow(/row-level security/);
    await asUser(db, ids.admin, async (c) => {
      await addVideo(c, ids.published, "published");
      await addVideo(c, ids.draft, "draft");
      await c.query(`INSERT INTO app.video_i18n (video_id, locale, title) VALUES ($1,'en','Calm breathing')`, [ids.published]);
      const area = await c.query<{ id: string }>(`SELECT id FROM app.brain_region WHERE path = 'left.frontal.ba44'`);
      await c.query(`INSERT INTO app.video_region (video_id, region_id) VALUES ($1,$2)`, [ids.published, area.rows[0]!.id]);
    });
    await expect(asUser(db, ids.yael, (c) => c.query(`UPDATE app.video SET status = 'archived' WHERE id = $1`, [ids.published]).then((r) => r.rowCount))).resolves.toBe(0);
    await expect(asUser(db, ids.yael, (c) => c.query(`INSERT INTO app.video_i18n (video_id, locale, title) VALUES ($1,'he','x')`, [ids.published]))).rejects.toThrow(/row-level security/);
  });

  it("staff see published videos only; admins see all", async () => {
    const count = (user: string) => asUser(db, user, async (c) => (await c.query(`SELECT 1 FROM app.video`)).rowCount, { rollback: true });
    expect(await count(ids.yael)).toBe(1);
    expect(await count(ids.admin)).toBe(2);
    expect(await asUser(db, "", async (c) => (await c.query(`SELECT 1 FROM app.video`)).rowCount, { rollback: true })).toBe(0);
  });

  it("a step holds exactly one of a game and a video", async () => {
    await db.query(`INSERT INTO app.protocol_template (id, name, weeks, sessions_per_week, visibility) VALUES ($1,'T',4,2,'platform')`, [ids.template]);
    await db.query(`INSERT INTO app.template_step (template_id, ordinal, step_type, video_id) VALUES ($1,1,'video',$2)`, [ids.template, ids.published]);
    await expect(
      db.query(`INSERT INTO app.template_step (template_id, ordinal, step_type, video_id, game_id, session_mode, duration_s) VALUES ($1,2,'video',$2,'tunnel-rush','timed',60)`, [ids.template, ids.published]),
    ).rejects.toThrow(/step_mode_fields/);
    await expect(db.query(`INSERT INTO app.template_step (template_id, ordinal, step_type, game_id) VALUES ($1,3,'game','tunnel-rush')`, [ids.template])).rejects.toThrow(/step_mode_fields/);
    // Older app versions never send step_type: their game steps still go in.
    await db.query(`INSERT INTO app.template_step (template_id, ordinal, game_id, session_mode, duration_s) VALUES ($1,4,'tunnel-rush','timed',60)`, [ids.template]);
  });

  it("video views follow the patient and are append-only", async () => {
    await db.query(
      `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,$4,'P','2026-11-01',4,2)`,
      [ids.assignment, ids.patient, ids.clinic, ids.yael],
    );
    await db.query(
      `INSERT INTO app.assignment_step (id, assignment_id, patient_id, ordinal, step_type, video_id, difficulty_start, current_difficulty, hemisphere, timer_position, practice)
       VALUES ($1,$2,$3,1,'video',$4,3,3,'left','hidden','off')`,
      [ids.astep, ids.assignment, ids.patient, ids.published],
    );
    await db.query(`INSERT INTO app.planned_session (id, assignment_id, patient_id, clinic_id, seq, week, planned_date) VALUES ($1,$2,$3,$4,1,1,'2026-11-01')`, [ids.session, ids.assignment, ids.patient, ids.clinic]);
    const view = (user: string) =>
      asUser(db, user, (c) =>
        c.query(
          `INSERT INTO app.video_view (client_view_id, planned_session_id, assignment_step_id, patient_id, clinic_id, video_id, video_version, started_at, ended_at, watched_s, completed, recorded_by)
           VALUES ($1,$2,$3,$4,$5,$6,1,now() - interval '1 minute',now(),60,true,app.current_user_id())`,
          [randomUUID(), ids.session, ids.astep, ids.patient, ids.clinic, ids.published],
        ),
      );
    await view(ids.yael);
    await expect(view(ids.outsider)).rejects.toThrow(/row-level security/);
    expect(await asUser(db, ids.outsider, async (c) => (await c.query(`SELECT 1 FROM app.video_view`)).rowCount, { rollback: true })).toBe(0);
    expect(await asUser(db, ids.yael, async (c) => (await c.query(`SELECT 1 FROM app.video_view`)).rowCount, { rollback: true })).toBe(1);
    await expect(db.query(`UPDATE app.video_view SET watched_s = 1`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM app.video_view`)).rejects.toThrow(/append-only/);
  });

  it("an assignment keeps playing a video after it is archived", async () => {
    await asUser(db, ids.admin, (c) => c.query(`UPDATE app.video SET status = 'archived' WHERE id = $1`, [ids.published]));
    const seen = await asUser(db, ids.yael, async (c) => (await c.query(`SELECT id FROM app.video WHERE id = $1`, [ids.published])).rowCount, { rollback: true });
    expect(seen).toBe(1);
    // The platform template from the step test also uses it, so everyone may still read it until that step goes.
    expect(await asUser(db, ids.outsider, async (c) => (await c.query(`SELECT id FROM app.video WHERE id = $1`, [ids.published])).rowCount, { rollback: true })).toBe(1);
    await db.query(`DELETE FROM app.template_step WHERE template_id = $1`, [ids.template]);
    const other = await asUser(db, ids.outsider, async (c) => (await c.query(`SELECT id FROM app.video WHERE id = $1`, [ids.published])).rowCount, { rollback: true });
    expect(other).toBe(0);
  });
});
