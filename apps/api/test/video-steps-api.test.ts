/** Video steps through the API (ADR 0018): videos between games in templates and assignments, launched and watched once. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const game = (extra: Record<string, unknown> = {}) => ({
  game_id: "tunnel-rush", session_mode: "timed", duration_s: 120, lives: null, difficulty_start: 2, hemisphere: "left", timer_position: "left",
  practice: "off", trial_window_ms: null, game_params: {}, progression: null, ...extra,
});

describe.skipIf(!ADMIN_URL)("video steps API", () => {
  let env: TestEnv;
  let admin: Api;
  let yael: Api;
  let dana: Api;
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  let upload = "";
  let youtube = "";
  let draft = "";
  let patient = "";
  let otherPatient = "";

  const addVideo = async (body: Record<string, unknown>) => (await admin("/v1/admin/videos", { method: "POST", body: { region_ids: [], age_min: null, age_max: null, status: "published", ...body } })).body.video.id as string;
  const consent = async (pid: string, api: Api) => {
    const g = await api(`/v1/patients/${pid}/guardians`, { method: "POST", body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" } });
    await api(`/v1/patients/${pid}/consents`, { method: "POST", body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } } });
  };
  const newPatient = async (clinic: string, therapist: string) => {
    const id = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent')`, [id, clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, therapist]);
    return id;
  };

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    admin = (await platformAdmin(env)).api;
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    const d = await staffClient(env, "dana@synthetic.test", "Dana Kaplan");
    yael = y.api;
    dana = d.api;
    await addMember(env.db, y.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, d.userId, ids.org, ids.other, "therapist");
    upload = await addVideo({ source: "upload", titles: { en: "Shapes" } });
    await admin.raw(`/v1/admin/videos/${upload}/file`, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(64).fill(7) });
    youtube = await addVideo({ source: "youtube", youtube_url: "https://youtu.be/dQw4w9WgXcQ", titles: { en: "Breathing" } });
    draft = await addVideo({ source: "youtube", youtube_url: "https://youtu.be/aaaaaaaaaaa", titles: { en: "Draft" }, status: "draft" });
    patient = await newPatient(ids.clinic, y.userId);
    otherPatient = await newPatient(ids.other, d.userId);
    await consent(patient, yael);
    await consent(otherPatient, dana);
  });
  afterAll(async () => env?.close());

  it("a template mixes games and videos", async () => {
    const res = await yael("/v1/templates", {
      method: "POST",
      body: { clinic_id: ids.clinic, name: "Mix", description: null, weeks: 2, sessions_per_week: 1, setting: "clinic", visibility: "clinic", steps: [game(), { step_type: "video", video_id: youtube }, game({ game_id: "block-crasher" })] },
    });
    expect(res.status).toBe(201);
    const t = res.body.template;
    expect(t.steps.map((s: { step_type: string }) => s.step_type)).toEqual(["game", "video", "game"]);
    expect(t.steps[1]).toMatchObject({ video_id: youtube, ordinal: 2 });
    expect(t.steps[1].game_id).toBeUndefined();
    expect(t.games).toEqual(["tunnel-rush", "block-crasher"]);
    expect(t.items).toEqual([{ kind: "game", game_id: "tunnel-rush" }, { kind: "video", video_id: youtube, title: "Breathing" }, { kind: "game", game_id: "block-crasher" }]);
    const list = await yael(`/v1/templates?clinic=${ids.clinic}`);
    expect(list.body.templates.find((x: { id: string }) => x.id === t.id).items[1].title).toBe("Breathing");
  });

  it("a draft or unknown video cannot be added", async () => {
    for (const v of [draft, randomUUID()]) {
      const res = await yael("/v1/templates", { method: "POST", body: { clinic_id: ids.clinic, name: "Bad", weeks: 2, sessions_per_week: 1, setting: "clinic", visibility: "private", steps: [{ step_type: "video", video_id: v }] } });
      expect(res.status).toBe(400);
      expect(res.body.issues).toEqual([{ path: "steps.0.video_id", code: "video_not_available" }]);
    }
  });

  let sessionId = "";
  it("launch includes a playable video step, with no ticket", async () => {
    const a = await yael(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Mix", weeks: 1, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-02", steps: [game(), { step_type: "video", video_id: upload }, { step_type: "video", video_id: youtube }] },
    });
    expect(a.status).toBe(201);
    expect(a.body.assignment.steps[1]).toMatchObject({ step_type: "video", video_id: upload });
    sessionId = (await env.db.query(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq LIMIT 1`, [patient])).rows[0].id;
    const today = await yael(`/v1/today?clinic=${ids.clinic}&date=2026-11-02`);
    expect(today.body.items[0].items.map((i: { kind: string }) => i.kind)).toEqual(["game", "video", "video"]);
    const res = await yael(`/v1/planned-sessions/${sessionId}/launch`, { method: "POST", body: {} });
    expect(res.status).toBe(200);
    const [g, v, y] = res.body.launch.steps;
    expect(g.kind).toBe("game");
    expect(v).toMatchObject({ kind: "video", done: false, video: { id: upload, version: 2, source: "upload", title: "Shapes", file_url: `/v1/videos/${upload}/file?v=2` } });
    expect(v.video.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(v.ticket).toBeUndefined();
    expect(y.video).toMatchObject({ source: "youtube", youtube_id: "dQw4w9WgXcQ", file_url: null });
  });

  const view = (step: string, video: string, extra: Record<string, unknown> = {}) => ({
    client_view_id: uuidv7(), planned_session_id: sessionId, assignment_step_id: step, video_id: video, video_version: 1,
    started_at: "2026-11-02T08:00:00.000Z", ended_at: "2026-11-02T08:01:00.000Z", watched_s: 60, completed: true, ...extra,
  });

  it("a view for a step outside the session, or of another video, is refused", async () => {
    const launch = (await yael(`/v1/planned-sessions/${sessionId}/launch`, { method: "POST", body: {} })).body.launch;
    const gameStep = launch.steps[0].assignment_step_id;
    const videoStep = launch.steps[1].assignment_step_id;
    expect((await yael("/v1/video-views", { method: "POST", body: view(gameStep, upload) })).body.error).toBe("step_mismatch");
    expect((await yael("/v1/video-views", { method: "POST", body: view(videoStep, youtube) })).body.error).toBe("step_mismatch");
    expect((await dana("/v1/video-views", { method: "POST", body: view(videoStep, upload) })).status).toBe(404);
  });

  it("watched videos count once and close the session with the game", async () => {
    const launch = (await yael(`/v1/planned-sessions/${sessionId}/launch`, { method: "POST", body: {} })).body.launch;
    const [g, v, y] = launch.steps;
    const first = view(v.assignment_step_id, upload, { video_version: 2 });
    const r1 = await yael("/v1/video-views", { method: "POST", body: first });
    expect(r1.status).toBe(201);
    expect(r1.body).toEqual({ outcome: "accepted", planned_session_status: "in_progress" });
    const again = await yael("/v1/video-views", { method: "POST", body: first });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe("duplicate");
    expect((await env.db.query(`SELECT count(*)::int AS n FROM app.video_view WHERE planned_session_id = $1`, [sessionId])).rows[0].n).toBe(1);
    const relaunch = (await yael(`/v1/planned-sessions/${sessionId}/launch`, { method: "POST", body: {} })).body.launch;
    expect(relaunch.steps[1].done).toBe(true);

    await yael("/v1/video-views", { method: "POST", body: view(y.assignment_step_id, youtube, { completed: false, watched_s: 20 }) });
    const result = await yael("/v1/results", {
      method: "POST",
      body: {
        ticket: g.ticket,
        envelope: {
          envelope_version: "1", session_id: uuidv7(), game_id: "tunnel-rush", game_version: "2.0.0", demo: false, started_at: "2026-11-02T08:02:00.000Z", ended_at: "2026-11-02T08:04:00.000Z",
          status: "time_up", end_reason: "time_up", mode: "timed", params: g.params, active_ms: 120000, paused_ms: 0, lives_start: null, lives_lost: 0, lives_remaining: null, life_loss_events: 0,
          difficulty_start: 2, levels: [], metrics: {}, trials: [], practice_completed: true,
          std: { trials_total: 10, correct: 8, errors: 2, timeouts: 0, accuracy: 0.8, rt_mean_ms: 500, rt_median_ms: 500, rt_sd_ms: 50, rt_min_ms: 300, rt_cv: 0.1, left_accuracy: 0.8, right_accuracy: 0.8, left_rt_median_ms: 500, right_rt_median_ms: 500 },
        },
      },
    });
    expect(result.status).toBe(201);
    expect(result.body.planned_session_status).toBe("done");
    const late = await yael("/v1/video-views", { method: "POST", body: view(v.assignment_step_id, upload, { video_version: 2 }) });
    expect(late.status).toBe(409);
    expect(late.body.error).toBe("session_closed");
  });

  it("an assignment keeps an archived video", async () => {
    await admin(`/v1/admin/videos/${youtube}`, { method: "PUT", body: { source: "youtube", youtube_url: "https://youtu.be/dQw4w9WgXcQ", titles: { en: "Breathing" }, region_ids: [], age_min: null, age_max: null, status: "archived" } });
    const a = await yael(`/v1/patients/${patient}/assignment`);
    expect(a.body.assignment.steps[2]).toMatchObject({ step_type: "video", video_id: youtube });
    const next = (await env.db.query(`SELECT id FROM app.planned_session WHERE patient_id = $1 AND status = 'planned' ORDER BY seq LIMIT 1`, [patient])).rows[0].id;
    const launch = await yael(`/v1/planned-sessions/${next}/launch`, { method: "POST", body: {} });
    expect(launch.body.launch.steps[2].video).toMatchObject({ id: youtube, title: "Breathing" });
    expect(((await yael(`/v1/videos`)).body.videos as Array<{ id: string }>).some((x) => x.id === youtube)).toBe(false); // gone from the picker
  });
});
