# System Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform admins can create and manage organizations, clinics, and staff users through the web UI, with email invitations and forced password change on first login.

**Architecture:** New migration adds platform-admin RLS policies on existing tables plus a self-activate policy. A new `admin` API module under `/v1/admin` (behind `is_platform_admin()` middleware) handles CRUD for orgs, clinics, and users, with invitation email via Gmail SMTP. The web SPA gets a `/change-password` gate in `RequireStaff`, new admin routes, and i18n keys in `en`/`he`.

**Tech Stack:** Hono routes, pg (via `withUser()`), Better Auth internal adapter, nodemailer, Zod validation, React + React Router, `@emb/ui` components, ICU messages.

**Spec:** `docs/superpowers/specs/2026-11-16-system-admin-design.md`

## Global Constraints

- RLS ENABLE + FORCE + policies in the same migration for every new table (CLAUDE.md §1). No new tables here, but new policies go in the migration.
- `SET LOCAL app.user_id` per transaction; never pass client-supplied ids as an authorization shortcut (CLAUDE.md §3).
- RTL and i18n from day one: CSS logical properties, ICU messages, no hard-coded UI strings (CLAUDE.md §10).
- No patient data in notifications, logs, analytics, or error reports (CLAUDE.md §7).
- Invitation email mentions no clinic name, org name, or role — just the platform name and credentials (spec §Email).
- Email credentials stored only in env vars, never in source code (spec §Anti-Goals).
- Games are "game-based activities", never "assessment", "treatment", or "diagnosis" (CLAUDE.md §9).
- `app_user.status` default in `0001_core_tenancy.sql` is `'invited'`; the auth hook in `auth.ts` sets new users to `'active'` via `ON CONFLICT DO NOTHING`, so admin-created users whose `app_user` row is inserted first with `status = 'invited'` keep that status.

## Review Focus

1. **Admin-created user whose `databaseHooks.user.create.after` fires before the admin API sets `status = 'invited'`:** The hook inserts `status = 'active'`; the admin route must overwrite to `'invited'` after creation, and the test must verify the final status is `'invited'`, not `'active'`.
2. **A non-admin user hitting any `/v1/admin/*` endpoint:** The `requireAdmin` middleware must return 403 before any query runs; the test must verify this for every HTTP method.
3. **Self-activate policy allowing a user to set their status to anything other than `'active'`:** The `WITH CHECK` must constrain `status = 'active'`; the test must try setting `status = 'disabled'` on oneself and expect rejection.
4. **Invited user navigating past `/change-password` without changing their password:** `RequireStaff` must check `user_status` on every render and redirect; the API test must verify that an invited user can hit `/v1/me` but that the response includes `user_status: 'invited'`.
5. **Resend-invite on a user whose status is `'active'`:** The endpoint must reject it (the user has already activated); test must verify 400/409.

---

### Task 1: Migration — Platform-Admin RLS Policies and Self-Activate

**Files:**
- Create: `packages/db/migrations/0019_admin_policies.sql`
- Modify: `packages/db/test/rls.test.ts` (add platform-admin and self-activate tests)

**Interfaces:**
- Consumes: `app.is_platform_admin()` from `0010_video_library.sql`, existing tables from `0001_core_tenancy.sql`
- Produces: RLS policies `org_admin_all`, `clinic_admin_all`, `user_admin_all`, `membership_admin_all`, `user_self_activate` — all later tasks' queries depend on these policies being in place.

- [ ] **Step 1: Write failing RLS tests**

Add to `packages/db/test/rls.test.ts`:

```typescript
// In the seed section (beforeAll), add a platform admin user and org-wide membership:
// ids.admin = randomUUID(); // new id
// INSERT INTO app.app_user ... (ids.admin, 'admin@synthetic.test', 'Admin', 'staff', 'active')
// INSERT INTO app.membership ... (ids.admin, ids.org1, NULL, 'platform_admin')

it("platform admin can read all organizations", async () => {
  await asUser(ids.admin, async (c) => {
    const { rows } = await c.query("SELECT id FROM app.organization ORDER BY id");
    expect(rows.map(r => r.id).sort()).toEqual([ids.org1, ids.org2].sort());
  });
});

it("platform admin can insert an organization", async () => {
  await asUser(ids.admin, async (c) => {
    await c.query("INSERT INTO app.organization (id, name, region) VALUES ($1, 'New Org', 'us')", [randomUUID()]);
  });
});

it("platform admin can update any clinic", async () => {
  await asUser(ids.admin, async (c) => {
    await c.query("UPDATE app.clinic SET name = 'Renamed' WHERE id = $1", [ids.clinic2]);
    const { rows } = await c.query("SELECT name FROM app.clinic WHERE id = $1", [ids.clinic2]);
    expect(rows[0].name).toBe("Renamed");
  });
});

it("platform admin can read and insert memberships across orgs", async () => {
  await asUser(ids.admin, async (c) => {
    const { rows } = await c.query("SELECT id FROM app.membership");
    expect(rows.length).toBeGreaterThan(0);
    await c.query(
      "INSERT INTO app.membership (user_id, organization_id, clinic_id, role) VALUES ($1, $2, $3, 'therapist')",
      [ids.therapistA, ids.org2, ids.clinic2]
    );
  });
});

it("platform admin can read all app_user rows", async () => {
  await asUser(ids.admin, async (c) => {
    const { rows } = await c.query("SELECT id FROM app.app_user");
    expect(rows.length).toBeGreaterThanOrEqual(4); // therapistA, therapistB, managerM, outsider, admin
  });
});

it("user can self-activate from invited to active", async () => {
  const selfActivate = randomUUID();
  // Seed as superuser: an invited user
  await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'sa@test', 'SA', 'staff', 'invited')", [selfActivate]);
  await asUser(selfActivate, async (c) => {
    await c.query("UPDATE app.app_user SET status = 'active' WHERE id = $1", [selfActivate]);
    const { rows } = await c.query("SELECT status FROM app.app_user WHERE id = $1", [selfActivate]);
    expect(rows[0].status).toBe("active");
  });
});

it("user cannot self-set status to disabled", async () => {
  const noDisable = randomUUID();
  await db.query("INSERT INTO app.app_user (id, email, full_name, kind, status) VALUES ($1, 'nd@test', 'ND', 'staff', 'active')", [noDisable]);
  await asUser(noDisable, async (c) => {
    await expect(c.query("UPDATE app.app_user SET status = 'disabled' WHERE id = $1", [noDisable]))
      .rejects.toThrow(); // RLS WITH CHECK prevents status != 'active'
  });
});

it("non-admin cannot read orgs outside their membership", async () => {
  // outsider has no membership — should still see nothing
  await asUser(ids.outsider, async (c) => {
    const { rows } = await c.query("SELECT id FROM app.organization");
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/db test`
Expected: FAIL — policies `org_admin_all` etc. do not exist yet.

- [ ] **Step 3: Write migration `0019_admin_policies.sql`**

```sql
-- 0019: platform-admin policies for system administration (spec 2026-11-16).
-- Platform admins get full access to organization, clinic, app_user, and
-- membership rows. A self-activate policy lets invited users flip their own
-- status to 'active' after changing their password.

CREATE POLICY org_admin_all ON app.organization FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

CREATE POLICY clinic_admin_all ON app.clinic FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

CREATE POLICY user_admin_all ON app.app_user FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

CREATE POLICY membership_admin_all ON app.membership FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- Self-activate: an invited user can flip their own status to 'active'.
-- The WITH CHECK constrains the new value (status must be 'active');
-- the USING constrains which row (only the user's own row).
CREATE POLICY user_self_activate ON app.app_user FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id() AND status = 'active');
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/db test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations/0019_admin_policies.sql packages/db/test/rls.test.ts
git commit -m "feat(db): add platform-admin and self-activate RLS policies

New migration 0019 adds FOR ALL policies on organization, clinic,
app_user, and membership for platform admins, plus a self-activate
policy that lets invited users set their own status to 'active'."
```

---

### Task 2: Email Module

**Files:**
- Create: `apps/api/src/email.ts`
- Create: `apps/api/test/email.test.ts`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: `createMailer(): Mailer`, `Mailer.sendInvitation(to: string, name: string, tempPassword: string, loginUrl: string): Promise<boolean>` — Task 4 calls `sendInvitation`.

- [ ] **Step 1: Write failing test for the email module**

```typescript
// apps/api/test/email.test.ts
import { describe, expect, it } from "vitest";
import { createMailer, generateTempPassword } from "../src/email.ts";

describe("email", () => {
  it("generateTempPassword produces a string of at least 16 chars with mixed character classes", () => {
    const pw = generateTempPassword();
    expect(pw.length).toBeGreaterThanOrEqual(16);
    expect(pw).toMatch(/[a-z]/);
    expect(pw).toMatch(/[A-Z]/);
    expect(pw).toMatch(/[0-9]/);
  });

  it("createMailer without SMTP_HOST returns a no-op mailer", () => {
    const mailer = createMailer({});
    expect(mailer.available).toBe(false);
  });

  it("sendInvitation on a no-op mailer returns false", async () => {
    const mailer = createMailer({});
    const sent = await mailer.sendInvitation("x@test", "X", "pw123", "https://app/sign-in");
    expect(sent).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @emb/api test email.test`
Expected: FAIL — `email.ts` does not exist.

- [ ] **Step 3: Implement `apps/api/src/email.ts`**

Exports:
- `generateTempPassword(): string` — `crypto.randomBytes(12).toString('base64url').slice(0, 16)` plus ensuring at least one lowercase, one uppercase, one digit (replace last 3 chars if needed).
- `interface MailerConfig { SMTP_HOST?: string; SMTP_PORT?: string; SMTP_SECURE?: string; SMTP_USER?: string; SMTP_PASS?: string; }` — read from `process.env`.
- `interface Mailer { available: boolean; sendInvitation(to, name, tempPassword, loginUrl): Promise<boolean> }`
- `createMailer(env: MailerConfig): Mailer` — if `SMTP_HOST` is set, creates a `nodemailer.createTransport` and returns a real mailer; otherwise returns a no-op mailer that logs a warning and returns `false`.
- The email HTML template: simple inline-CSS, mobile-friendly. Contains greeting, "You've been invited to eMazeBrain", the temp password, a sign-in link, and instructions to change the password. **No patient data, no clinic name, no org name, no role.**

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @emb/api test email.test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/email.ts apps/api/test/email.test.ts
git commit -m "feat(api): add email module with invitation mailer

Thin nodemailer wrapper that sends invitation emails through Gmail
SMTP. Falls back to a no-op mailer when SMTP_HOST is not set.
Includes generateTempPassword() for secure temporary passwords."
```

---

### Task 3: `/v1/me` — Add `user_status` and `PATCH /v1/me/status`

**Files:**
- Modify: `apps/api/src/modules/me/routes.ts`
- Modify: `apps/api/test/auth-flow.test.ts` (or create a new `me-api.test.ts`)
- Modify: `apps/web/src/api/queries.ts` (add `user_status` to `Me` type)

**Interfaces:**
- Consumes: `user_self_activate` policy from Task 1
- Produces: `GET /v1/me` now returns `user_status: string` in the response. `PATCH /v1/me/status` with `{ status: 'active' }` flips `invited → active`. Task 6 (web) uses both.

- [ ] **Step 1: Write failing tests**

Add to an existing or new test file:

```typescript
it("GET /v1/me includes user_status", async () => {
  const res = await therapist("/v1/me");
  expect(res.status).toBe(200);
  expect(res.body.user_status).toBe("active");
});

it("PATCH /v1/me/status transitions invited → active", async () => {
  // Create an invited user (via direct DB insert), sign them in
  // Set app_user.status = 'invited' via superuser
  // Then PATCH /v1/me/status { status: 'active' }
  // Verify 200 and that subsequent GET /v1/me shows user_status: 'active'
});

it("PATCH /v1/me/status rejects active → disabled", async () => {
  const res = await therapist("/v1/me/status", { method: "PATCH", body: { status: "disabled" } });
  expect(res.status).toBe(400);
});

it("PATCH /v1/me/status rejects active → active (no-op but validates)", async () => {
  // An active user trying invited→active is illogical; endpoint rejects non-invited users
  const res = await therapist("/v1/me/status", { method: "PATCH", body: { status: "active" } });
  expect(res.status).toBe(409); // not invited
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test`
Expected: FAIL — `user_status` not in response, `/v1/me/status` route does not exist.

- [ ] **Step 3: Implement changes**

In `apps/api/src/modules/me/routes.ts`:
- In the `GET /` handler, add a query for `app_user.status`:
  ```sql
  SELECT status FROM app.app_user WHERE id = app.current_user_id()
  ```
  Return it as `user_status` in the JSON response.
- Add `PATCH /status` handler: accepts `{ status: 'active' }` only. Validates the current status is `'invited'` (read first, reject with 409 if not `'invited'`). Then `UPDATE app.app_user SET status = 'active' WHERE id = app.current_user_id()` — the `user_self_activate` RLS policy allows this.

In `apps/web/src/api/queries.ts`:
- Add `user_status?: string` to the `Me` type.

- [ ] **Step 4: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/me/routes.ts apps/web/src/api/queries.ts apps/api/test/...
git commit -m "feat(api): return user_status in /v1/me, add PATCH /v1/me/status

GET /v1/me now includes user_status (the app_user.status value).
PATCH /v1/me/status allows the invited → active transition only,
used after a forced password change on first login."
```

---

### Task 4: Admin API Module — Organizations, Clinics, Users

**Files:**
- Create: `apps/api/src/modules/admin/routes.ts`
- Create: `apps/api/src/modules/admin/schemas.ts` (Zod schemas for input validation)
- Modify: `apps/api/src/app.ts` (mount admin routes)
- Create: `apps/api/test/admin-api.test.ts`

**Interfaces:**
- Consumes: `withUser()` from `context.ts`, `Env` type, `Auth` from `auth.ts` (for `context.internalAdapter`), `Mailer` from Task 2, RLS policies from Task 1.
- Produces: All admin endpoints from the spec:
  - `GET/POST/PATCH /v1/admin/organizations[/:id]`
  - `GET/POST /v1/admin/organizations/:orgId/clinics`
  - `PATCH /v1/admin/clinics/:id`
  - `GET/POST /v1/admin/users[/:id]`
  - `PATCH /v1/admin/users/:id`
  - `POST /v1/admin/users/:id/resend-invite`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/api/test/admin-api.test.ts
describe("admin API", () => {
  // Setup: env, admin (platform admin), therapist (non-admin)

  it("non-admin gets 403 on all admin endpoints", async () => {
    expect((await therapist("/v1/admin/organizations")).status).toBe(403);
    expect((await therapist("/v1/admin/organizations", { method: "POST", body: { name: "X", region: "il", default_locale: "he" } })).status).toBe(403);
    expect((await therapist("/v1/admin/users", { method: "POST", body: {} })).status).toBe(403);
  });

  it("admin creates an organization", async () => {
    const res = await admin("/v1/admin/organizations", {
      method: "POST",
      body: { name: "Rambam Health", region: "il", default_locale: "he" },
    });
    expect(res.status).toBe(201);
    expect(res.body.organization).toMatchObject({ name: "Rambam Health", region: "il", status: "active" });
  });

  it("admin lists organizations", async () => {
    const res = await admin("/v1/admin/organizations");
    expect(res.status).toBe(200);
    expect(res.body.organizations.length).toBeGreaterThan(0);
  });

  it("admin creates a clinic under an organization", async () => {
    const res = await admin(`/v1/admin/organizations/${orgId}/clinics`, {
      method: "POST",
      body: { name: "Tel Aviv Clinic", country_code: "IL", timezone: "Asia/Jerusalem" },
    });
    expect(res.status).toBe(201);
    expect(res.body.clinic).toMatchObject({ name: "Tel Aviv Clinic" });
  });

  it("admin creates a user with invitation", async () => {
    const res = await admin("/v1/admin/users", {
      method: "POST",
      body: { email: "new.therapist@synthetic.test", full_name: "New Therapist", role: "therapist", organization_id: orgId, clinic_id: clinicId },
    });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: "new.therapist@synthetic.test", status: "invited" });
    expect(res.body.membership).toBeDefined();
    expect(res.body).toHaveProperty("email_sent"); // boolean
  });

  it("admin can resend invite for an invited user", async () => {
    const res = await admin(`/v1/admin/users/${userId}/resend-invite`, { method: "POST" });
    expect(res.status).toBe(200);
    expect(res.body.sent).toBeDefined();
  });

  it("resend-invite rejects for an active user", async () => {
    // Use an already-active user id
    const res = await admin(`/v1/admin/users/${activeUserId}/resend-invite`, { method: "POST" });
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test admin-api`
Expected: FAIL — admin module does not exist.

- [ ] **Step 3: Create Zod schemas in `apps/api/src/modules/admin/schemas.ts`**

Define: `createOrgSchema`, `patchOrgSchema`, `createClinicSchema`, `patchClinicSchema`, `createUserSchema`, `patchUserSchema`. Use `z.enum` for `region`, `member_role`, `locale`. Validate `email` as a valid email string.

- [ ] **Step 4: Implement `apps/api/src/modules/admin/routes.ts`**

Export `adminRoutes(pool: pg.Pool, auth: Auth, mailer: Mailer): Hono<Env>`.

Structure:
- A `requireAdmin` middleware at the router level: calls `withUser()` to run `SELECT app.is_platform_admin() AS a`, returns 403 if false.
- Organization routes: straightforward SQL INSERT/SELECT/UPDATE through `withUser()`.
- Clinic routes: INSERT with `organization_id` from the URL param.
- User creation (`POST /v1/admin/users`):
  1. `generateTempPassword()`
  2. Hash password with `Bun.password.hash` or the approach Better Auth uses internally (check `context.internalAdapter` — may be `createUser({ email, name, password })` which hashes internally).
  3. Call `auth.api` internal adapter to create the auth user. The `databaseHooks.user.create.after` hook fires and inserts `app_user` with `status = 'active'`.
  4. Immediately `UPDATE app.app_user SET status = 'invited' WHERE id = $1` (via `withUser()`).
  5. Insert membership row.
  6. Send invitation email (non-blocking; catch errors).
  7. Return `{ user, membership, email_sent }`.
- Resend invite (`POST /v1/admin/users/:id/resend-invite`):
  1. Check user status is `'invited'`; reject otherwise.
  2. Generate new temp password.
  3. Update password hash via internal adapter.
  4. Send invitation email.

- [ ] **Step 5: Mount admin routes in `apps/api/src/app.ts`**

Add `import { adminRoutes } from "./modules/admin/routes.ts"` and mount:
```typescript
v1.route("/admin", adminRoutes(deps.pool, deps.auth, mailer));
```

The `Mailer` comes from `createMailer(process.env)` in `server.ts`, threaded through `AppDeps`.

- [ ] **Step 6: Update `apps/api/src/server.ts` to create the mailer and pass it into `AppDeps`**

Add `import { createMailer } from "./email.ts"` and create `const mailer = createMailer(process.env)` in the startup. Add `mailer` to `AppDeps` interface and pass it into `createApp`.

- [ ] **Step 7: Run tests to verify they pass**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test admin-api`
Expected: PASS

- [ ] **Step 8: Run full API test suite**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test`
Expected: PASS (no regressions)

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/admin/ apps/api/src/app.ts apps/api/src/server.ts apps/api/test/admin-api.test.ts
git commit -m "feat(api): add admin module for org/clinic/user management

Platform admins can create and manage organizations, clinics, and
users via /v1/admin endpoints. User creation goes through Better
Auth's internal adapter and sends an invitation email with a
temporary password."
```

---

### Task 5: i18n Keys — `admin.*` and `auth.changePassword.*`

**Files:**
- Modify: `apps/web/src/i18n/messages/en.json`
- Modify: `apps/web/src/i18n/messages/he.json`

**Interfaces:**
- Consumes: nothing from other tasks
- Produces: i18n keys used by Tasks 6 and 7. Keys:
  - `admin.nav.organizations`, `admin.organizations.title`, `admin.organizations.new`, `admin.organizations.name`, `admin.organizations.region`, `admin.organizations.locale`, `admin.organizations.status`, `admin.organizations.statusActive`, `admin.organizations.statusSuspended`, `admin.organizations.statusClosed`, `admin.organizations.create`, `admin.organizations.edit`, `admin.organizations.save`
  - `admin.clinics.title`, `admin.clinics.new`, `admin.clinics.name`, `admin.clinics.country`, `admin.clinics.timezone`, `admin.clinics.status`, `admin.clinics.create`, `admin.clinics.edit`, `admin.clinics.save`
  - `admin.users.title`, `admin.users.new`, `admin.users.email`, `admin.users.name`, `admin.users.role`, `admin.users.organization`, `admin.users.clinic`, `admin.users.status`, `admin.users.create`, `admin.users.resendInvite`, `admin.users.resendSuccess`, `admin.users.resendFailed`, `admin.users.invited`, `admin.users.active`, `admin.users.disabled`
  - `auth.changePassword.title`, `auth.changePassword.subtitle`, `auth.changePassword.newPassword`, `auth.changePassword.confirmPassword`, `auth.changePassword.submit`, `auth.changePassword.mismatch`, `auth.changePassword.tooShort`, `auth.changePassword.success`

- [ ] **Step 1: Add English keys to `en.json`**

Add all keys listed above with English values. Ensure no hard-coded UI strings.

- [ ] **Step 2: Add Hebrew keys to `he.json`**

Add all corresponding keys with Hebrew translations. Hebrew values need native verification (note in commit).

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/i18n/messages/en.json apps/web/src/i18n/messages/he.json
git commit -m "feat(i18n): add admin and change-password message keys

English and Hebrew translations for admin screens and the forced
password change flow. Hebrew labels need native speaker verification."
```

---

### Task 6: Forced Password Change — `/change-password` Route

**Files:**
- Create: `apps/web/src/routes/change-password.tsx`
- Modify: `apps/web/src/App.tsx` (add route, modify `RequireStaff` to redirect invited users)
- Modify: `apps/web/src/api/queries.ts` (if not already done in Task 3)

**Interfaces:**
- Consumes: `user_status` from `GET /v1/me` (Task 3), `PATCH /v1/me/status` (Task 3), Better Auth's change-password endpoint, i18n keys from Task 5.
- Produces: The `/change-password` page component and the redirect logic in `RequireStaff`. Task 7 (admin screens) does not depend on this.

- [ ] **Step 1: Write the `/change-password` page component**

`apps/web/src/routes/change-password.tsx`:
- Form with new password and confirm password fields (using `@emb/ui` form components).
- Validates: min 12 chars, passwords match.
- On submit:
  1. Calls Better Auth's `authClient.changePassword()` (or the appropriate endpoint).
  2. On success, calls `PATCH /v1/me/status` with `{ status: 'active' }`.
  3. Redirects to `/today`.
- All strings via `useT()` and `auth.changePassword.*` keys.
- CSS logical properties only for RTL.

- [ ] **Step 2: Modify `RequireStaff` in `App.tsx` to gate invited users**

In the `StaffArea` or `RequireStaff` component, after `me.data` is available:
- If `me.data.user_status === 'invited'` and location is not `/change-password`, redirect to `/change-password`.
- Add the `/change-password` route in the `bare` `RequireStaff` children (like consent — no shell navigation).

```typescript
// In routes array, inside the bare RequireStaff:
{ path: "/change-password", element: <ChangePasswordPage /> },
```

In `RequireStaff`, after line 113 (before returning `<StaffArea>`):
```typescript
if (me.data.user_status === 'invited' && location.pathname !== '/change-password') {
  return <Navigate to="/change-password" replace />;
}
```

- [ ] **Step 3: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 4: Manual smoke check (dev server)**

Run: `pnpm --filter @emb/web dev` — verify the route exists and renders without errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/change-password.tsx apps/web/src/App.tsx
git commit -m "feat(web): add forced password change for invited users

Invited users are redirected to /change-password on every load of
RequireStaff. After setting a new password, the user's status flips
to 'active' and they proceed to the app."
```

---

### Task 7: Admin Web UI — Organizations, Clinics, Users Screens

**Files:**
- Create: `apps/web/src/routes/admin/organizations.tsx` (list + detail)
- Create: `apps/web/src/routes/admin/org-form.tsx` (create + edit)
- Create: `apps/web/src/routes/admin/clinic-form.tsx` (create + edit)
- Create: `apps/web/src/routes/admin/clinic-detail.tsx`
- Create: `apps/web/src/routes/admin/user-form.tsx`
- Modify: `apps/web/src/App.tsx` (add admin routes)
- Modify: `apps/web/src/shell/ClinicShell.tsx` (add Organizations nav item)
- Create: `apps/web/src/api/admin.ts` (API client functions for admin endpoints)

**Interfaces:**
- Consumes: All admin API endpoints from Task 4, i18n keys from Task 5, `me.is_platform_admin` from existing `/v1/me`.
- Produces: The complete admin UI. No other task depends on this.

- [ ] **Step 1: Create API client functions in `apps/web/src/api/admin.ts`**

Functions wrapping fetch calls to each admin endpoint:
- `listOrganizations(status?)`, `getOrganization(id)`, `createOrganization(data)`, `patchOrganization(id, data)`
- `listClinics(orgId)`, `createClinic(orgId, data)`, `patchClinic(id, data)`
- `listUsers(filters)`, `createUser(data)`, `patchUser(id, data)`, `resendInvite(id)`

Each returns the parsed JSON. Use the existing `http.ts` fetch wrapper pattern.

- [ ] **Step 2: Build OrganizationsPage (list)**

`apps/web/src/routes/admin/organizations.tsx`:
- Uses `useQuery` to fetch organizations.
- Renders a `DataList` (from `@emb/ui`) with name, region, status badge (`Chip`).
- Link to `/admin/organizations/new` (create button).
- Each row links to `/admin/organizations/:id`.
- All strings via `useT()`.

- [ ] **Step 3: Build OrgDetailPage**

In the same file or a sibling: shows org info, clinics list (from `GET /v1/admin/organizations/:id`), admin users. Links to edit org, add clinic, add user.

- [ ] **Step 4: Build OrgFormPage (create + edit)**

`apps/web/src/routes/admin/org-form.tsx`:
- Shared form for create and edit (determined by presence of `:id` param).
- Fields: name (text), region (select: il/us/eu), default_locale (select).
- Zod validation on submit. `useMutation` for create/update.
- RTL-safe layout.

- [ ] **Step 5: Build ClinicFormPage and ClinicDetailPage**

`apps/web/src/routes/admin/clinic-form.tsx`:
- Fields: name, country_code (select), timezone (select filtered by region).

`apps/web/src/routes/admin/clinic-detail.tsx`:
- Shows clinic info, users list. Links to edit, add user.

- [ ] **Step 6: Build UserFormPage**

`apps/web/src/routes/admin/user-form.tsx`:
- Fields: email, full_name, role (select from member_role), organization (select), clinic (select, filtered by org; nullable for org-wide).
- `useMutation` for create.

- [ ] **Step 7: Add admin routes to `App.tsx`**

Inside the shell `RequireStaff` children:
```typescript
{ path: "/admin/organizations", element: <OrganizationsPage /> },
{ path: "/admin/organizations/new", element: <OrgFormPage /> },
{ path: "/admin/organizations/:id", element: <OrgDetailPage /> },
{ path: "/admin/organizations/:id/edit", element: <OrgFormPage /> },
{ path: "/admin/organizations/:orgId/clinics/new", element: <ClinicFormPage /> },
{ path: "/admin/clinics/:id", element: <ClinicDetailPage /> },
{ path: "/admin/clinics/:id/edit", element: <ClinicFormPage /> },
{ path: "/admin/users/new", element: <UserFormPage /> },
```

- [ ] **Step 8: Add Organizations nav item to ClinicShell**

In `apps/web/src/shell/ClinicShell.tsx`, in the platform admin conditional block, add an "Organizations" item with a `Building2` icon before the Videos item.

- [ ] **Step 9: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/routes/admin/ apps/web/src/api/admin.ts apps/web/src/App.tsx apps/web/src/shell/ClinicShell.tsx
git commit -m "feat(web): add admin screens for orgs, clinics, and users

Platform admins see an Organizations nav item and can create/edit
organizations, clinics, and users. User creation triggers an
invitation email. All screens use i18n keys and CSS logical properties."
```

---

### Task 8: Integration Test — Full Admin + Invitation + Password Change Flow

**Files:**
- Create or extend: `apps/api/test/admin-flow.test.ts`

**Interfaces:**
- Consumes: Everything from Tasks 1–4.
- Produces: An end-to-end test proving the full flow works.

- [ ] **Step 1: Write the integration test**

```typescript
describe("admin invitation flow", () => {
  it("admin creates org → clinic → user; invited user signs in, is forced to change password, then accesses app", async () => {
    // 1. Admin creates org
    // 2. Admin creates clinic under org
    // 3. Admin creates user (email, role: therapist, org, clinic)
    //    → verify user.status = 'invited', email_sent is boolean
    // 4. Sign in as the new user with the temp password (we can't read the email,
    //    so we read the password hash — or we mock the mailer and capture the password)
    // 5. Complete MFA setup
    // 6. GET /v1/me → verify user_status = 'invited'
    // 7. PATCH /v1/me/status { status: 'active' } → verify 200
    // 8. GET /v1/me → verify user_status = 'active'
    // 9. Access a /v1 endpoint → verify 200 (not stuck)
  });

  it("resend-invite generates a new password that works", async () => {
    // 1. Admin creates user → capture temp password from mailer mock
    // 2. Admin resends invite → capture new temp password
    // 3. Old password should NOT work (hash replaced)
    // 4. New password works for sign-in
  });
});
```

The test needs a mailer mock/spy — inject a test mailer that captures the temp password rather than sending email. Add a `mailer?: Mailer` to `AppDeps` to allow this.

- [ ] **Step 2: Run test to verify it fails**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test admin-flow`
Expected: FAIL — until all pieces are in place.

- [ ] **Step 3: Make any adjustments needed to pass**

This is the integration test that proves all the pieces fit. Fix any issues discovered.

- [ ] **Step 4: Run the full test suite**

Run: `DATABASE_URL=postgres://postgres@localhost:5432/postgres pnpm --filter @emb/api test`
Expected: PASS

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/admin-flow.test.ts apps/api/src/app.ts
git commit -m "test(api): add end-to-end admin invitation flow test

Covers the full cycle: admin creates org/clinic/user, invited user
signs in, changes password, activates, and accesses the app.
Also tests resend-invite replaces the temp password."
```
