/**
 * Slice 3 through the API: build a template, assign it (steps copied,
 * schedule laid out), see it on Today, edit the template without touching
 * the running protocol, pause and stop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

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

describe.skipIf(!ADMIN_URL)("protocols API", () => {
  let env: TestEnv;
  let yael: Api;
  let dana: Api;
  let ids: Awaited<ReturnType<typeof seedClinics>> & { yael: string; patient: string };
  let templateId = "";

  beforeAll(async () => {
    env = await setupApi();
    const clinics = await seedClinics(env.db);
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    const d = await staffClient(env, "dana@synthetic.test", "Dana Kaplan");
    yael = y.api;
    dana = d.api;
    ids = { ...clinics, yael: y.userId, patient: randomUUID() };
    await addMember(env.db, y.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, d.userId, ids.org, ids.clinic, "therapist");
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','active')`, [ids.patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, ids.yael]);
  });
  afterAll(async () => env?.close());

  const template = (extra: Record<string, unknown> = {}) => ({
    clinic_id: ids.clinic,
    name: "Sustained attention",
    description: null,
    weeks: 6,
    sessions_per_week: 2,
    setting: "clinic",
    visibility: "clinic",
    steps: [step(), step({ hemisphere: "right", timer_position: "right", session_mode: "timed", lives: null, duration_s: 180, game_params: { cvd_mode: true } })],
    ...extra,
  });

  it("creates a template and shares it with the clinic", async () => {
    const res = await yael("/v1/templates", { method: "POST", body: template() });
    expect(res.status).toBe(201);
    templateId = res.body.template.id;
    expect(res.body.template).toMatchObject({ version: 1, can_edit: true, games: ["catch-me-if-you-can", "catch-me-if-you-can"] });
    expect(res.body.template.steps[1]).toMatchObject({ session_mode: "timed", lives: null, duration_s: 180, game_params: { cvd_mode: true } });
    // The timer corner is stored opposite the hemisphere, whatever side the client sent (ADR 0008).
    expect(res.body.template.steps.map((s: { timer_position: string }) => s.timer_position)).toEqual(["right", "left"]);
    const list = await dana(`/v1/templates?clinic=${ids.clinic}`);
    expect(list.body.templates).toEqual([expect.objectContaining({ id: templateId, can_edit: false, owner_name: "Yael Bar" })]);
  });

  it("explains what a step is missing, and rejects games or settings it doesn't know", async () => {
    const bad = await yael("/v1/templates", { method: "POST", body: template({ steps: [step({ session_mode: "timed", duration_s: null, lives: null })] }) });
    expect(bad.status).toBe(400);
    expect(bad.body.issues).toEqual([{ path: "steps.0.duration_s", code: "needs_duration" }]);
    const unknown = await yael("/v1/templates", { method: "POST", body: template({ steps: [step({ game_id: "pong" }), step({ game_params: { turbo: true } })] }) });
    expect(unknown.body.issues).toEqual([
      { path: "steps.0.game_id", code: "unknown_game" },
      { path: "steps.1.game_params.turbo", code: "unknown_setting" },
    ]);
  });

  it("only the owner edits; Dana can't", async () => {
    expect((await dana(`/v1/templates/${templateId}`, { method: "PUT", body: template({ name: "Mine now" }) })).status).toBe(404);
  });

  it("assigns the template: steps copied, 12 sessions planned, first one on Today", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const t = (await yael(`/v1/templates/${templateId}`)).body.template;
    const res = await yael(`/v1/patients/${ids.patient}/assignment`, {
      method: "POST",
      body: { template_id: templateId, name: t.name, weeks: t.weeks, sessions_per_week: t.sessions_per_week, setting: t.setting, description: null, start_date: start, steps: t.steps.map(({ id: _i, ordinal: _o, ...s }: Record<string, unknown>) => s) },
    });
    expect(res.status).toBe(201);
    const a = res.body.assignment;
    expect(a.steps).toHaveLength(2);
    expect(a.steps[0]).toMatchObject({ current_difficulty: 2, sessions_completed: 0 });
    expect(a.sessions).toHaveLength(12);
    expect(a.sessions[0]).toMatchObject({ seq: 1, week: 1, planned_date: start, status: "planned" });

    const today = await yael(`/v1/today?clinic=${ids.clinic}`);
    expect(today.body.items).toEqual([
      expect.objectContaining({ seq: 1, week: 1, total: 12, patient: expect.objectContaining({ given_name: "Noa", can_play: false }), games: ["catch-me-if-you-can", "catch-me-if-you-can"] }),
    ]);
    expect((await dana(`/v1/today?clinic=${ids.clinic}`)).body.items).toEqual([]);
    expect((await yael(`/v1/patients/${ids.patient}/assignment`, { method: "POST", body: { template_id: null, name: "x", weeks: 1, sessions_per_week: 1, setting: "clinic", start_date: start, steps: [step()] } })).status).toBe(409);
  });

  it("editing the template later bumps its version but leaves the patient's copy alone", async () => {
    const res = await yael(`/v1/templates/${templateId}`, { method: "PUT", body: template({ steps: [step({ difficulty_start: 5 })] }) });
    expect(res.body.template.version).toBe(2);
    const a = (await yael(`/v1/patients/${ids.patient}/assignment`)).body.assignment;
    expect(a.steps).toHaveLength(2);
    expect(a.steps[0].difficulty_start).toBe(2);
  });

  it("pauses, resumes and stops; stopping cancels what hasn't happened", async () => {
    const a = (await yael(`/v1/patients/${ids.patient}/assignment`)).body.assignment;
    expect((await yael(`/v1/assignments/${a.id}`, { method: "PATCH", body: { status: "paused" } })).body.assignment.status).toBe("paused");
    expect((await yael(`/v1/today?clinic=${ids.clinic}`)).body.items).toEqual([]); // paused protocols don't appear on Today
    await yael(`/v1/assignments/${a.id}`, { method: "PATCH", body: { status: "active" } });
    const stopped = await yael(`/v1/assignments/${a.id}`, { method: "PATCH", body: { status: "cancelled" } });
    expect(stopped.body.assignment).toBeNull();
    const { rows } = await env.db.query(`SELECT status, count(*)::int n FROM app.planned_session WHERE assignment_id = $1 GROUP BY status`, [a.id]);
    expect(rows).toEqual([{ status: "cancelled", n: 12 }]);
  });
});
