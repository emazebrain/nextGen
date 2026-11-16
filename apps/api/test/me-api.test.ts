/**
 * Tests for GET /v1/me (user_status) and PATCH /v1/me/status (self-activate).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setupApi,
  staffClient,
  seedClinics,
  addMember,
  type TestEnv,
  type Api,
} from "./support.ts";

let env: TestEnv;
let therapist: Api;
let therapistId: string;
let org: string;
let clinic: string;

beforeAll(async () => {
  env = await setupApi();
  const clinics = await seedClinics(env.db);
  org = clinics.org;
  clinic = clinics.clinic;
  const t = await staffClient(env, "therapist@synthetic.test", "Tali Therapist");
  therapist = t.api;
  therapistId = t.userId;
  await addMember(env.db, therapistId, org, clinic, "therapist");
}, 30_000);

afterAll(async () => {
  await env?.close();
}, 10_000);

describe("/v1/me", () => {
  it("GET /v1/me includes user_status", async () => {
    const res = await therapist("/v1/me");
    expect(res.status).toBe(200);
    expect(res.body.user_status).toBe("active");
  });

  it("PATCH /v1/me/status transitions invited → active", async () => {
    // Create a second user who is invited
    const invited = await staffClient(env, "invited@synthetic.test", "Ilan Invited");
    await addMember(env.db, invited.userId, org, clinic, "therapist");
    // Set their app_user.status to 'invited' via superuser
    await env.db.query(
      `UPDATE app.app_user SET status = 'invited' WHERE id = $1`,
      [invited.userId],
    );

    // PATCH to activate
    const res = await invited.api("/v1/me/status", {
      method: "PATCH",
      body: { status: "active" },
    });
    expect(res.status).toBe(200);

    // Verify subsequent GET shows active
    const me = await invited.api("/v1/me");
    expect(me.body.user_status).toBe("active");
  });

  it("PATCH /v1/me/status rejects active → disabled (400)", async () => {
    const res = await therapist("/v1/me/status", {
      method: "PATCH",
      body: { status: "disabled" },
    });
    expect(res.status).toBe(400);
  });

  it("PATCH /v1/me/status rejects active → active (409)", async () => {
    const res = await therapist("/v1/me/status", {
      method: "PATCH",
      body: { status: "active" },
    });
    expect(res.status).toBe(409);
  });
});
