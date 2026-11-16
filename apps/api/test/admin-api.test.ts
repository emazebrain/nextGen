/**
 * Tests for /v1/admin — platform-admin CRUD for organizations, clinics, users.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  setupApi,
  staffClient,
  platformAdmin,
  seedClinics,
  addMember,
  type TestEnv,
  type Api,
} from "./support.ts";

let env: TestEnv;
let admin: Api;
let adminId: string;
let therapist: Api;
let therapistId: string;

// Ids populated during tests
let orgId: string;
let clinicId: string;
let createdUserId: string;

beforeAll(async () => {
  env = await setupApi();
  const a = await platformAdmin(env);
  admin = a.api;
  adminId = a.userId;

  // A non-admin therapist to verify 403s
  const clinics = await seedClinics(env.db);
  const t = await staffClient(env, "therapist@synthetic.test", "Tali Therapist");
  therapist = t.api;
  therapistId = t.userId;
  await addMember(env.db, therapistId, clinics.org, clinics.clinic, "therapist");
}, 30_000);

afterAll(async () => {
  await env?.close();
}, 10_000);

describe("admin API", () => {
  it("non-admin gets 403 on all admin endpoints", async () => {
    expect((await therapist("/v1/admin/organizations")).status).toBe(403);
    expect(
      (
        await therapist("/v1/admin/organizations", {
          method: "POST",
          body: { name: "X", region: "il", default_locale: "he" },
        })
      ).status,
    ).toBe(403);
    expect(
      (await therapist("/v1/admin/users", { method: "POST", body: {} })).status,
    ).toBe(403);
  });

  it("admin creates an organization", async () => {
    const res = await admin("/v1/admin/organizations", {
      method: "POST",
      body: { name: "Rambam Health", region: "il", default_locale: "he" },
    });
    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({
      name: "Rambam Health",
      region: "il",
      status: "active",
    });
    orgId = res.body.organization.id;
  });

  it("admin lists organizations", async () => {
    const res = await admin("/v1/admin/organizations");
    expect(res.status).toBe(200);
    expect(res.body.organizations.length).toBeGreaterThan(0);
  });

  it("admin creates a clinic under an organization", async () => {
    const res = await admin(`/v1/admin/organizations/${orgId}/clinics`, {
      method: "POST",
      body: {
        name: "Tel Aviv Clinic",
        country_code: "IL",
        timezone: "Asia/Jerusalem",
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.clinic).toMatchObject({ name: "Tel Aviv Clinic" });
    clinicId = res.body.clinic.id;
  });

  it("admin creates a user with invitation", async () => {
    const res = await admin("/v1/admin/users", {
      method: "POST",
      body: {
        email: "new.therapist@synthetic.test",
        full_name: "New Therapist",
        role: "therapist",
        organization_id: orgId,
        clinic_id: clinicId,
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({
      email: "new.therapist@synthetic.test",
      status: "invited",
    });
    expect(res.body.membership).toBeDefined();
    expect(res.body).toHaveProperty("email_sent");
    createdUserId = res.body.user.id;
  });

  it("admin can resend invite for an invited user", async () => {
    const res = await admin(`/v1/admin/users/${createdUserId}/resend-invite`, {
      method: "POST",
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("sent");
  });

  it("resend-invite rejects for an active user", async () => {
    // The admin user is already active
    const res = await admin(`/v1/admin/users/${adminId}/resend-invite`, {
      method: "POST",
    });
    expect([400, 409]).toContain(res.status);
  });

  it("admin patches organization status", async () => {
    const res = await admin(`/v1/admin/organizations/${orgId}`, {
      method: "PATCH",
      body: { status: "suspended" },
    });
    expect(res.status).toBe(200);
    expect(res.body.organization.status).toBe("suspended");
  });
});
