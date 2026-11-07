/** Offline devices (spec 2026-11-07-offline-device-design, migration 0011): spaces, ticketed ingest, review reasons. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, asUser, freshDatabase } from "./helpers.ts";

/** A UUIDv7 (game_session ids must be device-generated v7 ids). */
const uuid7 = () => {
  const b = Buffer.from(randomUUID().replace(/-/g, ""), "hex");
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

const ids = {
  org: randomUUID(), one: randomUUID(), two: randomUUID(),
  manager: randomUUID(), a: randomUUID(), b: randomUUID(), c: randomUUID(),
  patient: randomUUID(), assignment: randomUUID(), step: randomUUID(), session: randomUUID(),
  device: randomUUID(), spaceA: randomUUID(), spaceB: randomUUID(), spaceC: randomUUID(),
};

describe.skipIf(!ADMIN_URL)("offline devices", () => {
  let db: pg.Client;
  let drop: () => Promise<void>;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await db.query(`INSERT INTO app.organization (id, name, region) VALUES ($1,'Org','il')`, [ids.org]);
    await db.query(`INSERT INTO app.clinic (id, organization_id, name, country_code, timezone) VALUES ($1,$3,'One','IL','Asia/Jerusalem'), ($2,$3,'Two','IL','Asia/Jerusalem')`, [ids.one, ids.two, ids.org]);
    for (const [id, n] of [[ids.manager, "m"], [ids.a, "a"], [ids.b, "b"], [ids.c, "c"]] as const) {
      await db.query(`INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1,$2,$2,'staff','active')`, [id, `${n}@synthetic.test`]);
    }
    await db.query(
      `INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$5,$6,'clinic_manager'), ($2,$5,$6,'therapist'), ($3,$5,$6,'therapist'), ($4,$5,$7,'therapist')`,
      [ids.manager, ids.a, ids.b, ids.c, ids.org, ids.one, ids.two],
    );
    await db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','active')`, [ids.patient, ids.one]);
    await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.a]);
    await db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`,
      [ids.patient, ids.a],
    );
    await db.query(
      `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,$4,'P','2026-11-01',4,2)`,
      [ids.assignment, ids.patient, ids.one, ids.a],
    );
    await db.query(
      `INSERT INTO app.assignment_step (id, assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, difficulty_start, current_difficulty, hemisphere, timer_position, practice)
       VALUES ($1,$2,$3,1,'tunnel-rush','timed',60,3,3,'left','hidden','off')`,
      [ids.step, ids.assignment, ids.patient],
    );
    await db.query(`INSERT INTO app.planned_session (id, assignment_id, patient_id, clinic_id, seq, week, planned_date) VALUES ($1,$2,$3,$4,1,1,'2026-11-01')`, [ids.session, ids.assignment, ids.patient, ids.one]);
    await db.query(`INSERT INTO app.device (id, outbox_public_key, outbox_secret_enc, created_by) VALUES ($1,'pk','\\x01',$2)`, [ids.device, ids.a]);
    await db.query(
      `INSERT INTO app.device_space (id, device_id, user_id, clinic_id, space_secret_enc) VALUES ($1,$4,$5,$7,'\\x01'), ($2,$4,$6,$7,'\\x01'), ($3,$4,$8,$9,'\\x01')`,
      [ids.spaceA, ids.spaceB, ids.spaceC, ids.device, ids.a, ids.b, ids.one, ids.c, ids.two],
    );
  });
  afterAll(async () => drop?.());

  const row = () => ({
    id: uuid7(), patient_id: ids.patient, assignment_step_id: ids.step, planned_session_id: ids.session,
    game_id: "tunnel-rush", game_version: "2.0.0", status: "completed", end_reason: "time_up", session_mode: "timed",
    difficulty: 3, hemisphere: "left", started_at: "2026-11-02T10:00:00Z", ended_at: "2026-11-02T10:01:00Z", active_ms: 60000,
    review_reason: null,
  });

  it("a therapist sees only their own spaces; a manager sees and ends their clinic's", async () => {
    const seen = (u: string) => asUser(db, u, async (c) => (await c.query(`SELECT id FROM app.device_space`)).rowCount, { rollback: true });
    expect(await seen(ids.a)).toBe(1);
    expect(await seen(ids.manager)).toBe(2);
    const end = (u: string, id: string) => asUser(db, u, async (c) => (await c.query(`UPDATE app.device_space SET ended_at = now(), ended_by = $2 WHERE id = $1`, [id, u])).rowCount, { rollback: true });
    expect(await end(ids.manager, ids.spaceB)).toBe(1);
    expect(await end(ids.manager, ids.spaceC)).toBe(0);
    expect(await end(ids.a, ids.spaceB)).toBe(0);
  });

  it("ticketed ingest stores a result for a patient the uploader can't see, credited to the therapist", async () => {
    const r = row();
    const got = await asUser(db, ids.b, async (c) => {
      await c.query(`SELECT app.act_for_ticket($1, $2)`, [ids.a, ids.device]);
      return (await c.query<{ id: string }>(`SELECT app.ingest_game_session($1::jsonb) AS id`, [JSON.stringify(r)])).rows[0]!.id;
    });
    expect(got).toBe(r.id);
    const stored = await db.query(`SELECT recorded_by, uploaded_by, clinic_id FROM app.game_session WHERE id = $1`, [r.id]);
    expect(stored.rows[0]).toEqual({ recorded_by: ids.a, uploaded_by: ids.b, clinic_id: ids.one });
    // The same id again: nothing new.
    const again = await asUser(db, ids.b, async (c) => {
      await c.query(`SELECT app.act_for_ticket($1, $2)`, [ids.a, ids.device]);
      return (await c.query<{ id: string | null }>(`SELECT app.ingest_game_session($1::jsonb) AS id`, [JSON.stringify(r)])).rows[0]!.id;
    });
    expect(again).toBeNull();
  });

  it("ticketed ingest refuses an uploader with no space on the ticket's device", async () => {
    await expect(asUser(db, ids.manager, (c) => c.query(`SELECT app.act_for_ticket($1, $2)`, [ids.a, ids.device]))).rejects.toThrow(/ticketed_ingest_forbidden/);
    await expect(asUser(db, ids.b, (c) => c.query(`SELECT app.ingest_game_session($1::jsonb)`, [JSON.stringify(row())]))).rejects.toThrow(/ticketed_ingest_forbidden/);
  });

  it("review reasons: consent withdrawn first, then care team", async () => {
    const reason = (therapist: string) =>
      db.query<{ r: string | null }>(`SELECT app.review_reason_for($1,$2,$3,$4) AS r`, [ids.patient, therapist, ids.step, ids.session]).then((x) => x.rows[0]!.r);
    expect(await reason(ids.a)).toBeNull();
    expect(await reason(ids.b)).toBe("not_on_care_team");
    expect(await reason(ids.c)).toBe("membership_ended");
    await db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','withdrawn','v1','in_clinic_esign',$2,'\\x00')`,
      [ids.patient, ids.a],
    );
    expect(await reason(ids.a)).toBe("consent_withdrawn");
    expect(await reason(ids.b)).toBe("consent_withdrawn");
  });

  it("result reviews are append-only", async () => {
    const gs = (await db.query<{ id: string }>(`SELECT id FROM app.game_session LIMIT 1`)).rows[0]!.id;
    await asUser(db, ids.manager, (c) => c.query(`INSERT INTO app.result_review (game_session_id, decision, decided_by) VALUES ($1,'accept',$2)`, [gs, ids.manager]));
    await expect(db.query(`UPDATE app.result_review SET decision = 'exclude'`)).rejects.toThrow(/append-only/);
    await expect(db.query(`DELETE FROM app.result_review`)).rejects.toThrow(/append-only/);
  });
});
