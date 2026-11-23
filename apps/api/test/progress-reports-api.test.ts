/**
 * Progress reports (migration 0042): a therapist issues a report with a written summary; it is stored as issued,
 * read only by those who may see the patient, and by the family once shared. All people here are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("progress reports", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let miri: { api: Api; userId: string }; // a parent
  let other: { api: Api; userId: string }; // another parent
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const patient = randomUUID();
  let step = "";
  const today = new Date().toISOString().slice(0, 10);
  const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

  const played = async (days: number, accuracy: number, opts: { location?: string; review?: string; difficulty?: number } = {}) =>
    (
      await env.db.query<{ id: string }>(
        `INSERT INTO app.game_session (id, patient_id, clinic_id, recorded_by, game_id, game_version, location, status, end_reason, session_mode, difficulty, hemisphere, ended_at, active_ms, accuracy, review_reason)
         VALUES (app.uuidv7(), $1, $2, $3, 'catch-me-if-you-can', '1.0.0', $4, 'completed', 'completed', 'timed_lives', $5, 'left', now() - make_interval(days => $6::int) - interval '1 hour', 600000, $7, $8) RETURNING id`,
        [patient, ids.clinic, yael.userId, opts.location ?? "clinic", opts.difficulty ?? 2, days, accuracy, opts.review ?? null],
      )
    ).rows[0]!.id;

  const body = (over: Record<string, unknown> = {}) => ({ from: daysAgo(30), to: today, audience: "formal", locale: "en", summary: "Dana took part in every planned session.", ...over });

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    noam = await staffClient(env, "noam@synthetic.test", "Noam Cohen");
    miri = await staffClient(env, "miri@synthetic.test", "Miri Katz");
    other = await staffClient(env, "other@synthetic.test", "Other Parent");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noam.userId, ids.org, ids.clinic, "therapist");
    await env.db.query(`UPDATE app.clinic SET address = '1 Example St, Tel Aviv', phone = '+972 3 000 0000', license_no = 'LIC-0001' WHERE id = $1`, [ids.clinic]);
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Dana','Katz','2018-03-01','active')`, [patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const a = await env.db.query<{ id: string }>(`INSERT INTO app.protocol_assignment (patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,'Attention', CURRENT_DATE - 60, 12, 3) RETURNING id`, [patient, ids.clinic, yael.userId]);
    step = (
      await env.db.query<{ id: string }>(
        `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice) VALUES ($1,$2,1,'catch-me-if-you-can','timed_lives',300,3,2,2,'left','left','auto') RETURNING id`,
        [a.rows[0]!.id, patient],
      )
    ).rows[0]!.id;
    // Before the period: the two sessions that set the child's own baseline.
    await played(50, 0.5);
    await played(48, 0.5);
    // In the period: four counted sessions (one at home, the last a level up) and one that doesn't count yet.
    await played(20, 0.55);
    await played(15, 0.6, { location: "home" });
    const s3 = await played(10, 0.65);
    await played(5, 0.7, { difficulty: 3 });
    await played(4, 0.1, { review: "consent_withdrawn" });
    await env.db.query(
      `INSERT INTO app.progression_decision (assignment_step_id, patient_id, game_session_id, decided_at, action, from_difficulty, to_difficulty, inputs, reason) VALUES ($1,$2,$3, now() - interval '10 days', 'up', 2, 3, '{}', 'rule')`,
      [step, patient, s3],
    );
    for (const [i, [days, status]] of ([[20, "done"], [15, "done"], [12, "missed"], [10, "done"], [5, "done"], [40, "done"]] as const).entries())
      await env.db.query(`INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date, status) VALUES ($1,$2,$3,$4,1, CURRENT_DATE - $5::int, $6)`, [a.rows[0]!.id, patient, ids.clinic, i + 1, days, status]);
    // Miri is Dana's guardian with a portal account; the other parent is nobody's here.
    const g = await env.db.query<{ id: string }>(`INSERT INTO app.guardian (clinic_id, full_name, phone, created_by, user_id) VALUES ($1,'Miri Katz','+972 50 000 0000',$2,$3) RETURNING id`, [ids.clinic, yael.userId, miri.userId]);
    await env.db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) VALUES ($1,$2,'mother',true)`, [g.rows[0]!.id, patient]);
  });
  afterAll(async () => env?.close());

  let reportId = "";

  it("a therapist issues a report: the summary and the figures for the period are stored with it", async () => {
    const res = await yael.api(`/v1/patients/${patient}/progress-reports`, { method: "POST", body: body() });
    expect(res.status).toBe(201);
    const r = res.body.report;
    reportId = r.id;
    expect(r).toMatchObject({ patient_id: patient, audience: "formal", locale: "en", period_from: daysAgo(30), period_to: today, shared_with_family: false, author_name: "Yael Bar", summary: "Dana took part in every planned session." });
    expect(r.data.patient).toEqual({ given_name: "Dana", family_name: "Katz", date_of_birth: "2018-03-01" });
    expect(r.data.clinic).toEqual({ name: "Tel Aviv", address: "1 Example St, Tel Aviv", phone: "+972 3 000 0000", license_no: "LIC-0001" });
    expect(r.data.author).toEqual({ name: "Yael Bar" });
    // Four counted sessions of ten minutes; the flagged one and the two before the period are out.
    expect(r.data.totals).toEqual({ sessions: 4, minutes: 40, days_active: 4, clinic_sessions: 3, home_sessions: 1 });
    expect(r.data.plan).toEqual({ planned: 5, done: 4, missed: 1 });
    expect(r.data.activities).toEqual([{ game_id: "catch-me-if-you-can", sessions: 4, avg_accuracy: 0.625, first_difficulty: 2, last_difficulty: 3 }]);
    // Scored against the child's own first sessions (0.5), which were before the period.
    expect(r.data.trend.points.map((p: { score: number }) => p.score).slice(0, 3)).toEqual([110, 120, 130]);
    expect(r.data.trend.points).toHaveLength(4);
    expect(r.data.changes).toMatchObject([{ game_id: "catch-me-if-you-can", action: "up", from: 2, to: 3 }]);
  });

  it("lists the patient's reports and reads one back, recording the read", async () => {
    const list = await yael.api(`/v1/patients/${patient}/progress-reports`);
    expect(list.status).toBe(200);
    expect(list.body.reports).toHaveLength(1);
    expect(list.body.reports[0]).toMatchObject({ id: reportId, author_name: "Yael Bar" });
    expect(list.body.reports[0].data).toBeUndefined();

    const one = await yael.api(`/v1/progress-reports/${reportId}`);
    expect(one.status).toBe(200);
    expect(one.body.report.data.totals.sessions).toBe(4);
    const audit = await env.db.query(`SELECT 1 FROM app.audit_event WHERE action = 'view' AND resource_type = 'progress_report' AND resource_id = $1 AND actor_user_id = $2`, [reportId, yael.userId]);
    expect(audit.rowCount).toBe(1);
  });

  it("keeps the report as issued when results arrive later", async () => {
    await played(1, 0.9);
    const one = await yael.api(`/v1/progress-reports/${reportId}`);
    expect(one.body.report.data.totals.sessions).toBe(4);
    const fresh = await yael.api(`/v1/patients/${patient}/progress-reports`, { method: "POST", body: body({ audience: "family", summary: "" }) });
    expect(fresh.body.report.data.totals.sessions).toBe(5);
  });

  it("an issued report cannot be rewritten or removed, whoever tries", async () => {
    await expect(env.db.query(`UPDATE app.progress_report SET summary = 'changed' WHERE id = $1`, [reportId])).rejects.toThrow(/append-only/);
    await expect(env.db.query(`UPDATE app.progress_report SET data = '{}' WHERE id = $1`, [reportId])).rejects.toThrow(/append-only/);
    await expect(env.db.query(`DELETE FROM app.progress_report WHERE id = $1`, [reportId])).rejects.toThrow(/append-only/);
  });

  it("refuses dates, audiences and summaries it can't use", async () => {
    const post = (over: Record<string, unknown>) => yael.api(`/v1/patients/${patient}/progress-reports`, { method: "POST", body: body(over) });
    expect((await post({ from: today, to: daysAgo(3) })).status).toBe(400);
    expect((await post({ from: "2024-01-01" })).status).toBe(400); // more than a year
    expect((await post({ from: "yesterday" })).status).toBe(400);
    expect((await post({ audience: "everyone" })).status).toBe(400);
    expect((await post({ locale: "fr" })).status).toBe(400);
    expect((await post({ summary: "x".repeat(2001) })).status).toBe(400);
  });

  it("a colleague who isn't on the care team can neither issue nor read", async () => {
    expect((await noam.api(`/v1/patients/${patient}/progress-reports`, { method: "POST", body: body() })).status).toBe(404);
    expect((await noam.api(`/v1/patients/${patient}/progress-reports`)).status).toBe(404);
    expect((await noam.api(`/v1/progress-reports/${reportId}`)).status).toBe(404);
    expect((await noam.api(`/v1/progress-reports/${reportId}`, { method: "PATCH", body: { shared_with_family: true } })).status).toBe(404);
  });

  it("the family sees a report only once it is shared, and only their own child's", async () => {
    expect((await miri.api(`/v1/parent/children/${patient}/reports`)).body.reports).toEqual([]);
    expect((await miri.api(`/v1/parent/reports/${reportId}`)).status).toBe(404);

    const shared = await yael.api(`/v1/progress-reports/${reportId}`, { method: "PATCH", body: { shared_with_family: true } });
    expect(shared.status).toBe(200);
    expect(shared.body.report.shared_with_family).toBe(true);

    const list = await miri.api(`/v1/parent/children/${patient}/reports`);
    expect(list.body.reports.map((r: { id: string }) => r.id)).toEqual([reportId]);
    const one = await miri.api(`/v1/parent/reports/${reportId}`);
    expect(one.status).toBe(200);
    expect(one.body.report.summary).toBe("Dana took part in every planned session.");

    expect((await other.api(`/v1/parent/children/${patient}/reports`)).body.reports).toEqual([]);
    expect((await other.api(`/v1/parent/reports/${reportId}`)).status).toBe(404);

    await yael.api(`/v1/progress-reports/${reportId}`, { method: "PATCH", body: { shared_with_family: false } });
    expect((await miri.api(`/v1/parent/reports/${reportId}`)).status).toBe(404);
  });

  it("a platform admin sets the clinic details a letterhead needs", async () => {
    const admin = (await platformAdmin(env)).api;
    const res = await admin(`/v1/admin/clinics/${ids.clinic}`, { method: "PATCH", body: { address: " 2 New Rd ", phone: "", license_no: "LIC-2" } });
    expect(res.status).toBe(200);
    expect(res.body.clinic).toMatchObject({ address: "2 New Rd", phone: null, license_no: "LIC-2" });
  });
});
