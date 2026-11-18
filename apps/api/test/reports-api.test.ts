/**
 * Reports dashboard and cross-patient review queue API tests (design doc §5.9).
 *
 * Verifies:
 * - GET /v1/review-queue returns flagged, undecided sessions the caller can treat
 * - GET /v1/reports/summary returns aggregate tiles scoped by RLS
 * - GET /v1/reports/sessions-over-time returns time-bucketed counts
 * - GET /v1/reports/activity-breakdown returns per-game aggregate stats
 * - Cross-therapist isolation (Noam sees nothing of Yael's caseload)
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { allowedParamsFor, OFFLINE_TICKET_TTL_S } from "../src/modules/sessions/routes.ts";
import { envelope, step } from "./offline-fixture.ts";

describe.skipIf(!ADMIN_URL)("reports & review queue", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const device = randomUUID();

  /** Create a patient with a consent-withdrawn flagged result. */
  const flaggedPatient = async (givenName = "Noa", familyName = "Levi") => {
    const patient = randomUUID();
    await env.db.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,$3,$4,'2018-03-01','pending_consent')`,
      [patient, ids.clinic, givenName, familyName],
    );
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const g = await yael.api(`/v1/patients/${patient}/guardians`, {
      method: "POST",
      body: { full_name: `${givenName} Parent`, relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" },
    });
    await yael.api(`/v1/patients/${patient}/consents`, {
      method: "POST",
      body: { guardian_id: g.body.id, signer_name: `${givenName} Parent`, locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } },
    });
    await yael.api(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Attention", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-01", steps: [step()] },
    });
    const ps = (await env.db.query<{ id: string }>(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient])).rows.map((r) => r.id);
    const launch = await yael.api(`/v1/planned-sessions/${ps[0]}/launch`, { method: "POST", body: {} });
    const s = launch.body.launch.steps[0];
    // Withdraw consent after launch to trigger the flag
    await env.db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','withdrawn','v1','in_clinic_esign',$2,'\\x00')`,
      [patient, yael.userId],
    );
    const ticket = env.tickets.signV2(
      { jti: randomUUID(), psid: ps[1]!, asid: s.assignment_step_id, pid: patient, gid: s.game_id, sub: yael.userId, dev: device, allowed: allowedParamsFor(s.params, { min: 1, max: 5 }) },
      OFFLINE_TICKET_TTL_S,
    );
    const e = envelope({ ...s.params }, 0.7);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket, envelope: e } });
    expect(res.body).toMatchObject({ outcome: "kept_for_review", review_reason: "consent_withdrawn" });
    return { patient, session: e.session_id, givenName, familyName };
  };

  /** Create a patient with an accepted (counted) result. */
  const acceptedPatient = async (givenName = "Dan", familyName = "Cohen") => {
    const patient = randomUUID();
    await env.db.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,$3,$4,'2017-06-15','pending_consent')`,
      [patient, ids.clinic, givenName, familyName],
    );
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const g = await yael.api(`/v1/patients/${patient}/guardians`, {
      method: "POST",
      body: { full_name: `${givenName} Parent`, relationship: "father", is_legal_guardian: true, phone: "+972 50 000 0001", preferred_locale: "he" },
    });
    await yael.api(`/v1/patients/${patient}/consents`, {
      method: "POST",
      body: { guardian_id: g.body.id, signer_name: `${givenName} Parent`, locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "granted" } },
    });
    await yael.api(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Memory", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-01", steps: [step()] },
    });
    const ps = (await env.db.query<{ id: string }>(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient])).rows.map((r) => r.id);
    const launch = await yael.api(`/v1/planned-sessions/${ps[0]}/launch`, { method: "POST", body: {} });
    const s = launch.body.launch.steps[0];
    const ticket = env.tickets.signV2(
      { jti: randomUUID(), psid: ps[0]!, asid: s.assignment_step_id, pid: patient, gid: s.game_id, sub: yael.userId, dev: device, allowed: allowedParamsFor(s.params, { min: 1, max: 5 }) },
      OFFLINE_TICKET_TTL_S,
    );
    const e = envelope({ ...s.params }, 0.85);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket, envelope: e } });
    expect(res.body.outcome).toBe("accepted");
    return { patient, session: e.session_id };
  };

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    noam = await staffClient(env, "noam@synthetic.test", "Noam Cohen");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noam.userId, ids.org, ids.clinic, "therapist");
    await yael.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk" } });
    await yael.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: ids.clinic } });
  });
  afterAll(async () => env?.close());

  // ---- Review Queue ----

  it("review queue lists flagged undecided sessions", async () => {
    const f = await flaggedPatient("Mika", "Rosen");
    const res = await yael.api("/v1/review-queue");
    expect(res.status).toBe(200);
    const item = res.body.items.find((i: any) => i.id === f.session);
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      game_id: "catch-me-if-you-can",
      review_reason: "consent_withdrawn",
      patient_id: f.patient,
      given_name: "Mika",
      family_name: "Rosen",
    });
  });

  it("review queue excludes already-decided sessions", async () => {
    const f = await flaggedPatient("Roni", "Katz");
    await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "accept" } });
    const res = await yael.api("/v1/review-queue");
    const item = res.body.items.find((i: any) => i.id === f.session);
    expect(item).toBeUndefined();
  });

  it("review queue respects RLS — Noam sees nothing", async () => {
    await flaggedPatient("Tal", "Avraham");
    const res = await noam.api("/v1/review-queue");
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(0);
  });

  // ---- Reports Summary ----

  it("reports summary counts accepted sessions", async () => {
    const before = await yael.api("/v1/reports/summary");
    expect(before.status).toBe(200);
    const prevTotal = before.body.total_sessions;
    await acceptedPatient("Lior", "Shapira");
    const after = await yael.api("/v1/reports/summary");
    expect(after.body.total_sessions).toBe(prevTotal + 1);
    expect(after.body.active_patients).toBeGreaterThanOrEqual(1);
    expect(after.body.sessions_this_month).toBeGreaterThanOrEqual(1);
  });

  it("reports summary respects RLS — Noam sees nothing", async () => {
    const res = await noam.api("/v1/reports/summary");
    expect(res.status).toBe(200);
    expect(res.body.total_sessions).toBe(0);
    expect(res.body.active_patients).toBe(0);
  });

  // ---- Sessions Over Time ----

  it("sessions-over-time returns bucketed counts", async () => {
    await acceptedPatient("Yoni", "Dahan");
    const res = await yael.api("/v1/reports/sessions-over-time?period=day");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    // At least one bucket with today's session
    const today = res.body.data.find((d: any) => d.count > 0);
    expect(today).toBeDefined();
    expect(today.period).toBeTruthy();
    expect(today.count).toBeGreaterThanOrEqual(1);
  });

  it("sessions-over-time validates period param", async () => {
    const res = await yael.api("/v1/reports/sessions-over-time?period=century");
    expect(res.status).toBe(400);
  });

  it("sessions-over-time respects RLS", async () => {
    const res = await noam.api("/v1/reports/sessions-over-time?period=day");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  // ---- Activity Breakdown ----

  it("activity-breakdown returns per-game stats", async () => {
    await acceptedPatient("Shira", "Blum");
    const res = await yael.api("/v1/reports/activity-breakdown");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    const game = res.body.data.find((d: any) => d.game_id === "catch-me-if-you-can");
    expect(game).toBeDefined();
    expect(game.count).toBeGreaterThanOrEqual(1);
    expect(typeof game.avg_accuracy).toBe("number");
  });

  it("activity-breakdown respects RLS", async () => {
    const res = await noam.api("/v1/reports/activity-breakdown");
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });
});
