/**
 * Slice 4 through the API: launch a planned session (consent checked, params
 * built and signed), upload results (stored once, every attempt kept),
 * progression applied and logged, the planned session closed when all games
 * are in, and the session list for the progress view.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

function envelope(params: Record<string, unknown>, accuracy: number, extra: Record<string, unknown> = {}) {
  const trials = 20;
  const correct = Math.round(trials * accuracy);
  return {
    envelope_version: "1",
    session_id: uuidv7(),
    game_id: "catch-me-if-you-can",
    game_version: "0.1.0",
    demo: false,
    started_at: "2026-10-23T08:00:00.000Z",
    ended_at: "2026-10-23T08:05:00.000Z",
    status: "time_up",
    end_reason: "time_up",
    mode: params.session_mode,
    params,
    active_ms: 300000,
    paused_ms: 0,
    lives_start: 3,
    lives_lost: 1,
    lives_remaining: 2,
    life_loss_events: 1,
    difficulty_start: params.difficulty,
    levels: [],
    std: {
      trials_total: trials, correct, errors: trials - correct, timeouts: 0, accuracy,
      rt_mean_ms: 812.4, rt_median_ms: 790.6, rt_sd_ms: 120, rt_min_ms: 400, rt_cv: 0.15,
      left_accuracy: accuracy, right_accuracy: accuracy, left_rt_median_ms: 780, right_rt_median_ms: 800,
    },
    metrics: { highest_level: 3, levels_completed: 2 },
    trials: [],
    practice_completed: true,
    ...extra,
  };
}

const step = (extra: Record<string, unknown> = {}) => ({
  game_id: "catch-me-if-you-can",
  session_mode: "timed_lives",
  duration_s: 300,
  lives: 3,
  difficulty_start: 2,
  hemisphere: "left",
  timer_position: "left",
  practice: "auto",
  trial_window_ms: null,
  game_params: {},
  progression: { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 },
  ...extra,
});

describe.skipIf(!ADMIN_URL)("sessions API", () => {
  let env: TestEnv;
  let yael: Api;
  let dana: Api;
  let patient = "";
  let sessions: { id: string; seq: number }[] = [];

  beforeAll(async () => {
    env = await setupApi();
    const ids = await seedClinics(env.db);
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    const d = await staffClient(env, "dana@synthetic.test", "Dana Kaplan");
    yael = y.api;
    dana = d.api;
    await addMember(env.db, y.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, d.userId, ids.org, ids.other, "therapist");
    patient = randomUUID();
    await env.db.query(
      `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status, preferred_locale, colour_vision_deficiency) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent','he',true)`,
      [patient, ids.clinic],
    );
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, y.userId]);
    const a = await yael(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Attention", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: "2026-10-23", steps: [step(), step({ hemisphere: "right", timer_position: "right" })] },
    });
    expect(a.status).toBe(201);
    const rows = await env.db.query(`SELECT id, seq FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient]);
    sessions = rows.rows;
  });
  afterAll(async () => env?.close());

  it("won't launch without consent", async () => {
    const res = await yael(`/v1/planned-sessions/${sessions[0]!.id}/launch`, { method: "POST", body: {} });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("consent_required");
  });

  it("launches with server-built params and a ticket per game", async () => {
    const g = await yael(`/v1/patients/${patient}/guardians`, {
      method: "POST",
      body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" },
    });
    await yael(`/v1/patients/${patient}/consents`, {
      method: "POST",
      body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } },
    });
    const res = await yael(`/v1/planned-sessions/${sessions[0]!.id}/launch`, { method: "POST", body: {} });
    expect(res.status).toBe(200);
    const launch = res.body.launch;
    expect(launch).toMatchObject({ seq: 1, total: 4, patient: { given_name: "Noa", preferred_locale: "he" } });
    expect(launch.steps).toHaveLength(2);
    expect(launch.steps[0].params).toMatchObject({
      session_mode: "timed_lives", duration_s: 300, lives: 3, difficulty: 2, hemisphere: "left", practice: "on", lang: "he", context: "clinic",
      "catch_me_if_you_can.cvd_mode": true,
    });
    expect(launch.steps[1].params.hemisphere).toBe("right");
    // Timer in the corner opposite the hemisphere: left → top right, right → top left (ADR 0008).
    expect(launch.steps.map((s: { params: { timer_position: string } }) => s.params.timer_position)).toEqual(["right", "left"]);
    expect(launch.steps[0].ticket.split(".")).toHaveLength(3);
    // Someone outside the clinic can't launch it.
    expect((await dana(`/v1/planned-sessions/${sessions[0]!.id}/launch`, { method: "POST", body: {} })).status).toBe(404);
  });

  it("stores a result once, however many times it's sent", async () => {
    const launch = (await yael(`/v1/planned-sessions/${sessions[0]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    const s0 = launch.steps[0];
    const env0 = envelope(s0.params, 0.9);
    const first = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: env0 } });
    expect(first.status).toBe(201);
    expect(first.body).toMatchObject({ outcome: "accepted", session_id: env0.session_id, progression: { action: "hold", from: 2, to: 2 }, planned_session_status: "in_progress" });
    const again = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: env0 } });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("duplicate");
    const n = await env.db.query(`SELECT count(*)::int AS n FROM app.game_session WHERE id = $1`, [env0.session_id]);
    expect(n.rows[0].n).toBe(1);
    const raw = await env.db.query(`SELECT outcome FROM app.session_result_raw WHERE client_session_id = $1 ORDER BY received_at, id`, [env0.session_id]);
    expect(raw.rows.map((r) => r.outcome)).toEqual(["accepted", "duplicate"]);

    // The second game closes the planned session.
    const s1 = launch.steps[1];
    const done = await yael("/v1/results", { method: "POST", body: { ticket: s1.ticket, envelope: envelope(s1.params, 0.4) } });
    expect(done.body).toMatchObject({ outcome: "accepted", progression: { action: "down", from: 2, to: 1 }, planned_session_status: "done" });
    expect(launch.steps.map((s: { done: boolean }) => s.done)).toEqual([false, false]);
    expect((await yael(`/v1/planned-sessions/${sessions[0]!.id}/launch`, { method: "POST", body: {} })).body.error).toBe("session_closed");
  });

  it("refuses changed params, a wrong game, demo results and forged tickets — and keeps a record of each", async () => {
    const launch = (await yael(`/v1/planned-sessions/${sessions[1]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    const s0 = launch.steps[0];
    expect(s0.params.practice).toBe("off"); // second session of this step: practice is over
    expect(launch.steps.map((s: { done: boolean }) => s.done)).toEqual([false, false]);
    const tampered = envelope({ ...s0.params, difficulty: 5 }, 0.9);
    const r1 = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: tampered } });
    expect(r1).toMatchObject({ status: 422, body: { error: "params_mismatch" } });
    const r2 = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: envelope(s0.params, 0.9, { game_id: "pong" }) } });
    expect(r2.body.error).toBe("game_mismatch");
    const r3 = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: envelope(s0.params, 0.9, { demo: true }) } });
    expect(r3.body.error).toBe("demo_result");
    const [h, b, s] = s0.ticket.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(b, "base64url").toString()), pid: randomUUID() })).toString("base64url")}.${s}`;
    const r4 = await yael("/v1/results", { method: "POST", body: { ticket: forged, envelope: envelope(s0.params, 0.9) } });
    expect(r4.body.error).toBe("invalid_ticket");
    const r5 = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: { session_id: "nope" } } });
    expect(r5.status).toBe(400);
    const raw = await env.db.query(`SELECT error FROM app.session_result_raw WHERE outcome = 'rejected' ORDER BY received_at, id`);
    expect(raw.rows.map((r) => r.error)).toEqual(["params_mismatch", "game_mismatch", "demo_result", "invalid_ticket", "invalid_envelope"]);
  });

  it("moves difficulty up after two strong sessions in a row, and logs why", async () => {
    // Step 1 (left) played 0.9 at difficulty 2 in session 1; one more ≥ 0.8 → up.
    const launch = (await yael(`/v1/planned-sessions/${sessions[1]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    const s0 = launch.steps[0];
    const res = await yael("/v1/results", { method: "POST", body: { ticket: s0.ticket, envelope: envelope(s0.params, 0.85) } });
    expect(res.body.progression).toEqual({ action: "up", from: 2, to: 3 });
    const log = await env.db.query(`SELECT action, from_difficulty, to_difficulty, reason, inputs FROM app.progression_decision WHERE assignment_step_id = $1 ORDER BY decided_at, id`, [s0.assignment_step_id]);
    expect(log.rows.at(-1)).toMatchObject({ action: "up", from_difficulty: 2, to_difficulty: 3, reason: "streak_up" });
    expect(log.rows.at(-1).inputs.accuracies).toEqual([0.85, 0.9]);
    const next = (await yael(`/v1/planned-sessions/${sessions[2]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    expect(next.steps[0].params.difficulty).toBe(3);
  });

  it("an abandoned game is stored but doesn't count toward progression", async () => {
    const launch = (await yael(`/v1/planned-sessions/${sessions[1]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    const s1 = launch.steps[1];
    const res = await yael("/v1/results", { method: "POST", body: { ticket: s1.ticket, envelope: envelope(s1.params, 0, { status: "abandoned", end_reason: "therapist_ended" }) } });
    expect(res.body).toMatchObject({ outcome: "accepted", progression: null, planned_session_status: "done" });
  });

  it("lists the patient's results for the progress view, and nobody else's", async () => {
    const res = await yael(`/v1/patients/${patient}/sessions`);
    expect(res.status).toBe(200);
    expect(res.body.sessions).toHaveLength(4);
    expect(res.body.sessions[0]).toMatchObject({ game_id: "catch-me-if-you-can", seq: expect.any(Number) });
    expect((await dana(`/v1/patients/${patient}/sessions`)).status).toBe(404);
  });

  it("lists difficulty changes (not holds) with their reason, audits the view, and hides them from others", async () => {
    const res = await yael(`/v1/patients/${patient}/progression`);
    expect(res.status).toBe(200);
    // Newest first: step 1 went up in the last test; step 2 came down after two weak sessions earlier.
    expect(res.body.decisions).toEqual([
      expect.objectContaining({ game_id: "catch-me-if-you-can", action: "up", from_difficulty: 2, to_difficulty: 3, reason: "streak_up" }),
      expect.objectContaining({ game_id: "catch-me-if-you-can", action: "down", from_difficulty: 2, to_difficulty: 1, reason: "streak_down" }),
    ]);
    const holds = await env.db.query(`SELECT count(*)::int AS n FROM app.progression_decision WHERE patient_id = $1 AND action = 'hold'`, [patient]);
    expect(holds.rows[0].n).toBeGreaterThan(0); // they exist, but aren't listed
    const audit = await env.db.query(`SELECT 1 FROM app.audit_event WHERE action = 'view' AND resource_type = 'progression_decision' AND patient_id = $1`, [patient]);
    expect(audit.rowCount).toBe(1);
    expect((await dana(`/v1/patients/${patient}/progression`)).status).toBe(404);
    expect((await yael(`/v1/patients/not-a-uuid/progression`)).status).toBe(404);
  });
});
