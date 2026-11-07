/**
 * The offline bundle (offline devices spec §7.3–7.4, §8.3): what a therapist's space on a device holds, and the
 * library manifest for "Download everything".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { OFFLINE_TICKET_TTL_S } from "../src/modules/sessions/routes.ts";

const iso = (d: Date) => d.toISOString().slice(0, 10);

describe.skipIf(!ADMIN_URL)("offline bundle", () => {
  let env: TestEnv;
  let admin: Api;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  let upload = "";
  let youtube = "";
  let mine = "";
  let colleagues = "";
  const device = randomUUID();

  const patient = async (therapist: string, weeks: number, perWeek: number, start: string) => {
    const id = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent')`, [id, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, therapist]);
    const who = therapist === yael.userId ? yael.api : noam.api;
    const g = await who(`/v1/patients/${id}/guardians`, { method: "POST", body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" } });
    await who(`/v1/patients/${id}/consents`, { method: "POST", body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } } });
    const a = await who(`/v1/patients/${id}/assignment`, {
      method: "POST",
      body: {
        template_id: null, name: "Attention", description: null, weeks, sessions_per_week: perWeek, setting: "clinic", start_date: start,
        steps: [
          { game_id: "catch-me-if-you-can", session_mode: "timed", duration_s: 120, lives: null, difficulty_start: 2, hemisphere: "left", timer_position: "left", practice: "auto", trial_window_ms: null, game_params: {}, progression: null },
          { step_type: "video", video_id: upload },
          { step_type: "video", video_id: youtube },
        ],
      },
    });
    expect(a.status).toBe(201);
    return id;
  };

  const bundle = (who: Api, dev = device) => who(`/v1/offline/bundle?device=${dev}&lang=en`);

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    admin = (await platformAdmin(env)).api;
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    noam = await staffClient(env, "noam@synthetic.test", "Noam Cohen");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noam.userId, ids.org, ids.clinic, "therapist");
    const mk = async (body: Record<string, unknown>) => (await admin("/v1/admin/videos", { method: "POST", body: { titles: { en: "Clip" }, region_ids: [], age_min: null, age_max: null, ...body } })).body.video.id as string;
    youtube = await mk({ source: "youtube", youtube_url: "https://youtu.be/dQw4w9WgXcQ", status: "published" });
    upload = await mk({ source: "upload", status: "draft" });
    const bytes = new Uint8Array(2048).fill(7);
    expect((await admin.raw(`/v1/admin/videos/${upload}/file`, { method: "PUT", body: bytes, headers: { "content-type": "video/mp4" } })).status).toBe(200);
    expect((await admin(`/v1/admin/videos/${upload}`, { method: "PUT", body: { source: "upload", titles: { en: "Clip" }, region_ids: [], age_min: null, age_max: null, status: "published" } })).status).toBe(200);
    const today = new Date();
    mine = await patient(yael.userId, 6, 3, iso(today));
    colleagues = await patient(noam.userId, 2, 2, iso(today));
    await yael.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk" } });
    await yael.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: ids.clinic } });
  });
  afterAll(async () => env?.close());

  it("the bundle holds only the caller's caseload", async () => {
    const res = await bundle(yael.api);
    expect(res.status).toBe(200);
    const b = res.body;
    expect(b.me.user.id).toBe(yael.userId);
    expect(b.caseload.map((p: { id: string }) => p.id)).toEqual([mine]);
    expect(Object.keys(b.patients)).toEqual([mine]);
    expect(b.patients[mine].care_team.some((t: { user_id: string }) => t.user_id === yael.userId)).toBe(true);
    expect(b.assignments).toHaveLength(1);
    expect(b.packages.every((p: { assignment: { id: string } }) => p.assignment.id === b.assignments[0].id)).toBe(true);
    expect(b.packages.every((p: { patient: { id: string } }) => p.patient.id === mine)).toBe(true);
    expect(JSON.stringify(b)).not.toContain(colleagues);
    expect(Array.isArray(b.templates)).toBe(true);
  });

  it("packages cover the next 4 sessions and the next 14 days, without starting any", async () => {
    const b = (await bundle(yael.api)).body;
    const expected = await env.db.query<{ id: string }>(
      `SELECT id FROM (SELECT id, planned_date, row_number() OVER (ORDER BY seq) AS n FROM app.planned_session WHERE patient_id = $1 AND status IN ('planned','in_progress')) x
        WHERE n <= 4 OR planned_date <= current_date + 14 ORDER BY id`,
      [mine],
    );
    const got = (b.packages as Array<{ planned_session_id: string }>).map((p) => p.planned_session_id).sort();
    expect(got).toEqual(expected.rows.map((r) => r.id).sort());
    expect(got.length).toBeGreaterThan(4);
    expect(got.length).toBeLessThan(18);
    const statuses = await env.db.query(`SELECT DISTINCT status FROM app.planned_session WHERE patient_id = $1`, [mine]);
    expect(statuses.rows).toEqual([{ status: "planned" }]);
    const pkg = b.packages[0];
    expect(pkg.planned_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    const game = pkg.steps[0];
    expect(game).toMatchObject({ kind: "game", game_id: "catch-me-if-you-can", practice_setting: "auto", sessions_completed: 0, difficulty: 2, progression: null });
    expect(game.allowed.difficulty).toEqual({ min: 1, max: 5 });
    for (const k of ["difficulty", "seed", "practice", "instructions"]) expect(game.allowed.exact).not.toHaveProperty(k);
    expect(game.allowed.exact).toMatchObject({ session_mode: "timed", duration_s: 120, hemisphere: "left" });
  });

  it("package tickets are v2, 30 days, bound to the caller and device", async () => {
    const b = (await bundle(yael.api)).body;
    const claims = env.tickets.verify(b.packages[0].steps[0].ticket)!;
    expect(claims).toMatchObject({ v: 2, sub: yael.userId, dev: device, pid: mine, psid: b.packages[0].planned_session_id });
    expect(claims.exp - claims.iat).toBe(OFFLINE_TICKET_TTL_S);
  });

  it("videos list the versions the packages use", async () => {
    const b = (await bundle(yael.api)).body;
    expect(b.videos).toHaveLength(1); // YouTube is never stored
    expect(b.videos[0]).toMatchObject({ id: upload, version: 2, bytes: 2048 });
    expect(b.videos[0].sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(b.videos[0].file_url).toBe(`/v1/videos/${upload}/file?v=2`);
    const steps = b.packages[0].steps;
    expect(steps[1]).toMatchObject({ kind: "video", video: { id: upload, version: 2 } });
    expect(steps[2]).toMatchObject({ kind: "video", video: { id: youtube, source: "youtube", file_url: null } });
  });

  it("no bundle without a space on the device", async () => {
    expect((await bundle(noam.api)).status).toBe(409);
    expect((await bundle(noam.api)).body.error).toBe("no_space");
    expect((await bundle(yael.api, randomUUID())).status).toBe(409);
  });

  it("ended spaces are reported", async () => {
    await noam.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: ids.clinic } });
    const spaces = (await noam.api(`/v1/devices/${device}/spaces`)).body as Array<{ id: string; user_id: string }>;
    const his = spaces.find((s) => s.user_id === noam.userId)!.id;
    expect((await noam.api(`/v1/devices/${device}/spaces/${his}`, { method: "DELETE" })).status).toBe(204);
    expect((await bundle(yael.api)).body.ended_spaces).toContain(his);
  });

  it("the library lists every published uploaded video", async () => {
    const res = await yael.api("/v1/offline/library");
    expect(res.status).toBe(200);
    expect(res.body.videos.map((v: { id: string }) => v.id)).toEqual([upload]);
  });
});
