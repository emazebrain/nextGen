/**
 * Practising at home from the parent portal: a guardian sees what is in each of their own child's coming sessions
 * (the names of its game-based activities and videos) and can start the next home session in line. They never see
 * another child's sessions, and cannot start a clinic session or jump ahead. All people here are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { envelope, uuidv7 } from "./offline-fixture.ts";
import { ADMIN_URL, addMember, guardianClient, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("parent portal: session contents and starting in order", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let miri: { api: Api; userId: string };
  let other: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const dana = randomUUID();
  const eli = randomUUID();
  let sessions: { id: string; seq: number }[] = [];

  const step = {
    game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 300, lives: 3, difficulty_start: 2,
    hemisphere: "left", timer_position: "left", practice: "auto", trial_window_ms: null, game_params: {},
    progression: { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 },
  };

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    miri = await guardianClient(env, "miri@synthetic.test", "Miri Katz");
    other = await guardianClient(env, "other@synthetic.test", "Other Parent");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    for (const [id, given] of [[dana, "Dana"], [eli, "Eli"]] as const) {
      await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,$3,'Katz','2018-03-01','active')`, [id, ids.clinic, given]);
      await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, yael.userId]);
      await env.db.query(`INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`, [id, yael.userId]);
    }
    for (const [user, name, child] of [[miri.userId, "Miri Katz", dana], [other.userId, "Other Parent", eli]] as const) {
      const g = await env.db.query<{ id: string }>(`INSERT INTO app.guardian (clinic_id, full_name, phone, created_by, user_id) VALUES ($1,$2,'+972 50 000 0000',$3,$4) RETURNING id`, [ids.clinic, name, yael.userId, user]);
      await env.db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) VALUES ($1,$2,'parent',true)`, [g.rows[0]!.id, child]);
    }
    const start = new Date(Date.now() + 2 * 86_400_000).toISOString().slice(0, 10); // the first session is planned for later this week
    const res = await yael.api(`/v1/patients/${dana}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Home practice", description: null, weeks: 2, sessions_per_week: 2, setting: "home", start_date: start, steps: [step, { ...step, hemisphere: "right", timer_position: "left" }] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    sessions = res.body.assignment.sessions;
    // The third session is held at the clinic.
    await env.db.query(`UPDATE app.planned_session SET location = 'clinic' WHERE id = $1`, [sessions[2]!.id]);
  });
  afterAll(async () => env?.close());

  it("lists the child's coming sessions with what is in each, and marks the one that can be started", async () => {
    const res = await miri.api(`/v1/parent/children/${dana}/sessions`);
    expect(res.status).toBe(200);
    const up = res.body.upcoming as { id: string; seq: number; location: string; startable: boolean; items: unknown[] }[];
    expect(up.map((s) => s.seq)).toEqual([1, 2, 3, 4]);
    expect(up.map((s) => s.location)).toEqual(["home", "home", "clinic", "home"]);
    // Only the first open home session can be started — even though its planned date has not come yet.
    expect(up.map((s) => s.startable)).toEqual([true, false, false, false]);
    for (const s of up) expect(s.items).toEqual([{ kind: "game", game_id: "catch-me-if-you-can" }, { kind: "game", game_id: "catch-me-if-you-can" }]);
    // Names only: no settings, levels or results travel with the list.
    expect(JSON.stringify(res.body)).not.toMatch(/difficulty|game_params|hemisphere/);
  });

  it("another guardian sees nothing of this child", async () => {
    expect((await other.api(`/v1/parent/children/${dana}/sessions`)).status).toBe(404);
    expect((await other.api(`/v1/parent/children/${dana}/sessions/${sessions[0]!.id}/launch`, { method: "POST" })).status).toBe(403);
  });

  it("a guardian cannot jump ahead or start a clinic session", async () => {
    const later = await miri.api(`/v1/parent/children/${dana}/sessions/${sessions[1]!.id}/launch`, { method: "POST" });
    expect(later.status).toBe(409);
    expect(later.body.error).toBe("not_next_session");
    const clinic = await miri.api(`/v1/parent/children/${dana}/sessions/${sessions[2]!.id}/launch`, { method: "POST" });
    expect(clinic.status).toBe(403);
    expect(clinic.body.error).toBe("not_home_session");
  });

  it("starts the next session, with its game-based activities ready to play; then the following one opens", async () => {
    const res = await miri.api(`/v1/parent/children/${dana}/sessions/${sessions[0]!.id}/launch`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.launch.steps).toHaveLength(2);
    expect(res.body.launch.steps[0]).toMatchObject({ kind: "game", game_id: "catch-me-if-you-can" });

    // The child plays both steps at home: each result is kept, and the second one closes the session.
    const [s0, s1] = res.body.launch.steps;
    const r0 = await miri.api("/v1/parent/results", { method: "POST", body: { ticket: s0.ticket, envelope: envelope(s0.params, 0.9) } });
    expect(r0.status, JSON.stringify(r0.body)).toBe(201);
    expect(r0.body).toMatchObject({ outcome: "accepted", planned_session_status: "in_progress" });
    const r1 = await miri.api("/v1/parent/results", { method: "POST", body: { ticket: s1.ticket, envelope: envelope(s1.params, 0.8) } });
    expect(r1.body).toMatchObject({ outcome: "accepted", planned_session_status: "done" });
    // The staff door stays shut to an account without two-step sign-in, and the parent door takes home tickets only.
    expect((await miri.api("/v1/results", { method: "POST", body: { ticket: s1.ticket, envelope: envelope(s1.params, 0.8) } })).body.error).toBe("mfa_required");
    const staffLaunch = (await yael.api(`/v1/planned-sessions/${sessions[2]!.id}/launch`, { method: "POST", body: {} })).body.launch;
    const viaParent = await yael.api("/v1/parent/results", { method: "POST", body: { ticket: staffLaunch.steps[0].ticket, envelope: envelope(staffLaunch.steps[0].params, 0.8) } });
    expect(viaParent.status).toBe(403);
    // Another guardian cannot send results with this child's ticket.
    const stolen = await other.api("/v1/parent/results", { method: "POST", body: { ticket: s1.ticket, envelope: envelope(s1.params, 0.8) } });
    expect(stolen.status).toBe(403);
    // Stored as home play: on behalf of the child's therapist, with the guardian as the one who sent it.
    const kept = await env.db.query(`SELECT location, recorded_by, uploaded_by, review_reason FROM app.game_session WHERE planned_session_id = $1 ORDER BY ended_at, id`, [sessions[0]!.id]);
    expect(kept.rows).toHaveLength(2);
    for (const g of kept.rows) expect(g).toMatchObject({ location: "home", recorded_by: yael.userId, uploaded_by: miri.userId });
    // Every attempt is in the raw log, the refused one too.
    const raw = await env.db.query(`SELECT outcome, recorded_by FROM app.session_result_raw WHERE planned_session_id = $1 ORDER BY received_at, id`, [sessions[0]!.id]);
    expect(raw.rows.map((r) => r.outcome)).toEqual(["accepted", "accepted", "rejected"]);

    const up = (await miri.api(`/v1/parent/children/${dana}/sessions`)).body.upcoming as { seq: number; startable: boolean }[];
    expect(up.map((s) => [s.seq, s.startable])).toEqual([[2, true], [3, false], [4, false]]);
  });

  it("the staff calendar carries what is in each session, so a therapist can see and start it from there", async () => {
    const from = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const res = await yael.api(`/v1/calendar/events?clinic=${ids.clinic}&from=${from}&to=${to}`);
    expect(res.status).toBe(200);
    const mine = (res.body.events as { kind: string; patient_id: string; items?: unknown[] }[]).filter((e) => e.kind === "session" && e.patient_id === dana);
    expect(mine.length).toBeGreaterThan(0);
    for (const e of mine) expect(e.items).toEqual([{ kind: "game", game_id: "catch-me-if-you-can" }, { kind: "game", game_id: "catch-me-if-you-can" }]);
  });

  it("a clinic-only protocol cannot be started at home until the therapist sets it to home or both", async () => {
    const start = new Date().toISOString().slice(0, 10);
    const res = await yael.api(`/v1/patients/${eli}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Clinic work", description: null, weeks: 1, sessions_per_week: 2, setting: "clinic", start_date: start, steps: [step] },
    });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const a = res.body.assignment as { id: string; sessions: { id: string }[] };
    const list = async () => (await other.api(`/v1/parent/children/${eli}/sessions`)).body.upcoming as { location: string; setting: string; startable: boolean }[];
    expect((await list()).map((s) => s.startable)).toEqual([false, false]);
    expect((await other.api(`/v1/parent/children/${eli}/sessions/${a.sessions[0]!.id}/launch`, { method: "POST" })).status).toBe(403);

    // A guardian cannot change it; the therapist can.
    expect((await other.api(`/v1/assignments/${a.id}`, { method: "PATCH", body: { setting: "home" } })).status).toBe(403);
    expect((await yael.api(`/v1/assignments/${a.id}`, { method: "PATCH", body: { setting: "nowhere" } })).status).toBe(400);
    const mixed = await yael.api(`/v1/assignments/${a.id}`, { method: "PATCH", body: { setting: "mixed" } });
    expect(mixed.status).toBe(200);
    expect(mixed.body.assignment.setting).toBe("mixed");
    // "Both": the sessions stay on the clinic's list, and the next one can also be started at home.
    expect((await list()).map((s) => [s.location, s.startable])).toEqual([["clinic", true], ["clinic", false]]);
    expect((await other.api(`/v1/parent/children/${eli}/sessions/${a.sessions[1]!.id}/launch`, { method: "POST" })).body.error).toBe("not_next_session");
    expect((await other.api(`/v1/parent/children/${eli}/sessions/${a.sessions[0]!.id}/launch`, { method: "POST" })).status).toBe(200);

    // "At home": the open sessions move home.
    expect((await yael.api(`/v1/assignments/${a.id}`, { method: "PATCH", body: { setting: "home" } })).status).toBe(200);
    expect((await list()).map((s) => [s.location, s.startable])).toEqual([["home", true], ["home", false]]);
  });

  it("a video watched at home is kept, and only the child's own guardian can send it", async () => {
    const admin = (await platformAdmin(env)).api;
    const made = await admin("/v1/admin/videos", { method: "POST", body: { region_ids: [], age_min: null, age_max: null, status: "draft", source: "upload", titles: { en: "Warm-up" } } });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    const video = made.body.video.id as string;
    await admin.raw(`/v1/admin/videos/${video}/file`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(64).fill(7) });
    await admin(`/v1/admin/videos/${video}`, { method: "PUT", body: { source: "upload", titles: { en: "Warm-up" }, region_ids: [], age_min: null, age_max: null, status: "published" } });
    const noam = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noam','Katz','2018-03-01','active')`, [noam, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [noam, yael.userId]);
    await env.db.query(`INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`, [noam, yael.userId]);
    await env.db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) SELECT g.id, $1, 'parent', true FROM app.guardian g WHERE g.user_id = $2`, [noam, miri.userId]);
    const a = await yael.api(`/v1/patients/${noam}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Video first", description: null, weeks: 1, sessions_per_week: 1, setting: "home", start_date: new Date().toISOString().slice(0, 10), steps: [{ step_type: "video", video_id: video }, step] },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const sid = a.body.assignment.sessions[0].id as string;

    const launch = (await miri.api(`/v1/parent/children/${noam}/sessions/${sid}/launch`, { method: "POST" })).body.launch;
    const [v, g] = launch.steps;
    expect(v).toMatchObject({ kind: "video", video: { id: video, title: "Warm-up" } });
    // The guardian's device can load the file.
    expect(v.video.file_url).toBe(`/v1/parent/videos/${video}/file?v=${v.video.version}`);
    expect((await miri.api.raw(v.video.file_url)).status).toBe(200);
    // The parent door for videos opens for guardians only; a disabled guardian account is refused everywhere.
    expect((await yael.api.raw(v.video.file_url)).status).toBe(404);
    await env.db.query(`UPDATE app.app_user SET status = 'disabled' WHERE id = $1`, [other.userId]);
    expect((await other.api(`/v1/parent/children/${eli}/sessions`)).body.error).toBe("account_disabled");
    await env.db.query(`UPDATE app.app_user SET status = 'active' WHERE id = $1`, [other.userId]);

    const view = { client_view_id: uuidv7(), planned_session_id: sid, assignment_step_id: v.assignment_step_id, video_id: video, video_version: v.video.version, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), watched_s: 60, completed: true };
    expect((await other.api("/v1/parent/video-views", { method: "POST", body: { ...view, client_view_id: uuidv7() } })).status).toBe(404);
    const seen = await miri.api("/v1/parent/video-views", { method: "POST", body: view });
    expect(seen.status, JSON.stringify(seen.body)).toBe(201);
    expect(seen.body).toEqual({ outcome: "accepted", planned_session_status: "in_progress", review_reason: null });
    const played = await miri.api("/v1/parent/results", { method: "POST", body: { ticket: g.ticket, envelope: envelope(g.params, 0.9) } });
    expect(played.body).toMatchObject({ outcome: "accepted", planned_session_status: "done" });
    const kept = await env.db.query(`SELECT recorded_by, uploaded_by FROM app.video_view WHERE planned_session_id = $1`, [sid]);
    expect(kept.rows).toEqual([{ recorded_by: yael.userId, uploaded_by: miri.userId }]);
  });
});
