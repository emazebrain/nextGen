/**
 * Appointments on the parent calendar: a guardian sees the appointments a therapist or clinic set for their own
 * child, read-only. They never see another child's, the staff's notes, or cancelled ones, and cannot create,
 * change or cancel anything. All people here are synthetic.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { ADMIN_URL, addMember, seedClinics, setupApi, staffClient, type Api, type TestEnv } from "./support.ts";

describe.skipIf(!ADMIN_URL)("parent calendar: appointments", () => {
  let env: TestEnv;
  let yael: { api: Api; userId: string }; // therapist
  let miri: { api: Api; userId: string }; // Dana's guardian
  let other: { api: Api; userId: string }; // another child's guardian
  let ids: Awaited<ReturnType<typeof seedClinics>>;
  const dana = randomUUID();
  const eli = randomUUID();
  const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
  const book = (patient_id: string, date: string, start_time: string, end_time: string, title: string, notes = "") =>
    yael.api("/v1/calendar/appointments", { method: "POST", body: { patient_id, title, notes, date, start_time, end_time } });

  beforeAll(async () => {
    env = await setupApi();
    ids = await seedClinics(env.db);
    yael = await staffClient(env, "yael@synthetic.test", "Yael Bar");
    miri = await staffClient(env, "miri@synthetic.test", "Miri Katz");
    other = await staffClient(env, "other@synthetic.test", "Other Parent");
    await addMember(env.db, yael.userId, ids.org, ids.clinic, "therapist");
    for (const [id, given] of [[dana, "Dana"], [eli, "Eli"]] as const) {
      await env.db.query(`INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, status) VALUES ($1,$2,$3,'Katz','2018-03-01','active')`, [id, ids.clinic, given]);
      await env.db.query(`INSERT INTO app.patient_care_team (patient_id, user_id) VALUES ($1,$2)`, [id, yael.userId]);
    }
    for (const [user, name, child] of [[miri.userId, "Miri Katz", dana], [other.userId, "Other Parent", eli]] as const) {
      const g = await env.db.query<{ id: string }>(`INSERT INTO app.guardian (clinic_id, full_name, phone, created_by, user_id) VALUES ($1,$2,'+972 50 000 0000',$3,$4) RETURNING id`, [ids.clinic, name, yael.userId, user]);
      await env.db.query(`INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) VALUES ($1,$2,'parent',true)`, [g.rows[0]!.id, child]);
    }
  });
  afterAll(async () => env?.close());

  let cancelledId = "";

  it("a guardian sees their child's coming appointments, in order, without the staff's notes", async () => {
    expect((await book(dana, day(3), "10:00", "10:45", "Follow-up", "internal: discuss attention span")).status).toBe(201);
    expect((await book(dana, day(1), "09:00", "09:30", "First visit")).status).toBe(201);
    expect((await book(eli, day(2), "11:00", "11:30", "Eli's visit")).status).toBe(201);
    const cancelled = await book(dana, day(5), "12:00", "12:30", "Cancelled one");
    cancelledId = cancelled.body.id ?? cancelled.body.appointment?.id;
    await env.db.query(`UPDATE app.appointment SET status = 'cancelled' WHERE title = 'Cancelled one'`);
    await env.db.query(`INSERT INTO app.appointment (clinic_id, patient_id, created_by, title, date, start_time, end_time) VALUES ($1,$2,$3,'Last month', CURRENT_DATE - 30, '09:00', '09:30')`, [ids.clinic, dana, yael.userId]);

    const res = await miri.api(`/v1/parent/children/${dana}/appointments`);
    expect(res.status).toBe(200);
    expect(res.body.appointments).toEqual([
      { id: expect.any(String), date: day(1), start_time: "09:00", end_time: "09:30", title: "First visit", clinic_name: expect.any(String) },
      { id: expect.any(String), date: day(3), start_time: "10:00", end_time: "10:45", title: "Follow-up", clinic_name: expect.any(String) },
    ]);
    expect(JSON.stringify(res.body)).not.toContain("internal");
  });

  it("a guardian cannot see another child's appointments", async () => {
    expect((await miri.api(`/v1/parent/children/${eli}/appointments`)).status).toBe(404);
    expect((await other.api(`/v1/parent/children/${dana}/appointments`)).status).toBe(404);
    const own = await other.api(`/v1/parent/children/${eli}/appointments`);
    expect(own.body.appointments.map((a: { title: string }) => a.title)).toEqual(["Eli's visit"]);
  });

  it("a guardian cannot set, change or cancel an appointment, or read the clinic's calendar", async () => {
    const before = (await env.db.query<{ n: number }>(`SELECT count(*)::int AS n FROM app.appointment`)).rows[0]!.n;
    const created = await miri.api("/v1/calendar/appointments", { method: "POST", body: { patient_id: dana, title: "Mine", notes: "", date: day(2), start_time: "08:00", end_time: "08:30" } });
    expect(created.status).toBeGreaterThanOrEqual(400);
    const mine = (await miri.api(`/v1/parent/children/${dana}/appointments`)).body.appointments as Array<{ id: string }>;
    const changed = await miri.api(`/v1/calendar/appointments/${mine[0]!.id}`, { method: "PATCH", body: { status: "cancelled", title: "Changed" } });
    expect(changed.status).toBeGreaterThanOrEqual(400);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect((await miri.api(`/v1/parent/children/${dana}/appointments`, { method, body: {} })).status).toBeGreaterThanOrEqual(400);
    }
    const after = await env.db.query<{ n: number; first: string }>(`SELECT count(*)::int AS n, min(title) FILTER (WHERE title IN ('Changed','Mine')) AS first FROM app.appointment`);
    expect(after.rows[0]!.n).toBe(before);
    expect(after.rows[0]!.first).toBeNull();
    const events = await miri.api(`/v1/calendar/events?clinic=${ids.clinic}&from=${day(0)}&to=${day(10)}`);
    expect(events.status >= 400 || (events.body.events ?? []).length === 0).toBe(true);
    expect(cancelledId).toBeTruthy();
  });
});
