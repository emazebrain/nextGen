/**
 * Reports dashboard, caseload first (reports dashboard design 2026-11-23):
 * GET /v1/reports/caseload, /v1/reports/adherence and /v1/reports/overview, and who may see what.
 * All patients here are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("reports: caseload, adherence, overview", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string };
  let noam: { api: Api; userId: string };
  let ronit: { api: Api; userId: string };
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const p = { rising: randomUUID(), falling: randomUUID(), quiet: randomUUID(), noams: randomUUID(), elsewhere: randomUUID() };

  const patient = (id: string, given: string, family: string, clinic: string, therapist: string | null) =>
    env.db
      .query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,$3,$4,'2018-03-01','active')`, [id, clinic, given, family])
      .then(() => (therapist ? env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, therapist]) : null));

  /** An active protocol; returns its id and one step. */
  const assign = async (pid: string, clinic: string) => {
    const a = await env.db.query<{ id: string }>(
      `INSERT INTO app.protocol_assignment (patient_id, clinic_id, assigned_by, name, start_date, weeks, sessions_per_week) VALUES ($1,$2,$3,'Attention', CURRENT_DATE - 40, 8, 3) RETURNING id`,
      [pid, clinic, yael.userId],
    );
    const s = await env.db.query<{ id: string }>(
      `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, game_id, session_mode, duration_s, lives, difficulty_start, current_difficulty, hemisphere, timer_position, practice) VALUES ($1,$2,1,'catch-me-if-you-can','timed_lives',300,3,2,2,'left','left','auto') RETURNING id`,
      [a.rows[0]!.id, pid],
    );
    return { assignment: a.rows[0]!.id, step: s.rows[0]!.id };
  };

  let seq = 0;
  const planned = (assignment: string, pid: string, clinic: string, daysAgo: number, location: "clinic" | "home", status: string) =>
    env.db.query(
      `INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date, location, status) VALUES ($1,$2,$3,$4,1, CURRENT_DATE - $5::int, $6, $7)`,
      [assignment, pid, clinic, ++seq, daysAgo, location, status],
    );

  /** A game played `daysAgo` days and one hour ago, so whole-day arithmetic never sits on a boundary. Returns its id. */
  const played = async (pid: string, clinic: string, daysAgo: number, accuracy: number, opts: { location?: "clinic" | "home"; review?: string; minutes?: number; difficulty?: number } = {}) => {
    const { rows } = await env.db.query<{ id: string }>(
      `INSERT INTO app.game_session (id, patient_id, clinic_id, recorded_by, game_id, game_version, location, status, end_reason, session_mode, difficulty, hemisphere, ended_at, active_ms, accuracy, review_reason)
       VALUES (app.uuidv7(), $1, $2, $3, 'catch-me-if-you-can', '1.0.0', $4, 'completed', 'completed', 'timed_lives', $5, 'left', now() - make_interval(days => $6::int) - interval '1 hour', $7, $8, $9)
       RETURNING id`,
      [pid, clinic, yael.userId, opts.location ?? "clinic", opts.difficulty ?? 2, daysAgo, (opts.minutes ?? 10) * 60_000, accuracy, opts.review ?? null],
    );
    return rows[0]!.id;
  };

  const decision = (step: string, pid: string, session: string, daysAgo: number, action: "up" | "down") =>
    env.db.query(
      `INSERT INTO app.progression_decision (assignment_step_id, patient_id, game_session_id, decided_at, action, from_difficulty, to_difficulty, inputs, reason)
       VALUES ($1,$2,$3, now() - make_interval(days => $4::int), $5, 2, $6, '{}', 'rule')`,
      [step, pid, session, daysAgo, action, action === "up" ? 3 : 1],
    );

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    noam = await staffClient(env, "noam@synthetic.test", "Noam Cohen");
    ronit = await staffClient(env, "ronit@synthetic.test", "Ronit Shaham");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, noam.userId, ids.org, ids.clinic, "therapist");
    await addMember(env.db, ronit.userId, ids.org, ids.clinic, "clinic_manager");

    // Rising: steady improvement, plan followed, nothing to flag.
    await patient(p.rising, "Dana", "Katz", ids.clinic, yael.userId);
    const rising = await assign(p.rising, ids.clinic);
    const up: string[] = [];
    for (const [i, acc] of [0.5, 0.5, 0.55, 0.6, 0.65, 0.7].entries()) up.push(await played(p.rising, ids.clinic, 6 - i, acc, { location: i % 2 ? "home" : "clinic" }));
    await decision(rising.step, p.rising, up[4]!, 2, "up");
    await planned(rising.assignment, p.rising, ids.clinic, 1, "clinic", "done");
    await planned(rising.assignment, p.rising, ids.clinic, 3, "home", "done");
    await planned(rising.assignment, p.rising, ids.clinic, 0, "clinic", "planned");

    // Falling: below their own earlier sessions, stepped down twice, missed sessions, one result waiting for review.
    await patient(p.falling, "Amit", "Lavi", ids.clinic, yael.userId);
    const falling = await assign(p.falling, ids.clinic);
    const down: string[] = [];
    for (const [i, acc] of [0.8, 0.8, 0.6, 0.55, 0.5].entries()) down.push(await played(p.falling, ids.clinic, 5 - i, acc));
    await decision(falling.step, p.falling, down[2]!, 3, "down");
    await decision(falling.step, p.falling, down[3]!, 2, "down");
    await played(p.falling, ids.clinic, 1, 0.1, { review: "consent_withdrawn" }); // not counted until someone decides
    await planned(falling.assignment, p.falling, ids.clinic, 2, "home", "missed");
    await planned(falling.assignment, p.falling, ids.clinic, 3, "home", "planned"); // its day passed
    await planned(falling.assignment, p.falling, ids.clinic, 4, "clinic", "missed");
    await planned(falling.assignment, p.falling, ids.clinic, 1, "clinic", "done");

    // Quiet: an active protocol and nothing played for 20 days.
    await patient(p.quiet, "Eli", "Baron", ids.clinic, yael.userId);
    await assign(p.quiet, ids.clinic);
    await played(p.quiet, ids.clinic, 20, 0.7);

    // Not Yael's: a colleague's patient in the same clinic, and one in another clinic.
    await patient(p.noams, "Tal", "Regev", ids.clinic, noam.userId);
    await played(p.noams, ids.clinic, 1, 0.9);
    await patient(p.elsewhere, "Omer", "Mizrahi", ids.other, null);
    await played(p.elsewhere, ids.other, 1, 0.9);
  });
  afterAll(async () => env?.close());

  const byId = (rows: Array<{ patient_id: string }>, id: string) => rows.find((r) => r.patient_id === id) as any;

  it("a therapist gets one row per patient on their care team, those worth a look first", async () => {
    const res = await yael.api("/v1/reports/caseload");
    expect(res.status).toBe(200);
    const rows = res.body.patients;
    expect(rows.map((r: any) => r.patient_id)).toEqual([p.falling, p.quiet, p.rising]);

    expect(byId(rows, p.rising)).toMatchObject({
      given_name: "Dana",
      family_name: "Katz",
      summary: "improving",
      week: { done: 2, planned: 3 },
      difficulty: 2,
      last_change: "up",
      reasons: [],
    });
    expect(byId(rows, p.rising).scores).toEqual([100, 100, 110, 120, 130, 140]);
    expect(typeof byId(rows, p.rising).last_session_at).toBe("string");
  });

  it("names every reason a patient is worth a look, and leaves uncounted results out of the trend", async () => {
    const rows = (await yael.api("/v1/reports/caseload")).body.patients;
    expect(byId(rows, p.falling)).toMatchObject({
      summary: "declining",
      last_change: "down",
      reasons: [{ kind: "review", count: 1 }, { kind: "missed_home", count: 2 }, { kind: "missed_clinic", count: 1 }, { kind: "declining" }, { kind: "stepped_down" }],
    });
    // Five counted sessions; the flagged one is not a sixth point.
    expect(byId(rows, p.falling).scores).toHaveLength(5);
    expect(byId(rows, p.quiet).reasons).toEqual([{ kind: "inactive", days: 20 }]);
    expect(byId(rows, p.quiet).summary).toBe("not_enough");
  });

  it("keeps colleagues' and other clinics' patients out; a manager sees the whole clinic and no further", async () => {
    const noams = (await noam.api("/v1/reports/caseload")).body.patients.map((r: any) => r.patient_id);
    expect(noams).toEqual([p.noams]);
    const clinic = (await ronit.api("/v1/reports/caseload")).body.patients.map((r: any) => r.patient_id).sort();
    expect(clinic).toEqual([p.rising, p.falling, p.quiet, p.noams].sort());
    expect(clinic).not.toContain(p.elsewhere);
  });

  it("adherence: planned against done per rolling week, clinic and home apart", async () => {
    const res = await yael.api("/v1/reports/adherence?weeks=2");
    expect(res.status).toBe(200);
    expect(res.body.weeks).toHaveLength(2);
    const [earlier, latest] = res.body.weeks;
    // Last seven days, today included: 7 planned across Yael's patients; 2 done in clinic, 1 at home.
    expect(latest).toMatchObject({ planned: 7, done_clinic: 2, done_home: 1 });
    expect(earlier).toMatchObject({ planned: 0, done_clinic: 0, done_home: 0 });
    expect(latest.week_start > earlier.week_start).toBe(true);
    // A colleague's view holds none of them.
    expect((await noam.api("/v1/reports/adherence?weeks=2")).body.weeks[1]).toMatchObject({ planned: 0 });
  });

  it("overview: totals for the range, the share of the plan followed, and six weeks of history", async () => {
    const res = await yael.api("/v1/reports/overview?days=30");
    expect(res.status).toBe(200);
    // Counted sessions in 30 days: 6 (rising) + 5 (falling) + 1 (quiet, 20 days ago); the flagged one is out.
    expect(res.body).toMatchObject({ sessions: 12, sessions_this_week: 11, active_patients: 3, in_care: 3, avg_duration_ms: 600_000 });
    // Done 3 of (3 done + 3 missed or overdue).
    expect(res.body.plan_followed).toBeCloseTo(0.5);
    expect(res.body.weekly).toHaveLength(6);
    expect(res.body.weekly.at(-1)).toMatchObject({ sessions: 11, avg_duration_ms: 600_000 });
    expect(res.body.weekly[3]).toMatchObject({ sessions: 1 }); // the session 20 days ago
    expect((await yael.api("/v1/reports/overview?days=7")).body).toMatchObject({ sessions: 11, active_patients: 2, in_care: 3 });
    expect((await noam.api("/v1/reports/overview")).body).toMatchObject({ sessions: 1, in_care: 1, plan_followed: null });
  });

  it("refuses parameters it doesn't understand", async () => {
    expect((await yael.api("/v1/reports/caseload?clinic=nope")).status).toBe(400);
    expect((await yael.api("/v1/reports/adherence?weeks=0")).status).toBe(400);
    expect((await yael.api("/v1/reports/adherence?weeks=99")).status).toBe(400);
    expect((await yael.api("/v1/reports/overview?days=abc")).status).toBe(400);
  });

  it("narrows to one clinic when asked", async () => {
    expect((await ronit.api(`/v1/reports/caseload?clinic=${ids.other}`)).body.patients).toEqual([]);
    expect((await ronit.api(`/v1/reports/caseload?clinic=${ids.clinic}`)).body.patients).toHaveLength(4);
  });
});
