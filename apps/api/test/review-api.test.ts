/**
 * Reviewing results that arrived after something changed (offline devices spec §7.4): flagged results show why,
 * a consent-withdrawn one counts for nothing until accepted, and Today tells the therapist how many wait.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { allowedParamsFor, OFFLINE_TICKET_TTL_S } from "../src/modules/sessions/routes.ts";
import { envelope, step } from "./offline-fixture.ts";

describe.skipIf(!ADMIN_URL)("result review", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const device = randomUUID();

  /** A patient of Yael's, one v2 result sent after treatment consent was withdrawn; returns ids. */
  const flagged = async () => {
    const patient = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent')`, [patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const g = await yael.api(`/v1/patients/${patient}/guardians`, { method: "POST", body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" } });
    await yael.api(`/v1/patients/${patient}/consents`, { method: "POST", body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } } });
    await yael.api(`/v1/patients/${patient}/assignment`, { method: "POST", body: { template_id: null, name: "Attention", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-01", steps: [step()] } });
    const ps = (await env.db.query<{ id: string }>(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient])).rows.map((r) => r.id);
    const launch = await yael.api(`/v1/planned-sessions/${ps[0]}/launch`, { method: "POST", body: {} });
    const s = launch.body.launch.steps[0];
    await env.db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','withdrawn','v1','in_clinic_esign',$2,'\\x00')`,
      [patient, yael.userId],
    );
    const ticket = env.tickets.signV2({ jti: randomUUID(), psid: ps[1]!, asid: s.assignment_step_id, pid: patient, gid: s.game_id, sub: yael.userId, dev: device, allowed: allowedParamsFor(s.params, { min: 1, max: 5 }) }, OFFLINE_TICKET_TTL_S);
    const e = envelope({ ...s.params }, 0.7);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket, envelope: e } });
    expect(res.body).toMatchObject({ outcome: "kept_for_review", review_reason: "consent_withdrawn" });
    return { patient, session: e.session_id };
  };
  const listed = async (patient: string, session: string) =>
    ((await yael.api(`/v1/patients/${patient}/sessions`)).body.sessions as Array<{ id: string; counts: boolean; review: unknown }>).find((x) => x.id === session)!;

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

  it("a consent-withdrawn result stays out of progress until accepted", async () => {
    const f = await flagged();
    expect(await listed(f.patient, f.session)).toMatchObject({ counts: false, review: { reason: "consent_withdrawn", decision: null } });
    const res = await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "accept", note: "Consent re-signed on paper" } });
    expect(res.status).toBe(201);
    expect(await listed(f.patient, f.session)).toMatchObject({ counts: true, review: { reason: "consent_withdrawn", decision: "accept" } });
  });

  it("excluding a result removes it from progress", async () => {
    const f = await flagged();
    await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "accept" } });
    await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "exclude" } });
    expect(await listed(f.patient, f.session)).toMatchObject({ counts: false, review: { decision: "exclude" } });
  });

  it("Today counts flagged results the caller can review", async () => {
    const before = (await yael.api("/v1/today")).body.review_count as number;
    const f = await flagged();
    expect((await yael.api("/v1/today")).body.review_count).toBe(before + 1);
    await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "exclude" } });
    expect((await yael.api("/v1/today")).body.review_count).toBe(before);
    expect((await noam.api("/v1/today")).body.review_count).toBe(0);
  });

  it("a colleague without access can't review", async () => {
    const f = await flagged();
    expect((await noam.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "accept" } })).status).toBe(404);
    expect((await yael.api(`/v1/results/${f.session}/review`, { method: "POST", body: { decision: "maybe" } })).status).toBe(400);
  });
});
