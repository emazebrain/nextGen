/**
 * Admin API — platform admins manage organizations, clinics, and users.
 *
 * Every handler runs through withUser() so RLS is active. The
 * platform-admin RLS policies (0019) grant full access to platform admins.
 * A requireAdmin middleware at the router level rejects non-admins early.
 */
import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";
import type { Auth } from "../../auth.ts";
import type { Mailer } from "../../email.ts";
import { generateTempPassword } from "../../email.ts";
import {
  createOrgSchema,
  patchOrgSchema,
  createClinicSchema,
  createUserSchema,
} from "./schemas.ts";

export function adminRoutes(pool: pg.Pool, auth: Auth, mailer: Mailer) {
  const r = new Hono<Env>();

  // ── Middleware: reject non-platform-admins ───────────────────────────
  r.use("*", async (c, next) => {
    const user = c.get("user");
    const isAdmin = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query<{ a: boolean }>(
        `SELECT app.is_platform_admin() AS a`,
      );
      return rows[0]!.a;
    });
    if (!isAdmin) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  // ── Organizations ───────────────────────────────────────────────────

  r.get("/organizations", async (c) => {
    const user = c.get("user");
    const orgs = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT id, name, region, default_locale, status, created_at
           FROM app.organization ORDER BY name`,
      );
      return rows;
    });
    return c.json({ organizations: orgs });
  });

  r.post("/organizations", async (c) => {
    const body = createOrgSchema.parse(await c.req.json());
    const user = c.get("user");
    const org = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `INSERT INTO app.organization (id, name, region, default_locale)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING id, name, region, default_locale, status, created_at`,
        [body.name, body.region, body.default_locale],
      );
      return rows[0];
    });
    return c.json({ organization: org }, 201);
  });

  r.patch("/organizations/:id", async (c) => {
    const id = c.req.param("id");
    const body = patchOrgSchema.parse(await c.req.json());
    const user = c.get("user");

    const sets: string[] = [];
    const vals: unknown[] = [];
    let idx = 1;
    if (body.name !== undefined) { sets.push(`name = $${idx++}`); vals.push(body.name); }
    if (body.status !== undefined) { sets.push(`status = $${idx++}`); vals.push(body.status); }
    if (body.default_locale !== undefined) { sets.push(`default_locale = $${idx++}`); vals.push(body.default_locale); }
    if (sets.length === 0) return c.json({ error: "no fields to update" }, 400);
    vals.push(id);

    const org = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `UPDATE app.organization SET ${sets.join(", ")} WHERE id = $${idx}
         RETURNING id, name, region, default_locale, status, created_at`,
        vals,
      );
      return rows[0];
    });
    if (!org) return c.json({ error: "not_found" }, 404);
    return c.json({ organization: org });
  });

  // ── Clinics ─────────────────────────────────────────────────────────

  r.post("/organizations/:orgId/clinics", async (c) => {
    const orgId = c.req.param("orgId");
    const body = createClinicSchema.parse(await c.req.json());
    const user = c.get("user");
    const clinic = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
         VALUES (gen_random_uuid(), $1, $2, $3, $4)
         RETURNING id, organization_id, name, country_code, timezone, status, created_at`,
        [orgId, body.name, body.country_code, body.timezone],
      );
      return rows[0];
    });
    return c.json({ clinic }, 201);
  });

  // ── Users ───────────────────────────────────────────────────────────

  r.post("/users", async (c) => {
    const body = createUserSchema.parse(await c.req.json());
    const user = c.get("user");

    // 1. Generate temp password and hash it via Better Auth internals
    const tempPassword = generateTempPassword();
    const ctx = await auth.$context;
    const hashedPassword = await ctx.password.hash(tempPassword);

    // 2. Create auth user (fires databaseHook → app_user with status='active')
    const authUser = await ctx.internalAdapter.createUser({
      email: body.email,
      name: body.full_name,
      emailVerified: false,
    }, { method: "admin" });
    if (!authUser) return c.json({ error: "user_creation_failed" }, 500);

    // 3. Link credential account
    await ctx.internalAdapter.linkAccount({
      userId: authUser.id,
      providerId: "credential",
      accountId: authUser.id,
      password: hashedPassword,
    });

    // 4. Set status to 'invited' (hook set it to 'active')
    // 5. Insert membership
    const result = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      await db.query(
        `UPDATE app.app_user SET status = 'invited' WHERE id = $1`,
        [authUser.id],
      );
      const { rows } = await db.query(
        `INSERT INTO app.membership (user_id, organization_id, clinic_id, role)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id, organization_id, clinic_id, role, status`,
        [authUser.id, body.organization_id, body.clinic_id ?? null, body.role],
      );
      const appUser = await db.query(
        `SELECT id, email, full_name, status FROM app.app_user WHERE id = $1`,
        [authUser.id],
      );
      return { membership: rows[0], appUser: appUser.rows[0] };
    });

    // 6. Send invitation email (non-blocking)
    let emailSent = false;
    try {
      emailSent = await mailer.sendInvitation(
        body.email,
        body.full_name,
        tempPassword,
        `${c.req.header("origin") ?? "https://app.emazebrain.com"}/login`,
      );
    } catch {
      // Email failure is not fatal
    }

    return c.json(
      { user: result.appUser, membership: result.membership, email_sent: emailSent },
      201,
    );
  });

  r.post("/users/:id/resend-invite", async (c) => {
    const userId = c.req.param("id");
    const user = c.get("user");

    // Check user is in 'invited' status
    const status = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query<{ status: string; email: string; full_name: string }>(
        `SELECT status, email, full_name FROM app.app_user WHERE id = $1`,
        [userId],
      );
      return rows[0];
    });

    if (!status) return c.json({ error: "user_not_found" }, 404);
    if (status.status !== "invited") {
      return c.json({ error: "user_not_invited", current_status: status.status }, 409);
    }

    // Generate new temp password and update via Better Auth
    const tempPassword = generateTempPassword();
    const ctx = await auth.$context;
    const hashedPassword = await ctx.password.hash(tempPassword);
    await ctx.internalAdapter.updatePassword(userId, hashedPassword);

    // Send email
    let sent = false;
    try {
      sent = await mailer.sendInvitation(
        status.email,
        status.full_name,
        tempPassword,
        `${c.req.header("origin") ?? "https://app.emazebrain.com"}/login`,
      );
    } catch {
      // non-fatal
    }

    return c.json({ sent });
  });

  return r;
}
