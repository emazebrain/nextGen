/** Brain-region filters through the API (spec 2026-11-09): the region list, and one filter per game step. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

const step = (extra: Record<string, unknown> = {}) => ({
  game_id: "catch-me-if-you-can",
  session_mode: "timed",
  duration_s: 300,
  lives: null,
  difficulty_start: 2,
  hemisphere: "right",
  timer_position: "left",
  practice: "auto",
  trial_window_ms: null,
  game_params: {},
  progression: null,
  ...extra,
});

describe.skipIf(!ADMIN_URL)("brain-region filters API", () => {
  let env: TestEnv;
  let yael: Api;
  let ids: Awaited<ReturnType<typeof seedClinics>> & { patient: string };
  const region = new Map<string, string>();
  const rid = (path: string) => region.get(path)!;
  const template = (steps: unknown[]) => ({ clinic_id: ids.clinic, name: "Regions", description: null, weeks: 2, sessions_per_week: 1, setting: "clinic", visibility: "private", steps });

  beforeAll(async () => {
    env = await setupApi();
    const clinics = await seedClinics(env.db);
    const y = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    yael = y.api;
    ids = { ...clinics, patient: randomUUID() };
    await addMember(env.db, y.userId, ids.org, ids.clinic, "therapist");
    await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,'Noa','Levi','2018-03-01','active')`, [ids.patient, ids.clinic]);
    await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [ids.patient, y.userId]);
    const { rows } = await env.db.query<{ id: string; path: string }>(`SELECT id, path FROM app.brain_region`);
    for (const r of rows) region.set(r.path, r.id);
  });
  afterAll(async () => env?.close());

  it("brain-regions lists sub-lobes with settings and hides retired nodes", async () => {
    const res = await yael("/v1/brain-regions?lang=he");
    expect(res.status).toBe(200);
    const list = res.body.regions as Array<{ path: string; kind: string; label: string; sublobe_id: string | null; setting: { bg_temperature: string; clinical_status: string } | null }>;
    expect(list.some((r) => r.path === "left.cerebellum" || r.path === "left.cerebellum.cerebellum")).toBe(false);
    const st = list.find((r) => r.path === "right.temporal.superior_temporal")!;
    expect(st).toMatchObject({ kind: "sublobe", label: "רקתי עליון", setting: { bg_temperature: "cold", clinical_status: "draft" } });
    expect(list.find((r) => r.path === "right.temporal.ba22")!.sublobe_id).toBe(rid("right.temporal.superior_temporal"));
    expect(list.find((r) => r.path === "right.temporal.ba22")!.setting).toBeNull();
  });

  let templateId = "";
  it("a template step saves and returns its region", async () => {
    const res = await yael("/v1/templates", {
      method: "POST",
      body: template([
        step({ region_id: rid("right.temporal.superior_temporal") }),
        step({ region_id: rid("right.temporal.ba22") }),
        step({ region_id: rid("left.frontal"), hemisphere: "left" }),
        step(),
      ]),
    });
    expect(res.status).toBe(201);
    templateId = res.body.template.id;
    expect(res.body.template.steps.map((s: { region_id: string | null }) => s.region_id)).toEqual([rid("right.temporal.superior_temporal"), rid("right.temporal.ba22"), rid("left.frontal"), null]);
  });

  it("rejects regions a game can't use", async () => {
    const bad = await yael("/v1/templates", {
      method: "POST",
      body: template([
        step({ region_id: rid("right.frontal.ba44") }),
        step({ region_id: rid("right.occipital") }),
        step({ region_id: rid("right.cerebellum.cerebellum") }),
        step({ region_id: rid("right.temporal.superior_temporal"), hemisphere: "left" }),
        step({ region_id: randomUUID() }),
      ]),
    });
    expect(bad.status).toBe(400);
    expect(bad.body.issues).toEqual([
      { path: "steps.0.region_id", code: "region_not_for_games" },
      { path: "steps.1.region_id", code: "region_not_for_games" },
      { path: "steps.2.region_id", code: "region_not_for_games" },
      { path: "steps.3.region_id", code: "region_side" },
      { path: "steps.4.region_id", code: "region_not_for_games" },
    ]);
    const n = await env.db.query(`SELECT 1 FROM app.protocol_template WHERE name = 'Regions'`);
    expect(n.rowCount).toBe(1);
  });

  it("keeps a step's region when an older app omits region_id", async () => {
    const t = (await yael(`/v1/templates/${templateId}`)).body.template;
    const old = t.steps.map(({ id: _i, ordinal: _o, region_id: _r, ...s }: Record<string, unknown>) => s);
    const kept = await yael(`/v1/templates/${templateId}`, { method: "PUT", body: template(old) });
    expect(kept.status).toBe(200);
    expect(kept.body.template.steps.map((s: { region_id: string | null }) => s.region_id)).toEqual([rid("right.temporal.superior_temporal"), rid("right.temporal.ba22"), rid("left.frontal"), null]);
    const cleared = await yael(`/v1/templates/${templateId}`, { method: "PUT", body: template([{ ...old[0], region_id: null }, ...old.slice(1)]) });
    expect(cleared.body.template.steps[0].region_id).toBeNull();
    expect(cleared.body.template.steps[1].region_id).toBe(rid("right.temporal.ba22"));
  });

  it("assigning a template copies region_id to assignment steps", async () => {
    const t = (await yael(`/v1/templates/${templateId}`)).body.template;
    const res = await yael(`/v1/patients/${ids.patient}/assignment`, {
      method: "POST",
      body: { template_id: templateId, name: t.name, weeks: t.weeks, sessions_per_week: t.sessions_per_week, setting: t.setting, description: null, start_date: new Date().toISOString().slice(0, 10), steps: t.steps.map(({ id: _i, ordinal: _o, ...s }: Record<string, unknown>) => s) },
    });
    expect(res.status).toBe(201);
    expect(res.body.assignment.steps.map((s: { region_id: string | null }) => s.region_id)).toEqual([null, rid("right.temporal.ba22"), rid("left.frontal"), null]);
  });
});
