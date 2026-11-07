/**
 * Offline (v2) launch tickets and ingest that never drops (offline devices spec §7.4; ADR 0019): results sent by
 * whoever signs in on the device, credited to the ticket's therapist; results that arrive after something changed
 * are stored and kept for review.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { allowedParamsFor, OFFLINE_TICKET_TTL_S } from "../src/modules/sessions/routes.ts";

function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function envelope(params: Record<string, unknown>, accuracy: number) {
  const trials = 20;
  const correct = Math.round(trials * accuracy);
  return {
    envelope_version: "1", session_id: uuidv7(), game_id: "catch-me-if-you-can", game_version: "0.1.0", demo: false,
    started_at: "2026-11-02T08:00:00.000Z", ended_at: "2026-11-02T08:05:00.000Z", status: "time_up", end_reason: "time_up",
    mode: params.session_mode, params, active_ms: 300000, paused_ms: 0, lives_start: 3, lives_lost: 1, lives_remaining: 2, life_loss_events: 1,
    difficulty_start: params.difficulty, levels: [],
    std: {
      trials_total: trials, correct, errors: trials - correct, timeouts: 0, accuracy, rt_mean_ms: 812.4, rt_median_ms: 790.6, rt_sd_ms: 120,
      rt_min_ms: 400, rt_cv: 0.15, left_accuracy: accuracy, right_accuracy: accuracy, left_rt_median_ms: 780, right_rt_median_ms: 800,
    },
    metrics: { highest_level: 3, levels_completed: 2 }, trials: [], practice_completed: true,
  };
}

const step = (extra: Record<string, unknown> = {}) => ({
  game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 300, lives: 3, difficulty_start: 2, hemisphere: "left", timer_position: "left",
  practice: "off", trial_window_ms: null, game_params: {}, progression: { metric: "accuracy", up_at: 0.8, up_after: 1, down_below: 0.5, down_after: 1 }, ...extra,
});

describe.skipIf(!ADMIN_URL)("offline ingest", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  let video = "";
  const device = randomUUID();

  /** A patient on Yael's caseload with consent and a protocol [catch-me, video]; returns its sessions and steps. */
  const patientWithProtocol = async () => {
    const patient = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent')`, [patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const g = await yael.api(`/v1/patients/${patient}/guardians`, { method: "POST", body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" } });
    await yael.api(`/v1/patients/${patient}/consents`, { method: "POST", body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } } });
    const a = await yael.api(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Attention", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-01", steps: [step(), { step_type: "video", video_id: video }] },
    });
    expect(a.status).toBe(201);
    const sessions = (await env.db.query<{ id: string }>(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient])).rows.map((r) => r.id);
    const steps = (await env.db.query<{ id: string; step_type: string }>(`SELECT s.id, s.step_type FROM app.assignment_step s JOIN app.protocol_assignment a ON a.id = s.assignment_id WHERE a.patient_id = $1 ORDER BY s.ordinal`, [patient])).rows;
    // Online launch gives the exact params a device would start from.
    const launch = await yael.api(`/v1/planned-sessions/${sessions[0]}/launch`, { method: "POST", body: {} });
    const params = launch.body.launch.steps[0].params as Record<string, unknown>;
    return { patient, sessions, gameStep: steps[0]!.id, videoStep: steps[1]!.id, params };
  };

  const v2 = (p: { patient: string; gameStep: string; params: Record<string, unknown> }, psid: string, ttl = OFFLINE_TICKET_TTL_S) =>
    env.tickets.signV2(
      { jti: randomUUID(), psid, asid: p.gameStep, pid: p.patient, gid: "catch-me-if-you-can", sub: yael.userId, dev: device, allowed: allowedParamsFor(p.params, { min: 1, max: 5 }) },
      ttl,
    );

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    const admin = (await platformAdmin(env)).api;
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    noam = await staffClient(env, "noam@synthetic.test", "Noam Cohen");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noam.userId, ids.org, ids.clinic, "therapist");
    video = (await admin("/v1/admin/videos", { method: "POST", body: { source: "youtube", youtube_url: "https://youtu.be/dQw4w9WgXcQ", titles: { en: "Breathing" }, region_ids: [], age_min: null, age_max: null, status: "published" } })).body.video.id;
    await yael.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk" } });
    for (const u of [yael, noam]) await u.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: ids.clinic } });
  });
  afterAll(async () => env?.close());

  it("a v2 result uploaded by another therapist on the device is stored and credited to the ticket's therapist", async () => {
    const p = await patientWithProtocol();
    const e = envelope({ ...p.params, difficulty: 2 }, 0.6);
    const res = await noam.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!), envelope: e } });
    expect(res.status).toBe(201);
    expect(res.body.outcome).toBe("accepted");
    const row = await env.db.query(`SELECT recorded_by, uploaded_by, review_reason FROM app.game_session WHERE id = $1`, [e.session_id]);
    expect(row.rows[0]).toEqual({ recorded_by: yael.userId, uploaded_by: noam.userId, review_reason: null });
    // Sent again: a true duplicate.
    const again = await noam.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!), envelope: e } });
    expect(again.body.outcome).toBe("duplicate");
  });

  it("a v2 result with a difficulty inside the ticket is accepted; a changed hemisphere is kept for review", async () => {
    const p = await patientWithProtocol();
    const ok = await yael.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!), envelope: envelope({ ...p.params, difficulty: 4, seed: 7 }, 0.6) } });
    expect(ok.body.outcome).toBe("accepted");
    const off = envelope({ ...p.params, hemisphere: "right" }, 0.6);
    const bad = await yael.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[2]!), envelope: off } });
    expect(bad.status).toBe(201);
    expect(bad.body).toMatchObject({ outcome: "kept_for_review", review_reason: "params_outside_ticket" });
  });

  it("a result after consent was withdrawn is kept for review and changes no difficulty", async () => {
    const p = await patientWithProtocol();
    const ticket = v2(p, p.sessions[1]!);
    await env.db.query(
      `INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','withdrawn','v1','in_clinic_esign',$2,'\\x00')`,
      [p.patient, yael.userId],
    );
    const res = await noam.api("/v1/results", { method: "POST", body: { ticket, envelope: envelope({ ...p.params, difficulty: 2 }, 0.95) } });
    expect(res.body).toMatchObject({ outcome: "kept_for_review", review_reason: "consent_withdrawn", progression: null });
    const d = await env.db.query(`SELECT current_difficulty FROM app.assignment_step WHERE id = $1`, [p.gameStep]);
    expect(d.rows[0].current_difficulty).toBe(2);
  });

  it("the same planned session played on two devices: both kept, the later one flagged played_twice", async () => {
    const p = await patientWithProtocol();
    const first = await yael.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!), envelope: envelope({ ...p.params, difficulty: 2 }, 0.6) } });
    const second = await noam.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!), envelope: envelope({ ...p.params, difficulty: 2 }, 0.6) } });
    expect(first.body.outcome).toBe("accepted");
    expect(second.body).toMatchObject({ outcome: "kept_for_review", review_reason: "played_twice" });
    const n = await env.db.query(`SELECT count(*)::int AS n FROM app.game_session WHERE planned_session_id = $1`, [p.sessions[1]]);
    expect(n.rows[0].n).toBe(2);
  });

  it("a hand-set difficulty since the package was issued is kept", async () => {
    const p = await patientWithProtocol();
    const ticket = v2(p, p.sessions[1]!);
    await env.db.query(`UPDATE app.assignment_step SET current_difficulty = 1, difficulty_set_at = now() + interval '1 second' WHERE id = $1`, [p.gameStep]);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket, envelope: envelope({ ...p.params, difficulty: 2 }, 0.95) } });
    expect(res.body.outcome).toBe("accepted");
    const d = await env.db.query(`SELECT current_difficulty FROM app.assignment_step WHERE id = $1`, [p.gameStep]);
    expect(d.rows[0].current_difficulty).toBe(1);
  });

  it("a video view after the session closed is kept for review, not refused", async () => {
    const p = await patientWithProtocol();
    await env.db.query(`UPDATE app.planned_session SET status = 'done' WHERE id = $1`, [p.sessions[1]]);
    const view = {
      client_view_id: uuidv7(), planned_session_id: p.sessions[1], assignment_step_id: p.videoStep, video_id: video, video_version: 1,
      started_at: "2026-11-02T08:06:00.000Z", ended_at: "2026-11-02T08:07:00.000Z", watched_s: 60, completed: null,
    };
    const res = await yael.api("/v1/video-views", { method: "POST", body: view });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ outcome: "kept_for_review", review_reason: "session_closed" });
  });

  it("a v1 result for a patient the uploader can't see is not answered duplicate", async () => {
    const p = await patientWithProtocol();
    const launch = await yael.api(`/v1/planned-sessions/${p.sessions[1]}/launch`, { method: "POST", body: {} });
    const g = launch.body.launch.steps[0];
    await env.db.query(`UPDATE app.patient_care_team SET ended_at = now() WHERE patient_id = $1`, [p.patient]);
    const e = envelope(g.params, 0.6);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket: g.ticket, envelope: e } });
    expect(res.body.outcome).not.toBe("duplicate");
    expect(res.body).toMatchObject({ outcome: "kept_for_review", review_reason: "not_on_care_team" });
    const stored = await env.db.query(`SELECT 1 FROM app.game_session WHERE id = $1`, [e.session_id]);
    expect(stored.rowCount).toBe(1);
  });

  it("an expired v2 ticket is rejected and logged", async () => {
    const p = await patientWithProtocol();
    const e = envelope({ ...p.params, difficulty: 2 }, 0.6);
    const res = await yael.api("/v1/results", { method: "POST", body: { ticket: v2(p, p.sessions[1]!, -10), envelope: e } });
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("invalid_ticket");
    const raw = await env.db.query(`SELECT outcome, error FROM app.session_result_raw WHERE client_session_id = $1`, [e.session_id]);
    expect(raw.rows[0]).toEqual({ outcome: "rejected", error: "invalid_ticket" });
  });
});
