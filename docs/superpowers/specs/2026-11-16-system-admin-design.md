# System Administration — Design

## Intent and Why

eMazeBrain is a multi-tenant platform: organizations own clinics, clinics
employ therapists, therapists treat patients. Today there is no way for
anyone to create an organization, a clinic, or the first user inside them —
the production admin was bootstrapped by hand with SQL. The platform needs a
self-service admin surface so that the eMazeBrain team can onboard new
customers (organizations) and those organizations' clinics without touching
the database, and so each new clinic receives a credentialed admin user who
can then manage their own staff and patients.

The audience is the **platform administrator** — an eMazeBrain team member
(role `platform_admin`) who sets up the platform for clinical organizations.

## Goals

1. Platform admins can create, edit, and suspend/close organizations.
2. Platform admins can create, edit, and deactivate clinics under an
   organization.
3. Platform admins can create staff users, assigning them a role and
   organization/clinic membership.
4. New users receive an email invitation with a temporary password from
   `emazebrain@gmail.com` via Gmail SMTP.
5. Invited users must change their temporary password on first login before
   accessing any other screen.
6. All new tables and mutations respect the existing RLS/tenancy model.

## Non-Goals

- Self-registration (organizations signing themselves up).
- Patient-facing user management (guardians).
- Billing or subscription management.
- Org admin or clinic manager self-service (they already manage staff via
  the existing Team page — §5.2).
- Two-factor setup flow (already exists; invited users go through it after
  the forced password change).

## Anti-Goals (failure if these happen)

- A non-platform-admin can reach admin API endpoints or see admin screens.
- Real patient data appears in invitation emails, logs, or error reports.
- An invited user can access the platform without changing their temporary
  password.
- The app stores email credentials in source code.

## Constraints (from CLAUDE.md and the design doc)

- RLS ENABLE + FORCE + policies in the same migration for every new table.
- `SET LOCAL app.user_id` per transaction; never pass client-supplied ids
  as an authorization shortcut.
- RTL and i18n from day one: CSS logical properties, ICU messages, no
  hard-coded UI strings.
- No patient data in notifications, logs, analytics, or error reports.
- Wording: games are "game-based activities", never "assessment",
  "treatment", or "diagnosis".

## Approaches Considered

### A. Admin module in the existing API + SPA (chosen)

Add a new `apps/api/src/modules/admin/` module with routes guarded by
`is_platform_admin()`. The web SPA gets new `/admin/*` routes visible only
when `me.is_platform_admin` is true. User creation goes through Better
Auth's internal adapter to create the auth identity, then a matching
`app.app_user` row (the existing `databaseHooks.user.create.after` handles
the second half).

**Pros:** Consistent with how videos admin already works. Reuses the
existing shell, auth, RLS, and i18n. One deployment surface (Railway API +
Vercel SPA). Platform admin already has a nav pattern (the Videos link).

**Cons:** Admin screens share a bundle with the therapist app, adding
weight for therapist users who never use them (mitigated by route-based
code splitting).

### B. Separate admin app (rejected)

A standalone admin SPA with its own deployment. Provides the clearest
boundary but doubles the deployment, auth, and shell work for a handful of
screens that share the same data model. Premature at this stage — the admin
audience is 1–3 people.

### C. CLI / SQL scripts (rejected)

Acceptable for bootstrapping (we did it once) but not sustainable. No audit
trail, no input validation, no invitation flow, and every onboarding
requires a developer.

## How It Works

### Data Model

No new tables are needed for organizations, clinics, users, or memberships
— `0001_core_tenancy.sql` already defines them. What's new:

1. **RLS policies for platform admins.** The existing policies let members
   see their own orgs/clinics. Platform admins need SELECT/INSERT/UPDATE on
   `organization`, `clinic`, `app_user`, and `membership` for *all* rows,
   not just their own. New policies:

   ```sql
   -- organization
   CREATE POLICY org_admin_all ON app.organization FOR ALL
     USING (app.is_platform_admin())
     WITH CHECK (app.is_platform_admin());

   -- clinic
   CREATE POLICY clinic_admin_all ON app.clinic FOR ALL
     USING (app.is_platform_admin())
     WITH CHECK (app.is_platform_admin());

   -- app_user: platform admins can see and create any user
   CREATE POLICY user_admin_all ON app.app_user FOR ALL
     USING (app.is_platform_admin())
     WITH CHECK (app.is_platform_admin());

   -- membership: platform admins can manage any membership
   CREATE POLICY membership_admin_all ON app.membership FOR ALL
     USING (app.is_platform_admin())
     WITH CHECK (app.is_platform_admin());
   ```

2. **`app_user.status = 'invited'`** already exists. The auth hook in
   `auth.ts` currently sets new users to `'active'`. For admin-created
   users, the admin API will set status to `'invited'` after creation.
   The forced password change screen checks this status and flips it to
   `'active'` after the user sets a new password.

### API Routes — `POST/GET/PATCH` under `/v1/admin`

All routes are guarded: a middleware checks `is_platform_admin()` at the
router level and returns 403 if false. This sits inside the existing
`requireStaffSession` gate, so unauthenticated or no-MFA requests never
reach it.

#### Organizations

| Method | Path | Body / Query | Returns |
|--------|------|-------------|---------|
| `GET` | `/v1/admin/organizations` | `?status=active` | `{ organizations: [...] }` |
| `GET` | `/v1/admin/organizations/:id` | | `{ organization, clinics, admins }` |
| `POST` | `/v1/admin/organizations` | `{ name, region, default_locale }` | `{ organization }` |
| `PATCH` | `/v1/admin/organizations/:id` | `{ name?, status? }` | `{ organization }` |

#### Clinics

| Method | Path | Body / Query | Returns |
|--------|------|-------------|---------|
| `GET` | `/v1/admin/organizations/:orgId/clinics` | | `{ clinics: [...] }` |
| `POST` | `/v1/admin/organizations/:orgId/clinics` | `{ name, country_code, timezone }` | `{ clinic }` |
| `PATCH` | `/v1/admin/clinics/:id` | `{ name?, status?, timezone? }` | `{ clinic }` |

#### Users

| Method | Path | Body / Query | Returns |
|--------|------|-------------|---------|
| `GET` | `/v1/admin/users` | `?org_id=&clinic_id=&status=` | `{ users: [...] }` |
| `POST` | `/v1/admin/users` | `{ email, full_name, role, organization_id, clinic_id? }` | `{ user, membership }` |
| `PATCH` | `/v1/admin/users/:id` | `{ full_name?, status? }` | `{ user }` |
| `POST` | `/v1/admin/users/:id/resend-invite` | | `{ sent: true }` |

**User creation flow** (`POST /v1/admin/users`):

1. Generate a random 16-character temporary password (letters + digits +
   symbols, satisfying the 12-char minimum).
2. Create the auth identity via Better Auth's **internal adapter**
   (`context.internalAdapter.createUser` + password hash), **not**
   `auth.api.signUpEmail` — the sign-up endpoint creates a session cookie
   for the new user, which would clobber the admin's session. The internal
   adapter creates the identity row without a session. The
   `databaseHooks.user.create.after` hook still fires and inserts the
   `app.app_user` row.
3. Immediately update `app.app_user` to set `status = 'invited'`.
4. Create the `membership` row (org, clinic, role).
5. Send the invitation email (see Email below).
6. Return the created user and membership (never the temp password in the
   response — it exists only in the email).

**Resend invitation** (`POST /v1/admin/users/:id/resend-invite`):

1. Generate a new temporary password.
2. Update the password hash in the auth schema via the internal adapter.
   This does not invalidate existing sessions (if the user somehow signed
   in but didn't change their password, the new temp password replaces the
   old one).
3. Resend the invitation email.

**Admin route DB pattern:** All admin routes use the existing `withUser()`
helper, running under RLS as `emb_app`. The new platform-admin RLS
policies (migration below) grant full access to platform admins. The
service pool (`servicePool`) is used only by framework-level hooks
(`databaseHooks`), never by route handlers.

**Bootstrapping:** The first platform admin is created by hand with SQL
(already done in production). This is a one-time operation — the spec does
not add a seed migration or bootstrap script for it.

### Email — Invitation via Gmail SMTP

`nodemailer` sends through Gmail SMTP using an app password. Configuration:

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=emazebrain@gmail.com
SMTP_PASS=<app-password>   # stored only in Railway env vars
```

The email module lives at `apps/api/src/email.ts` — a thin wrapper around
`nodemailer.createTransport`. It exposes:

```ts
sendInvitation(to: string, name: string, tempPassword: string, loginUrl: string): Promise<void>
```

The email body is a simple HTML template (plain text fallback) containing:

- Greeting with the user's name
- "You've been invited to eMazeBrain"
- The temporary password
- A link to the sign-in page
- Instructions to change the password on first login

**No patient data in the email.** The email mentions no clinic name, no
organization name, and no role — just the platform name and the credentials.

If email sending fails, the user creation still succeeds (the user and
membership are committed). The API returns `{ user, membership, email_sent: false }` so the admin knows to resend. The
`POST /v1/admin/users/:id/resend-invite` endpoint regenerates the temp
password, updates the auth record, and resends.

### Forced Password Change

**When:** After a successful sign-in, if `app_user.status = 'invited'`.

**Where:** A new route `/change-password` shown between sign-in/MFA and
the main app. The `RequireStaff` component in `App.tsx` already gates
access; we add a check: after `/v1/me` succeeds, if the user's status is
`'invited'`, redirect to `/change-password` instead of the shell.

The `/change-password` page:

1. Shows a "Welcome — please set a new password" message (i18n).
2. Accepts a new password (min 12 chars, confirmed).
3. Calls Better Auth's password change endpoint.
4. Calls `PATCH /v1/me/status` (a new thin endpoint) to flip
   `app_user.status` from `'invited'` to `'active'`.
5. Redirects to `/today`.

This check happens on every load of `RequireStaff`, so an invited user
can't navigate around it.

### Web UI — Admin Screens

New routes under `/admin`, visible only when `me.is_platform_admin`:

| Route | Page | Purpose |
|-------|------|---------|
| `/admin/organizations` | OrganizationsPage | List all orgs with status badges |
| `/admin/organizations/new` | OrgFormPage | Create organization |
| `/admin/organizations/:id` | OrgDetailPage | Org detail: clinics list, admin users |
| `/admin/organizations/:id/edit` | OrgFormPage | Edit organization |
| `/admin/organizations/:orgId/clinics/new` | ClinicFormPage | Create clinic under org |
| `/admin/clinics/:id` | ClinicDetailPage | Clinic detail: users list |
| `/admin/clinics/:id/edit` | ClinicFormPage | Edit clinic |
| `/admin/users/new` | UserFormPage | Create user (org/clinic/role picker) |

**Navigation:** The admin section gets a nav group in the rail, after the
existing Videos link (both are `is_platform_admin`-gated). Items:

- Organizations (Building2 icon)
- Videos (Film icon — already exists, moves into the group)

**Shared components:**

- Status badges: active/suspended/closed/inactive/invited, each a
  `<Chip>` with appropriate tone.
- Confirmation dialogs for status changes (suspend org, deactivate
  clinic, disable user).

**Forms follow existing patterns:** `@emb/ui` form fields, Zod validation
on submit, RTL-safe layout with logical properties.

### Integration with Existing Auth Flow

The sign-in flow already goes:

1. Email + password → Better Auth session cookie
2. TOTP verify → `twoFactorEnabled` becomes true
3. `requireStaffSession` lets `/v1/me` through
4. `RequireStaff` renders the shell

We insert a step between 3 and 4:

3.5. If `app_user.status = 'invited'` → redirect to `/change-password`

The status check requires a small addition to the `/v1/me` response:
include `user_status` (the `app_user.status` value) on every response.
Today the response has `is_platform_admin` but not the user's own status.
Always returning it keeps the contract simple — it's one field, and other
clients (e.g. the offline bundle) can use it too.

**Self-status update policy:** A new narrow RLS policy allows a user to
UPDATE only their own `app_user.status`, and only the transition
`'invited' → 'active'`. This prevents users from changing their own
status to bypass a disable. The policy:

```sql
CREATE POLICY user_self_activate ON app.app_user FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id() AND status = 'active');
```

Combined with the endpoint's own validation (only allows the
`invited → active` transition), this is sufficiently narrow.

### i18n Keys

All new UI strings go through the ICU message system. New namespace
`admin.*` for the admin screens, `auth.changePassword.*` for the forced
password change. Both `en` and `he` translations required from day one.

## Left to the Builder

- Exact email HTML template styling (keep it simple, inline CSS, mobile-
  friendly).
- Temporary password generation function (use `crypto.randomBytes` with
  base62 encoding or similar).
- Whether to add pagination to the organizations/users list endpoints
  (start without; add when list sizes warrant it).
- Timezone picker component: a `<SelectField>` with IANA timezone names,
  filtered by the organization's region.
- Country code picker: a `<SelectField>` with ISO 3166-1 alpha-2 codes.
