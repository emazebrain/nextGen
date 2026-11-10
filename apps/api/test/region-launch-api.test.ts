/**
 * Brain-region filters at launch (spec 2026-11-09 §4–§6): the table's row reaches the game, decides the hemisphere it
 * runs as and the background of games that have one; offline tickets sign it, and only a change of the step's own
 * filter counts as "step changed".
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { envelope, step, uuidv7 } from "./offline-fixture.ts";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";
import { allowedParamsFor, OFFLINE_TICKET_TTL_S } from "../src/modules/sessions/routes.ts";
import { timerPositionFor } from "@emb/session-rules";

type Params = Record<string, unknown> & { region?: { path: string; sublobe: string; drawn: boolean; revision: number; bg_temperature: string } };

describe.skipIf(!ADMIN_URL)("brain-region filters at launch", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const device = randomUUID();
  const region = new Map<string, string>();
  const rid = (p: string) => region.get(p)!;

  /** A consented patient whose protocol is one game step with the given settings; returns sessions and the step. */
  const patientWith = async (extra: Record<string, unknown>) => {
    const patient = randomUUID();
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','pending_consent')`, [patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [patient, yael.userId]);
    const g = await yael.api(`/v1/patients/${patient}/guardians`, { method: "POST", body: { full_name: "Miri Levi", relationship: "mother", is_legal_guardian: true, phone: "+972 50 000 0000", preferred_locale: "he" } });
    await yael.api(`/v1/patients/${patient}/consents`, { method: "POST", body: { guardian_id: g.body.id, signer_name: "Miri Levi", locale: "he", decisions: { treatment: "granted", home_program: "granted", research_deidentified: "withdrawn" } } });
    const a = await yael.api(`/v1/patients/${patient}/assignment`, {
      method: "POST",
      body: { template_id: null, name: "Regions", description: null, weeks: 4, sessions_per_week: 2, setting: "clinic", start_date: "2026-11-01", steps: [step(extra)] },
    });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    const sessions = (await env.db.query<{ id: string }>(`SELECT id FROM app.planned_session WHERE patient_id = $1 ORDER BY seq`, [patient])).rows.map((r) => r.id);
    const gameStep = (await env.db.query<{ id: string }>(`SELECT s.id FROM app.assignment_step s JOIN app.protocol_assignment a ON a.id = s.assignment_id WHERE a.patient_id = $1`, [patient])).rows[0]!.id;
    return { patient, sessions, gameStep };
  };
  const launch = async (psid: string): Promise<Params> => (await yael.api(`/v1/planned-sessions/${psid}/launch`, { method: "POST", body: {} })).body.launch.steps[0].params;
  const v2 = (p: { patient: string; gameStep: string }, psid: string, params: Params) =>
    env.tickets.signV2({ jti: randomUUID(), psid, asid: p.gameStep, pid: p.patient, gid: "catch-me-if-you-can", sub: yael.userId, dev: device, allowed: allowedParamsFor(params, { min: 1, max: 5 }) }, OFFLINE_TICKET_TTL_S);
  const send = (p: { patient: string; gameStep: string }, psid: string, params: Params) =>
    yael.api("/v1/results", { method: "POST", body: { ticket: v2(p, psid, params), envelope: { ...envelope(params, 0.6), session_id: uuidv7() } } });

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await yael.api("/v1/devices/register", { method: "POST", body: { device_id: device, outbox_public_key: "pk" } });
    await yael.api(`/v1/devices/${device}/spaces`, { method: "POST", body: { clinic_id: ids.clinic } });
    for (const r of (await env.db.query<{ id: string; path: string }>(`SELECT id, path FROM app.brain_region`)).rows) region.set(r.path, r.id);
  });
  afterAll(async () => env?.close());

  it("launch params carry the row for a sub-lobe step", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.temporal.superior_temporal") });
    const params = await launch(p.sessions[0]!);
    expect(params.region).toMatchObject({ path: "right.temporal.superior_temporal", sublobe: "right.temporal.superior_temporal", drawn: false, bg_temperature: "cold", rotation: "cw", target_locations: ["W", "NW", "N"], clinical_status: "draft", revision: 1 });
    expect(params.hemisphere).toBe("right");
  });

  it("left cerebellum runs as the right hemisphere", async () => {
    const p = await patientWith({ hemisphere: "left", region_id: rid("left.subcortical.cerebellum") });
    const params = await launch(p.sessions[0]!);
    expect(params.region!.bg_temperature).toBe("cold");
    expect(params.hemisphere).toBe("right");
    expect(params.timer_position).toBe(timerPositionFor("right", true));
  });

  it("lobe draw sets hemisphere from the drawn row", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.subcortical") });
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const params = await launch(p.sessions[0]!);
      expect(params.region!.drawn).toBe(true);
      expect(params.region!.path).toBe("right.subcortical");
      expect(params.hemisphere).toBe(params.region!.sublobe.endsWith(".cerebellum") ? "left" : "right");
      seen.add(params.region!.sublobe);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("background params follow the row", async () => {
    for (const monochrome of [false, true]) {
      const p = await patientWith({ hemisphere: "right", monochrome, region_id: rid("right.frontal.dlpfc"), game_params: { bg_temperature: "warm", background: "solid" } });
      const params = await launch(p.sessions[0]!);
      expect(params["catch_me_if_you_can.bg_temperature"]).toBe("cold");
      expect(params["catch_me_if_you_can.background"]).toBe("textured");
    }
  });

  it("a step without a region launches exactly as before", async () => {
    const p = await patientWith({ hemisphere: "left", game_params: { bg_temperature: "warm" } });
    const params = await launch(p.sessions[0]!);
    expect("region" in params).toBe(false);
    expect(params.hemisphere).toBe("left");
    expect(params.timer_position).toBe(timerPositionFor("left", true));
    expect(params["catch_me_if_you_can.bg_temperature"]).toBe("warm");
    expect("catch_me_if_you_can.background" in params).toBe(false);
  });

  it("the bundle's package params include region and the ticket signs it", async () => {
    await patientWith({ hemisphere: "right", region_id: rid("right.parietal.superior_parietal") });
    const res = await yael.api(`/v1/offline/bundle?device=${device}&lang=en`);
    expect(res.status).toBe(200);
    const found: Array<{ base_params: Params; allowed: { exact: Params } }> = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        if (o.base_params && o.allowed) found.push(o as never);
        Object.values(o).forEach(walk);
      }
    };
    walk(res.body);
    const pkg = found.find((f) => f.base_params.region?.sublobe === "right.parietal.superior_parietal")!;
    expect(pkg).toBeDefined();
    expect(pkg.allowed.exact.region).toEqual(pkg.base_params.region);
  });

  it("a lobe draw is not a step change", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.frontal") });
    const draws = new Map<string, Params>();
    for (let i = 0; i < 40 && draws.size < 2; i++) {
      const params = await launch(p.sessions[0]!);
      draws.set(params.region!.sublobe, params);
    }
    expect(draws.size).toBe(2);
    const [a, b] = [...draws.values()];
    expect((await send(p, p.sessions[1]!, a!)).body.outcome).toBe("accepted");
    expect((await send(p, p.sessions[2]!, b!)).body.outcome).toBe("accepted");
  });

  it("changing the step's region after issue is a step change", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.temporal.middle_temporal") });
    const params = await launch(p.sessions[0]!);
    await env.db.query(`UPDATE app.assignment_step SET region_id = $2 WHERE id = $1`, [p.gameStep, rid("right.temporal.inferior_temporal")]);
    expect((await send(p, p.sessions[1]!, params)).body).toMatchObject({ outcome: "kept_for_review", review_reason: "step_changed" });
  });

  it("a table correction (revision bump) is not a step change", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.subcortical.pons") });
    const params = await launch(p.sessions[0]!);
    await env.db.query(`UPDATE app.region_setting SET revision = revision + 1, bg_types = ARRAY['solid'], clinical_status = 'approved' WHERE sublobe_id = $1`, [rid("right.subcortical.pons")]);
    try {
      expect((await send(p, p.sessions[1]!, params)).body.outcome).toBe("accepted");
      expect((await launch(p.sessions[2]!)).region).toMatchObject({ revision: 2, bg_types: ["solid"], clinical_status: "approved" });
    } finally {
      await env.db.query(`UPDATE app.region_setting SET revision = 1, bg_types = ARRAY['textured','solid'], clinical_status = 'draft' WHERE sublobe_id = $1`, [rid("right.subcortical.pons")]);
    }
  });

  it("a step whose row was removed launches side only and its results are not flagged", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.temporal.inferior_temporal") });
    const saved = await env.db.query(`SELECT * FROM app.region_setting WHERE sublobe_id = $1`, [rid("right.temporal.inferior_temporal")]);
    await env.db.query(`DELETE FROM app.region_setting WHERE sublobe_id = $1`, [rid("right.temporal.inferior_temporal")]);
    try {
      const params = await launch(p.sessions[0]!);
      expect("region" in params).toBe(false);
      expect((await send(p, p.sessions[1]!, params)).body.outcome).toBe("accepted");
    } finally {
      const r = saved.rows[0];
      await env.db.query(`INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation, clinical_status, revision) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [r.sublobe_id, r.bg_temperature, r.bg_types, JSON.stringify(r.motion), r.target_locations, r.rotation, r.clinical_status, r.revision]);
    }
  });

  it("progress shows the region a session ran with", async () => {
    const p = await patientWith({ hemisphere: "right", region_id: rid("right.temporal.ba21") });
    const params = await launch(p.sessions[0]!);
    expect((await send(p, p.sessions[0]!, params)).body.outcome).toBe("accepted");
    const list = (await yael.api(`/v1/patients/${p.patient}/sessions`)).body.sessions;
    expect(list[0].region).toEqual({ path: "right.temporal.ba21", sublobe: "right.temporal.middle_temporal", drawn: false, revision: 1 });
    expect(list[0].hemisphere).toBe("right");
  });
});
