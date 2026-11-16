/**
 * End to end (system admin spec): an admin sets up an organization and invites someone; that person signs in with
 * the emailed temporary password, sets up two-step sign-in, must replace the password, and only then gets in.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { client, platformAdmin, setupApi, totp, type Api, type TestEnv } from "./support.ts";

interface Sent {
  to: string;
  name: string;
  tempPassword: string;
  loginUrl: string;
}

let env: TestEnv;
let admin: Api;
let orgId: string;
let clinicId: string;
const outbox: Sent[] = [];
let mailWorks = true;

beforeAll(async () => {
  env = await setupApi({
    mailer: {
      available: true,
      async sendInvitation(to, name, tempPassword, loginUrl) {
        if (!mailWorks) throw new Error("smtp down");
        outbox.push({ to, name, tempPassword, loginUrl });
        return true;
      },
    },
  });
  admin = (await platformAdmin(env)).api;
  orgId = (await admin("/v1/admin/organizations", { method: "POST", body: { name: "Flow Org", region: "il", default_locale: "he" } })).body.organization.id;
  clinicId = (await admin(`/v1/admin/organizations/${orgId}/clinics`, { method: "POST", body: { name: "Flow Clinic", country_code: "IL", timezone: "Asia/Jerusalem" } })).body.clinic.id;
}, 30_000);

afterAll(async () => {
  await env?.close();
}, 10_000);

const lastMailTo = (email: string) => outbox.filter((m) => m.to === email).at(-1)!;

async function invite(email: string, name: string) {
  const res = await admin("/v1/admin/users", { method: "POST", body: { email, full_name: name, role: "therapist", organization_id: orgId, clinic_id: clinicId } });
  expect(res.status).toBe(201);
  return res.body.user.id as string;
}

/** Signs in with a password and enrols in two-step sign-in, as a new person does on first use. */
async function firstSignIn(email: string, password: string): Promise<Api> {
  const api = client(env.app);
  const signIn = await api("/api/auth/sign-in/email", { method: "POST", body: { email, password } });
  expect(signIn.status).toBe(200);
  const enable = await api("/api/auth/two-factor/enable", { method: "POST", body: { password } });
  expect(enable.status).toBe(200);
  const secret = new URL(enable.body.totpURI).searchParams.get("secret")!;
  env.nextStep();
  expect((await api("/api/auth/two-factor/verify-totp", { method: "POST", body: { code: totp(secret) } })).status).toBe(200);
  return api;
}

describe("admin invitation flow", () => {
  it("emails the invitation with a temporary password and no organization, clinic or role", async () => {
    await invite("Invited.Person@synthetic.test", "Invited Person");
    const mail = lastMailTo("invited.person@synthetic.test");
    expect(mail).toBeDefined();
    expect(mail.name).toBe("Invited Person");
    expect(mail.tempPassword.length).toBeGreaterThanOrEqual(12);
    expect(mail.loginUrl).toMatch(/\/sign-in$/);
    expect(JSON.stringify(mail)).not.toMatch(/Flow Org|Flow Clinic|therapist/i);
  });

  it("lets the invited person in only after they replace the temporary password", async () => {
    const email = "invited.person@synthetic.test";
    const temp = lastMailTo(email).tempPassword;
    const api = await firstSignIn(email, temp);

    const me = await api("/v1/me");
    expect(me.status).toBe(200);
    expect(me.body.user_status).toBe("invited");
    expect(me.body.memberships).toEqual([expect.objectContaining({ clinic_id: clinicId, organization_id: orgId, role: "therapist" })]);
    const blocked = await api("/v1/patients");
    expect(blocked.status).toBe(403);
    expect(blocked.body.error).toBe("password_change_required");

    // An invited person can only ever make themselves active.
    expect((await api("/v1/me/status", { method: "PATCH", body: { status: "disabled" } })).status).toBe(400);

    const newPassword = "a brand new passphrase 42";
    expect((await api("/api/auth/change-password", { method: "POST", body: { currentPassword: temp, newPassword, revokeOtherSessions: true } })).status).toBe(200);
    expect((await api("/v1/me/status", { method: "PATCH", body: { status: "active" } })).status).toBe(200);
    expect((await api("/v1/me")).body.user_status).toBe("active");
    expect((await api(`/v1/patients?clinic=${clinicId}`)).status).toBe(200);

    // The emailed password is dead; the new one works.
    const again = client(env.app);
    expect((await again("/api/auth/sign-in/email", { method: "POST", body: { email, password: temp } })).status).toBe(401);
    expect((await again("/api/auth/sign-in/email", { method: "POST", body: { email, password: newPassword } })).status).toBe(200);

    // Activating twice is refused, and an active person can't be re-invited.
    expect((await api("/v1/me/status", { method: "PATCH", body: { status: "active" } })).status).toBe(409);
  });

  it("resend-invite sends a new password that works and kills the old one", async () => {
    const email = "second.person@synthetic.test";
    const id = await invite(email, "Second Person");
    const first = lastMailTo(email).tempPassword;
    const res = await admin(`/v1/admin/users/${id}/resend-invite`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBe(true);
    const second = lastMailTo(email).tempPassword;
    expect(second).not.toBe(first);
    const api = client(env.app);
    expect((await api("/api/auth/sign-in/email", { method: "POST", body: { email, password: first } })).status).toBe(401);
    expect((await api("/api/auth/sign-in/email", { method: "POST", body: { email, password: second } })).status).toBe(200);
  });

  it("still creates the account when the email can't be sent, and says so", async () => {
    mailWorks = false;
    try {
      const res = await admin("/v1/admin/users", {
        method: "POST",
        body: { email: "no.mail@synthetic.test", full_name: "No Mail", role: "assistant", organization_id: orgId, clinic_id: clinicId },
      });
      expect(res.status).toBe(201);
      expect(res.body.email_sent).toBe(false);
      expect(res.body.user.status).toBe("invited");
      const resend = await admin(`/v1/admin/users/${res.body.user.id}/resend-invite`, { method: "POST" });
      expect(resend.status).toBe(200);
      expect(resend.body.sent).toBe(false);
    } finally {
      mailWorks = true;
    }
  });

  it("a disabled person can't get back in, even with the right password", async () => {
    const email = "leaving.person@synthetic.test";
    const id = await invite(email, "Leaving Person");
    const api = await firstSignIn(email, lastMailTo(email).tempPassword);
    expect((await admin(`/v1/admin/users/${id}`, { method: "PATCH", body: { status: "disabled" } })).status).toBe(200);
    expect((await api("/v1/me")).status).toBe(401);
    const back = client(env.app);
    await back("/api/auth/sign-in/email", { method: "POST", body: { email, password: lastMailTo(email).tempPassword } });
    const me = await back("/v1/me");
    expect([401, 403]).toContain(me.status);
    expect((await back("/v1/patients")).status).not.toBe(200);
  });
});
