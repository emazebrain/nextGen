/**
 * Uploaded session music: who may upload at which level, who gets to see and remove what, the rights confirmation,
 * and what a child's session ends up playing. All people here are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, guardianClient, platformAdmin, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("session music API", () => {
  let env: TestEnv;
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  type Who = { api: Api; userId: string };
  let admin: Who, orgAdmin: Who, manager: Who, yael: Who, dan: Who, noa: Who, miri: Who, stranger: Who;
  const dana = randomUUID();
  const made: Record<string, string> = {};

  const audio = () => new Uint8Array(256).fill(3);
  const upload = (who: Who, q: Record<string, string>, type = "audio/mpeg") =>
    who.api.raw(`/v1/music?${new URLSearchParams(q)}`, { method: "POST", headers: { "content-type": type }, body: audio() });
  const titles = async (who: Who, clinic: string) => ((await who.api(`/v1/music?clinic=${clinic}`)).body.tracks as { title: string }[]).map((t) => t.title).sort();

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    admin = await platformAdmin(env);
    orgAdmin = await staffClient(env, "org@synthetic.test", "Org Admin");
    manager = await staffClient(env, "manager@synthetic.test", "Clinic Manager");
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    dan = await staffClient(env, "dan@synthetic.test", "Dan Levi");
    noa = await staffClient(env, "noa@synthetic.test", "Noa Haifa");
    miri = await guardianClient(env, "miri@synthetic.test", "Miri Katz");
    stranger = await guardianClient(env, "other@synthetic.test", "Other Parent");
    await env.db.query(`INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1,$2,NULL,'org_admin')`, [orgAdmin.userId, ids.org]);
    await addMember(env.db, manager.userId, ids.org, ids.clinic, "clinic_manager");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, dan.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noa.userId, ids.org, ids.other, "therapist");
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Dana','Katz','2018-03-01','active')`, [dana, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [dana, yael.userId]);
    await env.db.query(`INSERT INTO app.consent (patient_id, purpose, decision, policy_version, method, captured_by, record_hash) VALUES ($1,'treatment','granted','v1','in_clinic_esign',$2,'\\x00')`, [dana, yael.userId]);
    for (const [who, child] of [[miri, dana]] as const) {
      const g = await env.db.query<{ id: string }>(`INSERT INTO app.guardian (clinic_id, full_name, phone, created_by, user_id) VALUES ($1,'Miri Katz','+972 50 000 0000',$2,$3) RETURNING id`, [ids.clinic, yael.userId, who.userId]);
      await env.db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) VALUES ($1,$2,'parent',true)`, [g.rows[0]!.id, child]);
    }
  });
  afterAll(async () => env?.close());

  it("refuses an upload without the rights confirmation, of the wrong kind, or with bad details", async () => {
    const ok = { scope: "personal", clinic: ids.clinic, hemisphere: "right", title: "Sea" };
    const noRights = await upload(yael, ok);
    expect(noRights.status).toBe(400);
    expect((await noRights.json()).error).toBe("rights_required");
    expect((await upload(yael, { ...ok, rights: "confirmed" }, "video/mp4")).status).toBe(415);
    expect((await upload(yael, { ...ok, rights: "confirmed", hemisphere: "both" })).status).toBe(400);
    expect((await upload(yael, { ...ok, rights: "confirmed", title: "" })).status).toBe(400);
    expect((await env.db.query(`SELECT count(*)::int AS n FROM app.music_track`)).rows[0].n).toBe(0);
  });

  it("each role uploads at its own level and below, never above", async () => {
    const send = async (who: Who, scope: string, title: string, hemisphere = "right", clinic = ids.clinic) => {
      const res = await upload(who, { scope, clinic, hemisphere, title, rights: "confirmed" });
      const body = await res.json();
      if (res.status === 201) made[title] = body.track.id;
      return res.status;
    };
    // Therapist: personal only.
    expect(await send(yael, "personal", "Yael right")).toBe(201);
    expect(await send(yael, "clinic", "nope")).toBe(403);
    expect(await send(yael, "organization", "nope")).toBe(403);
    expect(await send(yael, "platform", "nope")).toBe(403);
    expect(await send(yael, "personal", "nope", "right", ids.other)).toBe(403); // not her clinic
    // Clinic manager: the clinic (and their own personal), not the organization.
    expect(await send(manager, "clinic", "Clinic right")).toBe(201);
    expect(await send(manager, "clinic", "Clinic left", "left")).toBe(201);
    expect(await send(manager, "organization", "nope")).toBe(403);
    // Organization admin: the organization and any of its clinics.
    expect(await send(orgAdmin, "organization", "Org left", "left")).toBe(201);
    expect(await send(orgAdmin, "clinic", "Haifa right", "right", ids.other)).toBe(201);
    expect(await send(orgAdmin, "platform", "nope")).toBe(403);
    // Platform admin: everywhere.
    const p = await upload(admin, { scope: "platform", hemisphere: "left", title: "Platform left", rights: "confirmed" });
    expect(p.status).toBe(201);
    made["Platform left"] = (await p.json()).track.id;
    // The confirmation is recorded with the track.
    expect((await env.db.query(`SELECT count(*)::int AS n FROM app.music_track WHERE rights_confirmed_at IS NOT NULL`)).rows[0].n).toBe(6);
  });

  it("a track reaches everyone at its level and below; a higher role sees what is under it", async () => {
    // Yael: her own, her clinic's, the organization's and the platform's.
    expect(await titles(yael, ids.clinic)).toEqual(["Clinic left", "Clinic right", "Org left", "Platform left", "Yael right"]);
    // Dan, same clinic: everything but Yael's personal track.
    expect(await titles(dan, ids.clinic)).toEqual(["Clinic left", "Clinic right", "Org left", "Platform left"]);
    // The manager sees the therapist's personal track too.
    expect(await titles(manager, ids.clinic)).toContain("Yael right");
    // Noa, the other clinic: her clinic's, the organization's and the platform's — nothing of Tel Aviv.
    expect(await titles(noa, ids.other)).toEqual(["Haifa right", "Org left", "Platform left"]);
    expect(await titles(noa, ids.clinic)).toEqual(["Org left", "Platform left"]);
    // What each may upload to in the Tel Aviv clinic.
    const scopes = async (who: Who) => (await who.api(`/v1/music?clinic=${ids.clinic}`)).body.upload_scopes;
    expect(await scopes(yael)).toEqual(["personal"]);
    expect(await scopes(manager)).toEqual(["clinic", "personal"]);
    expect(await scopes(orgAdmin)).toEqual(["organization", "clinic", "personal"]);
    expect(await scopes(admin)).toEqual(["platform", "organization", "clinic", "personal"]);
    // A guardian has no place here.
    expect((await miri.api(`/v1/music?clinic=${ids.clinic}`)).status).toBe(403);
  });

  it("only the level's own role, or one above it, renames or removes a track", async () => {
    expect((await dan.api(`/v1/music/${made["Clinic right"]}`, { method: "PATCH", body: { title: "Mine now" } })).status).toBe(404);
    expect((await dan.api(`/v1/music/${made["Clinic right"]}`, { method: "DELETE" })).status).toBe(404);
    expect((await yael.api(`/v1/music/${made["Org left"]}`, { method: "DELETE" })).status).toBe(404);
    expect((await manager.api(`/v1/music/${made["Platform left"]}`, { method: "DELETE" })).status).toBe(404);
    const renamed = await yael.api(`/v1/music/${made["Yael right"]}`, { method: "PATCH", body: { title: "Yael sea" } });
    expect(renamed.body.track).toMatchObject({ title: "Yael sea", hemisphere: "right", mine: true, can_manage: true });
    expect((await manager.api(`/v1/music/${made["Clinic left"]}`, { method: "PATCH", body: { hemisphere: "right" } })).body.track.hemisphere).toBe("right");
    expect((await manager.api(`/v1/music/${made["Clinic left"]}`, { method: "PATCH", body: { hemisphere: "left" } })).status).toBe(200);
    // The file plays for those who can see the track, with byte ranges for seeking.
    const file = await dan.api.raw(`/v1/music/${made["Clinic right"]}/file`, { headers: { range: "bytes=0-9" } });
    expect(file.status).toBe(206);
    expect(file.headers.get("content-type")).toBe("audio/mpeg");
    expect((await dan.api.raw(`/v1/music/${made["Yael right"]}/file`)).status).toBe(404);
  });

  it("a session plays the most specific level that has a track for the hemisphere", async () => {
    const step = {
      game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 300, lives: 3, difficulty_start: 2,
      hemisphere: "left", timer_position: "left", practice: "auto", trial_window_ms: null, game_params: {},
      progression: { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 },
    };
    const a = await yael.api(`/v1/patients/${dana}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Home", description: null, weeks: 1, sessions_per_week: 2, setting: "home", start_date: new Date().toISOString().slice(0, 10), steps: [step] },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const sid = a.body.assignment.sessions[0].id as string;

    // Music off: nothing about music travels with the session.
    expect((await yael.api(`/v1/planned-sessions/${sid}/launch`, { method: "POST", body: {} })).body.launch.music_tracks).toBeUndefined();
    await yael.api(`/v1/patients/${dana}`, { method: "PATCH", body: { music_enabled: true } });

    const staff = (await yael.api(`/v1/planned-sessions/${sid}/launch`, { method: "POST", body: {} })).body.launch;
    // Right: Yael's own track beats the clinic's. Left: she has none, so the clinic's beats the organization's and the platform's.
    expect(staff.music_tracks.map((t: { title: string; hemisphere: string }) => `${t.hemisphere}:${t.title}`).sort()).toEqual(["left:Clinic left", "right:Yael sea"]);
    expect(staff.music_tracks[0].url).toMatch(/^\/v1\/music\/[0-9a-f-]+\/file$/);

    // At home the guardian gets the same tracks, through the parent portal's own address, and can play them.
    const home = (await miri.api(`/v1/parent/children/${dana}/sessions/${sid}/launch`, { method: "POST" })).body.launch;
    expect(home.music).toBe(true);
    expect(home.music_tracks.map((t: { title: string }) => t.title).sort()).toEqual(["Clinic left", "Yael sea"]);
    const url = home.music_tracks.find((t: { title: string }) => t.title === "Yael sea").url as string;
    expect(url).toBe(`/v1/parent/music/${made["Yael right"]}/file`);
    expect((await miri.api.raw(url)).status).toBe(200);
    // Not a track of her child's sessions (another clinic's), and not for another guardian.
    expect((await miri.api.raw(`/v1/parent/music/${made["Haifa right"]}/file`)).status).toBe(404);
    expect((await stranger.api.raw(url)).status).toBe(404);

    // The manager removes the therapist's track; the clinic's own right-side track takes over.
    expect((await manager.api(`/v1/music/${made["Yael right"]}`, { method: "DELETE" })).status).toBe(200);
    const after = (await yael.api(`/v1/planned-sessions/${sid}/launch`, { method: "POST", body: {} })).body.launch;
    expect(after.music_tracks.map((t: { title: string }) => t.title).sort()).toEqual(["Clinic left", "Clinic right"]);
    expect((await miri.api.raw(url)).status).toBe(404);
  });
});
