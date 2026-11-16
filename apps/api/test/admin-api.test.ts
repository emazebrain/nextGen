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

  it("non-admin gets 403 on PATCH and resend-invite (I9)", async () => {
    // Use a fake UUID — the 403 fires before it matters that the id doesn't exist
    const fakeId = "00000000-0000-0000-0000-000000000000";
    expect((await therapist(`/v1/admin/organizations/${fakeId}`, { method: "PATCH", body: { status: "active" } })).status).toBe(403);
    expect((await therapist(`/v1/admin/clinics/${fakeId}`, { method: "PATCH", body: { name: "X" } })).status).toBe(403);
    expect((await therapist(`/v1/admin/users/${fakeId}`, { method: "PATCH", body: { status: "active" } })).status).toBe(403);
    expect((await therapist(`/v1/admin/users/${fakeId}/resend-invite`, { method: "POST" })).status).toBe(403);
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

describe("admin API: reading and editing", () => {
  let org2: string;
  let clinic2: string;
  let user2: string;

  it("sets up a second organization with a clinic and two users", async () => {
    org2 = (await admin("/v1/admin/organizations", { method: "POST", body: { name: "Carmel Group", region: "il", default_locale: "en" } })).body.organization.id;
    clinic2 = (await admin(`/v1/admin/organizations/${org2}/clinics`, { method: "POST", body: { name: "Haifa Clinic", country_code: "IL", timezone: "Asia/Jerusalem" } })).body.clinic.id;
    const therapistRes = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "haifa.therapist@synthetic.test", full_name: "Haifa Therapist", role: "therapist", organization_id: org2, clinic_id: clinic2 },
    });
    expect(therapistRes.status).toBe(201);
    user2 = therapistRes.body.user.id;
    const orgAdmin = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "carmel.admin@synthetic.test", full_name: "Carmel Admin", role: "org_admin", organization_id: org2 },
    });
    expect(orgAdmin.status).toBe(201);
  });

  it("filters the organization list by status", async () => {
    const suspended = await admin("/v1/admin/organizations?status=suspended");
    expect(suspended.status).toBe(200);
    expect(suspended.body.organizations.map((o: { id: string }) => o.id)).toContain(orgId);
    expect(suspended.body.organizations.map((o: { id: string }) => o.id)).not.toContain(org2);
    expect((await admin("/v1/admin/organizations?status=nonsense")).status).toBe(400);
  });

  it("returns one organization with its clinics and its organization admins", async () => {
    const res = await admin(`/v1/admin/organizations/${org2}`);
    expect(res.status).toBe(200);
    expect(res.body.organization).toMatchObject({ id: org2, name: "Carmel Group", default_locale: "en" });
    expect(res.body.clinics).toHaveLength(1);
    expect(res.body.clinics[0]).toMatchObject({ id: clinic2, name: "Haifa Clinic", status: "active" });
    expect(res.body.admins).toHaveLength(1);
    expect(res.body.admins[0]).toMatchObject({ email: "carmel.admin@synthetic.test", full_name: "Carmel Admin", status: "invited" });
  });

  it("answers 404 for an organization that doesn't exist or a malformed id", async () => {
    expect((await admin("/v1/admin/organizations/00000000-0000-7000-8000-000000000000")).status).toBe(404);
    expect((await admin("/v1/admin/organizations/not-an-id")).status).toBe(404);
    expect((await admin("/v1/admin/organizations/not-an-id", { method: "PATCH", body: { name: "X" } })).status).toBe(404);
    expect((await admin("/v1/admin/clinics/not-an-id", { method: "PATCH", body: { name: "X" } })).status).toBe(404);
    expect((await admin("/v1/admin/users/not-an-id", { method: "PATCH", body: { full_name: "X" } })).status).toBe(404);
    expect((await admin("/v1/admin/users/not-an-id/resend-invite", { method: "POST" })).status).toBe(404);
  });

  it("lists an organization's clinics", async () => {
    const res = await admin(`/v1/admin/organizations/${org2}/clinics`);
    expect(res.status).toBe(200);
    expect(res.body.clinics.map((c: { id: string }) => c.id)).toEqual([clinic2]);
  });

  it("returns one clinic with its organization's name", async () => {
    const res = await admin(`/v1/admin/clinics/${clinic2}`);
    expect(res.status).toBe(200);
    expect(res.body.clinic).toMatchObject({ id: clinic2, organization_id: org2, organization_name: "Carmel Group", country_code: "IL", timezone: "Asia/Jerusalem" });
    expect((await admin("/v1/admin/clinics/00000000-0000-7000-8000-000000000000")).status).toBe(404);
  });

  it("edits a clinic's name, time zone and status", async () => {
    const res = await admin(`/v1/admin/clinics/${clinic2}`, { method: "PATCH", body: { name: "Haifa Bay Clinic", timezone: "Europe/London", status: "inactive" } });
    expect(res.status).toBe(200);
    expect(res.body.clinic).toMatchObject({ id: clinic2, name: "Haifa Bay Clinic", timezone: "Europe/London", status: "inactive" });
    expect((await admin(`/v1/admin/clinics/${clinic2}`, { method: "PATCH", body: {} })).status).toBe(400);
    expect((await admin(`/v1/admin/clinics/${clinic2}`, { method: "PATCH", body: { timezone: "Mars/Olympus" } })).status).toBe(400);
  });

  it("lists users by organization, clinic and status, with their memberships", async () => {
    const byOrg = await admin(`/v1/admin/users?org_id=${org2}`);
    expect(byOrg.status).toBe(200);
    expect(byOrg.body.users.map((u: { email: string }) => u.email).sort()).toEqual(["carmel.admin@synthetic.test", "haifa.therapist@synthetic.test"]);
    const byClinic = await admin(`/v1/admin/users?clinic_id=${clinic2}`);
    expect(byClinic.body.users).toHaveLength(1);
    expect(byClinic.body.users[0]).toMatchObject({ id: user2, email: "haifa.therapist@synthetic.test", full_name: "Haifa Therapist", status: "invited" });
    expect(byClinic.body.users[0].memberships).toEqual([{ organization_id: org2, clinic_id: clinic2, role: "therapist" }]);
    const active = await admin(`/v1/admin/users?org_id=${org2}&status=active`);
    expect(active.body.users).toEqual([]);
    expect((await admin("/v1/admin/users?org_id=nope")).status).toBe(400);
    expect((await therapist("/v1/admin/users")).status).toBe(403);
  });

  it("edits a user's name and disables them", async () => {
    const res = await admin(`/v1/admin/users/${user2}`, { method: "PATCH", body: { full_name: "Haifa T. Renamed", status: "disabled" } });
    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ id: user2, full_name: "Haifa T. Renamed", status: "disabled" });
    expect((await admin(`/v1/admin/users/${user2}`, { method: "PATCH", body: {} })).status).toBe(400);
    expect((await admin("/v1/admin/users/00000000-0000-7000-8000-000000000000", { method: "PATCH", body: { full_name: "X" } })).status).toBe(404);
  });

  it("does not let an admin disable their own account", async () => {
    const res = await admin(`/v1/admin/users/${adminId}`, { method: "PATCH", body: { status: "disabled" } });
    expect(res.status).toBe(409);
  });

  it("answers 400, not a crash, for a body that fails validation", async () => {
    expect((await admin("/v1/admin/organizations", { method: "POST", body: { name: "", region: "mars" } })).status).toBe(400);
    expect((await admin(`/v1/admin/organizations/${org2}/clinics`, { method: "POST", body: { name: "X" } })).status).toBe(400);
    expect((await admin(`/v1/admin/organizations/${org2}/clinics`, { method: "POST", body: { name: "X", country_code: "IL", timezone: "Mars/Olympus" } })).status).toBe(400);
    expect((await admin("/v1/admin/users", { method: "POST", body: { email: "not-an-email" } })).status).toBe(400);
  });

  it("answers 409 for an email that already has an account, and creates nothing", async () => {
    const res = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "Haifa.Therapist@synthetic.test", full_name: "Duplicate", role: "therapist", organization_id: org2, clinic_id: clinic2 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("email_taken");
    const users = await admin(`/v1/admin/users?org_id=${org2}`);
    expect(users.body.users).toHaveLength(2);
  });

  it("refuses a user whose clinic belongs to another organization, and creates nothing", async () => {
    const res = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "wrong.clinic@synthetic.test", full_name: "Wrong Clinic", role: "therapist", organization_id: org2, clinic_id: clinicId },
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("clinic_not_in_organization");
    const again = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "wrong.clinic@synthetic.test", full_name: "Right Clinic", role: "therapist", organization_id: org2, clinic_id: clinic2 },
    });
    expect(again.status).toBe(201);
  });

  it("answers 409 for a second clinic with the same name in one organization", async () => {
    const res = await admin(`/v1/admin/organizations/${org2}/clinics`, { method: "POST", body: { name: "Haifa Bay Clinic", country_code: "IL", timezone: "Asia/Jerusalem" } });
    expect(res.status).toBe(409);
    expect((await admin("/v1/admin/organizations/00000000-0000-7000-8000-000000000000/clinics", { method: "POST", body: { name: "Orphan", country_code: "IL", timezone: "Asia/Jerusalem" } })).status).toBe(404);
  });

  it("requires clinic_id for clinic-scoped roles and forbids it for org-wide roles", async () => {
    // therapist without clinic_id → 400
    const noClinic = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "no.clinic@synthetic.test", full_name: "No Clinic", role: "therapist", organization_id: org2 },
    });
    expect(noClinic.status).toBe(400);
    expect(noClinic.body.error).toBe("clinic_required");

    // clinic_manager without clinic_id → 400
    const noClinic2 = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "no.clinic2@synthetic.test", full_name: "No Clinic 2", role: "clinic_manager", organization_id: org2 },
    });
    expect(noClinic2.status).toBe(400);
    expect(noClinic2.body.error).toBe("clinic_required");

    // org_admin with clinic_id → 400
    const withClinic = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "with.clinic@synthetic.test", full_name: "With Clinic", role: "org_admin", organization_id: org2, clinic_id: clinic2 },
    });
    expect(withClinic.status).toBe(400);
    expect(withClinic.body.error).toBe("clinic_forbidden");

    // platform_admin with clinic_id → 400
    const withClinic2 = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "with.clinic2@synthetic.test", full_name: "With Clinic 2", role: "platform_admin", organization_id: org2, clinic_id: clinic2 },
    });
    expect(withClinic2.status).toBe(400);
    expect(withClinic2.body.error).toBe("clinic_forbidden");
  });

  it("never returns the temporary password", async () => {
    const res = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "quiet@synthetic.test", full_name: "Quiet Person", role: "assistant", organization_id: org2, clinic_id: clinic2 },
    });
    expect(res.status).toBe(201);
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });
});

describe("account status gate", () => {
  let staff: Api;
  let staffId: string;

  beforeAll(async () => {
    const clinics = await seedGateClinic();
    const s = await staffClient(env, "gate.therapist@synthetic.test", "Gate Therapist");
    staff = s.api;
    staffId = s.userId;
    await addMember(env.db, staffId, clinics.org, clinics.clinic, "therapist");
  }, 30_000);

  async function seedGateClinic() {
    const org = (await admin("/v1/admin/organizations", { method: "POST", body: { name: "Gate Org", region: "il" } })).body.organization.id as string;
    const clinic = (await admin(`/v1/admin/organizations/${org}/clinics`, { method: "POST", body: { name: "Gate Clinic", country_code: "il", timezone: "Asia/Jerusalem" } })).body.clinic.id as string;
    return { org, clinic };
  }

  it("lets an invited user reach only their own account until the password is replaced", async () => {
    await env.db.query(`UPDATE app.app_user SET status = 'invited' WHERE id = $1`, [staffId]);
    const blocked = await staff("/v1/patients");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");
    const me = await staff("/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.user_status).toBe("invited");
    expect((await staff("/v1/me/status", { method: "PATCH", body: { status: "active" } })).status).toBe(200);
    expect((await staff("/v1/patients")).status).toBe(200);
  });

  it("ends a disabled user's sessions and refuses them everywhere", async () => {
    expect((await admin(`/v1/admin/users/${staffId}`, { method: "PATCH", body: { status: "disabled" } })).status).toBe(200);
    expect((await staff("/v1/me")).status).toBe(401);
  });

  it("refuses a disabled user even with a live session", async () => {
    const other = await staffClient(env, "gate.other@synthetic.test", "Gate Other");
    await env.db.query(`UPDATE app.app_user SET status = 'disabled' WHERE id = $1`, [other.userId]);
    for (const path of ["/v1/me", "/v1/patients"]) {
      const res = await other.api(path);
      expect(res.status).toBe(403);
      expect(res.body.error).toBe("account_disabled");
    }
    expect((await other.api("/v1/me/status", { method: "PATCH", body: { status: "active" } })).status).toBe(403);
  });

  it("re-enables a disabled user, but never activates an invited one", async () => {
    const back = await admin(`/v1/admin/users/${staffId}`, { method: "PATCH", body: { status: "active" } });
    expect(back.status).toBe(200);
    expect(back.body.user.status).toBe("active");
    const invited = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "gate.invited@synthetic.test", full_name: "Gate Invited", role: "assistant", organization_id: orgId, clinic_id: clinicId },
    });
    const res = await admin(`/v1/admin/users/${invited.body.user.id}`, { method: "PATCH", body: { status: "active" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("user_invited");
  });
});
