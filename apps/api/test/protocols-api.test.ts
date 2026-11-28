/**
 * Slice 3 through the API: build a template, assign it (steps copied,
 * schedule laid out), see it on Today, edit the template without touching
 * the running protocol, pause and stop.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { buildParams } from "../src/modules/sessions/routes.ts";

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
    // Wherever a patient is shown, so is the therapist they are assigned to.
    expect(today.body.items[0].patient.therapists).toEqual(["Yael Bar"]);
    expect((await dana(`/v1/today?clinic=${ids.clinic}`)).body.items).toEqual([]);

    // Whose day (the home page's therapist switcher). A clinic manager is on nobody's care team: her own day is
    // empty, "all" shows the clinic, and one therapist's id shows that therapist's patients.
    const m = await staffClient(env, "mira@synthetic.test", "Mira Tal");
    await addMember(env.db, m.userId, ids.org, ids.clinic, "clinic_manager");
    const dn = (await env.db.query<{ id: string }>(`SELECT id FROM app.app_user WHERE email = 'dana@synthetic.test'`)).rows[0]!.id;
    const day = async (who: Api, therapist: string) => (await who(`/v1/today?clinic=${ids.clinic}&therapist=${therapist}`)).body.items.length;
    expect((await m.api(`/v1/today?clinic=${ids.clinic}`)).body.items).toEqual([]);
    expect(await day(m.api, "all")).toBe(1);
    expect(await day(m.api, ids.yael)).toBe(1);
    expect(await day(m.api, dn)).toBe(0);
    expect((await m.api(`/v1/today?therapist=everyone`)).status).toBe(400);
    // A therapist gets no more by asking: row-level security still shows only her own patients.
    expect(await day(dana, "all")).toBe(0);
    expect(await day(dana, ids.yael)).toBe(0);
    // The patient list narrows the same way.
    const listed = async (who: Api, therapist: string) => (await who(`/v1/patients?clinic=${ids.clinic}&therapist=${therapist}`)).body.patients.length;
    expect(await listed(m.api, ids.yael)).toBe(1);
    // The list names who each patient is assigned to.
    expect((await m.api(`/v1/patients?clinic=${ids.clinic}`)).body.patients[0].therapists).toEqual(["Yael Bar"]);
    expect(await listed(m.api, dn)).toBe(0);
    expect(await listed(dana, ids.yael)).toBe(0);
    expect((await m.api(`/v1/patients?therapist=x`)).status).toBe(400);

    // "Needs attention" for a manager: a therapist with a patient in an active protocol who has not used the system.
    // Yael has just been working, so she is not listed; Omer has done nothing in the clinic yet.
    const omer = await staffClient(env, "omer@synthetic.test", "Omer Gal");
    await addMember(env.db, omer.userId, ids.org, ids.clinic, "therapist");
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) SELECT patient_id, $1 FROM app.patient_care_team WHERE user_id = $2 LIMIT 1`, [omer.userId, ids.yael]);
    const quiet = await m.api(`/v1/reports/staff-attention?clinic=${ids.clinic}`);
    expect(quiet.status).toBe(200);
    expect(quiet.body.therapists).toEqual([{ user_id: omer.userId, full_name: "Omer Gal", days: null, patients: 1 }]);
    // Only for managers: a therapist gets nothing about colleagues.
    expect((await yael(`/v1/reports/staff-attention?clinic=${ids.clinic}`)).body.therapists).toEqual([]);
    expect((await m.api(`/v1/reports/staff-attention`)).status).toBe(400);
    await env.db.query(`DELETE FROM app.patient_care_team WHERE user_id = $1`, [omer.userId]);
    // A session has no time of day until it is given one on the calendar; Today then shows it.
    expect(today.body.items[0].planned_time).toBeNull();
    expect((await yael(`/v1/calendar/sessions/${a.sessions[0].id}`, { method: "PATCH", body: { planned_date: start, planned_time: "09:30" } })).status).toBe(200);
    expect((await yael(`/v1/today?clinic=${ids.clinic}`)).body.items[0].planned_time).toBe("09:30");

    // "Next up": once the patient's session is started today they are no longer waiting and leave the list; a
    // session left unfinished on an earlier day stays on it. (Set directly: a launch needs consent, tested elsewhere.)
    const open = (await yael(`/v1/today?clinic=${ids.clinic}`)).body.items[0];
    await env.db.query(`UPDATE app.planned_session SET status = 'in_progress', started_at = now() WHERE id = $1`, [open.planned_session_id]);
    expect((await yael(`/v1/today?clinic=${ids.clinic}`)).body.items).toEqual([]);
    await env.db.query(`UPDATE app.planned_session SET started_at = now() - interval '2 days' WHERE id = $1`, [open.planned_session_id]);
    expect((await yael(`/v1/today?clinic=${ids.clinic}`)).body.items.map((i: { planned_session_id: string }) => i.planned_session_id)).toEqual([open.planned_session_id]);
    await env.db.query(`UPDATE app.planned_session SET status = 'planned', started_at = NULL WHERE id = $1`, [open.planned_session_id]);
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

  it("Peek Peek: hearts per board (lives = auto), only for games that support it (ADR 0012)", async () => {
    const peek = step({ game_id: "peek-peek", lives: null, lives_auto: true, duration_s: 360, game_params: { pack: "animals", control_trials: true, hidden_count: false, study_time_s: 0 } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Memory", steps: [peek] }) });
    expect(res.status).toBe(201);
    const t = (await yael(`/v1/templates/${res.body.template.id}`)).body.template;
    expect(t.steps[0]).toMatchObject({ game_id: "peek-peek", lives: null, lives_auto: true, game_params: { pack: "animals" } });
    const notSupported = await yael("/v1/templates", { method: "POST", body: template({ steps: [step({ lives: null, lives_auto: true })] }) });
    expect(notSupported.body.issues).toEqual([{ path: "steps.0.lives", code: "lives_auto_not_supported" }]);
    const both = await yael("/v1/templates", { method: "POST", body: template({ steps: [step({ game_id: "peek-peek", lives: 3, lives_auto: true })] }) });
    expect(both.body.issues).toEqual([{ path: "steps.0.lives", code: "lives_or_auto" }]);
    const badPack = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...peek, game_params: { pack: "dinosaurs" } }] }) });
    expect(badPack.body.issues).toEqual([{ path: "steps.0.game_params.pack", code: "invalid_setting" }]);
    // The database keeps the rule too: a lives mode needs a count or "auto".
    await expect(
      env.db.query(`UPDATE app.template_step SET lives_auto = false WHERE template_id = $1`, [res.body.template.id]),
    ).rejects.toThrow(/step_mode_fields/);
    // At launch, "auto" travels as lives = "auto".
    const params = buildParams(
      { ...t.steps[0], lives_auto: true, current_difficulty: 3, sessions_completed: 0, monochrome: false } as Parameters<typeof buildParams>[0],
      { preferred_locale: "en", colour_vision_deficiency: false },
      1,
    );
    expect(params).toMatchObject({ session_mode: "timed_lives", lives: "auto", "peek_peek.pack": "animals" });
  });

  it("Orbital Order: its settings are checked, and a trial window is allowed (ADR 0013)", async () => {
    const oo = step({ game_id: "orbital-order", session_mode: "lives", duration_s: null, lives: 5, trial_window_ms: 6000, game_params: { glyph_type: "letters", rule_visible: "always", motor_baseline: false, max_rule_trials: 30, neon: true } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Order", steps: [oo] }) });
    expect(res.status).toBe(201);
    const auto = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...oo, lives: null, lives_auto: true }] }) });
    expect(auto.body.issues).toEqual([{ path: "steps.0.lives", code: "lives_auto_not_supported" }]);
    const tooMany = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...oo, game_params: { max_rule_trials: 200 } }] }) });
    expect(tooMany.body.issues).toEqual([{ path: "steps.0.game_params.max_rule_trials", code: "invalid_setting" }]);
    const t = (await yael(`/v1/templates/${res.body.template.id}`)).body.template;
    const params = buildParams(
      { ...t.steps[0], current_difficulty: 2, sessions_completed: 0, monochrome: false } as Parameters<typeof buildParams>[0],
      { preferred_locale: "he", colour_vision_deficiency: false },
      1,
    );
    expect(params).toMatchObject({ session_mode: "lives", lives: 5, trial_window_ms: 6000, "orbital_order.glyph_type": "letters", "orbital_order.neon": true });
  });

  it("Tunnel Rush: its settings are checked; a lane count outside 6/8/10/12 is refused (ADR 0014)", async () => {
    const tr = step({ game_id: "tunnel-rush", session_mode: "timed", duration_s: 120, lives: null, game_params: { lanes: 10, ship_mode: "move", object_type: "real_faces", object_orientation: "wall", rotation: "alternate", spin_speed: 20, progressive: false } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Steering", steps: [tr] }) });
    expect(res.status).toBe(201);
    const bad = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...tr, game_params: { lanes: 7 } }] }) });
    expect(bad.body.issues).toEqual([{ path: "steps.0.game_params.lanes", code: "invalid_setting" }]);
    const t = (await yael(`/v1/templates/${res.body.template.id}`)).body.template;
    const params = buildParams(
      { ...t.steps[0], current_difficulty: 2, sessions_completed: 0, monochrome: false } as Parameters<typeof buildParams>[0],
      { preferred_locale: "en", colour_vision_deficiency: false },
      1,
    );
    expect(params).toMatchObject({ session_mode: "timed", "tunnel_rush.lanes": 10, "tunnel_rush.ship_mode": "move" });
  });

  it("Beep Beep: a per-board time limit of 30-300 s is allowed, and its switches are checked (ADR 0015)", async () => {
    const bb = step({ game_id: "beep-beep", session_mode: "timed_lives", duration_s: 480, lives: 3, trial_window_ms: 90_000, game_params: { hint_button: false, show_answer_on_miss: true, undo: true } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Parking", steps: [bb] }) });
    expect(res.status).toBe(201);
    const short = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...bb, trial_window_ms: 10_000 }] }) });
    expect(short.body.issues).toEqual([{ path: "steps.0.trial_window_ms", code: "trial_window_not_supported" }]);
    const bad = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...bb, game_params: { orientation: "left" } }] }) });
    expect(bad.body.issues).toEqual([{ path: "steps.0.game_params.orientation", code: "unknown_setting" }]); // the exit side follows the hemisphere
  });

  it("Echo Keys: go/no-go and a fixed keyboard size are checked (ADR 0016)", async () => {
    const ek = step({ game_id: "echo-keys", session_mode: "timed", duration_s: 300, lives: null, game_params: { go_no_go: true, key_count: 13 } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Piano", steps: [ek] }) });
    expect(res.status).toBe(201);
    const bad = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...ek, game_params: { key_count: 7 } }] }) });
    expect(bad.body.issues).toEqual([{ path: "steps.0.game_params.key_count", code: "invalid_setting" }]);
  });

  it("Block Crasher: special bricks, their share and the magnet paddle are checked (ADR 0017)", async () => {
    const bc = step({ game_id: "block-crasher", session_mode: "lives", duration_s: null, lives: 3, game_params: { specials: true, special_rate: 0.15, paddle_assist: 2 } });
    const res = await yael("/v1/templates", { method: "POST", body: template({ name: "Bricks", steps: [bc] }) });
    expect(res.status).toBe(201);
    const rate = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...bc, game_params: { special_rate: 0.3 } }] }) });
    expect(rate.body.issues).toEqual([{ path: "steps.0.game_params.special_rate", code: "invalid_setting" }]);
    const assist = await yael("/v1/templates", { method: "POST", body: template({ steps: [{ ...bc, game_params: { paddle_assist: 1.5 } }] }) });
    expect(assist.body.issues).toEqual([{ path: "steps.0.game_params.paddle_assist", code: "invalid_setting" }]);
  });
  it("It's Left, It's Right goes into a template and onto a patient's plan like any other game", async () => {
    const lr = step({ game_id: "its-left-its-right", game_params: {} });
    const made = await yael("/v1/templates", { method: "POST", body: template({ name: "Left and right", steps: [lr] }) });
    expect(made.status).toBe(201);
    expect(made.body.template.steps[0]).toMatchObject({ game_id: "its-left-its-right" });

    const other = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Eli','Baron','2017-05-05','active')`, [other, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [other, ids.yael]);
    const assigned = await yael(`/v1/patients/${other}/assignment`, {
      method: "POST",
      body: { template_id: made.body.template.id, name: "Left and right", description: null, weeks: 2, sessions_per_week: 2, setting: "clinic", start_date: new Date().toISOString().slice(0, 10), steps: [lr] },
    });
    expect(assigned.status).toBe(201);
    expect(assigned.body.assignment.steps[0]).toMatchObject({ game_id: "its-left-its-right" });
    expect(assigned.body.assignment.sessions).toHaveLength(4);
  });
});
