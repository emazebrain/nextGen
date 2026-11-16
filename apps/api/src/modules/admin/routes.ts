/**
 * Admin API — platform admins manage organizations, clinics, and users
 * (system admin spec 2026-11-16).
 *
 * Every handler runs through withUser() so RLS is active. The
 * platform-admin RLS policies (0019) grant full access to platform admins.
 * A middleware at the router level rejects non-admins early.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import type { z } from "zod";
import { withUser, type Env } from "../../context.ts";
import type { Auth } from "../../auth.ts";
import type { Mailer } from "../../email.ts";
import { generateTempPassword } from "../../email.ts";
import { UUID } from "../patients/routes.ts";
import {
  createOrgSchema,
  patchOrgSchema,
  createClinicSchema,
  patchClinicSchema,
  createUserSchema,
  patchUserSchema,
  listUsersQuery,
  orgStatus,
} from "./schemas.ts";

const ORG_COLS = `id, name, region, default_locale, status, created_at`;
const CLINIC_COLS = `id, organization_id, name, country_code, timezone, status, created_at`;
const USER_COLS = `id, email, full_name, status, created_at`;

type C = Context<Env>;

/** The request body checked against a schema, or null when it doesn't fit (the caller answers 400). */
async function body<S extends z.ZodTypeAny>(c: C, schema: S): Promise<z.output<S> | null> {
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as z.output<S>) : null;
}

const invalid = (c: C) => c.json({ error: "invalid" }, 400);
const notFound = (c: C) => c.json({ error: "not_found" }, 404);
const isUnique = (err: unknown) => (err as { code?: string }).code === "23505";

/** Builds "col = $n" pairs for the fields that were sent. */
function setClause(fields: Record<string, unknown>): { sql: string; values: unknown[] } | null {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  return { sql: entries.map(([k], i) => `${k} = $${i + 1}`).join(", "), values: entries.map(([, v]) => v) };
}

export function adminRoutes(pool: pg.Pool, auth: Auth, mailer: Mailer, publicAppUrl?: string) {
  const r = new Hono<Env>();
  const run = <T>(c: C, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  // I4: use a configured URL, never the spoofable Origin header.
  const loginUrl = `${publicAppUrl ?? "https://app.emazebrain.com"}/sign-in`;

  // ── Middleware: reject non-platform-admins ───────────────────────────
  r.use("*", async (c, next) => {
    const isAdmin = await run(c, async (db) => {
      const { rows } = await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`);
      return rows[0]!.a;
    });
    if (!isAdmin) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  // ── Organizations ───────────────────────────────────────────────────

  r.get("/organizations", async (c) => {
    const status = c.req.query("status");
    if (status !== undefined && !orgStatus.safeParse(status).success) return invalid(c);
    const organizations = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT ${ORG_COLS} FROM app.organization
          WHERE deleted_at IS NULL AND ($1::text IS NULL OR status = $1)
          ORDER BY name`,
        [status ?? null],
      );
      return rows;
    });
    return c.json({ organizations });
  });

  r.get("/organizations/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const result = await run(c, async (db) => {
      const org = await db.query(`SELECT ${ORG_COLS} FROM app.organization WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!org.rows[0]) return null;
      const clinics = await db.query(`SELECT ${CLINIC_COLS} FROM app.clinic WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`, [id]);
      const admins = await db.query(
        `SELECT u.id, u.email, u.full_name, u.status, u.created_at
           FROM app.app_user u
          WHERE u.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM app.membership m
                         WHERE m.user_id = u.id AND m.organization_id = $1 AND m.role = 'org_admin' AND m.status <> 'revoked')
          ORDER BY u.full_name`,
        [id],
      );
      return { organization: org.rows[0], clinics: clinics.rows, admins: admins.rows };
    });
    if (!result) return notFound(c);
    return c.json(result);
  });

  r.post("/organizations", async (c) => {
    const input = await body(c, createOrgSchema);
    if (!input) return invalid(c);
    const organization = await run(c, async (db) => {
      const { rows } = await db.query(
        `INSERT INTO app.organization (id, name, region, default_locale)
         VALUES (gen_random_uuid(), $1, $2, $3)
         RETURNING ${ORG_COLS}`,
        [input.name, input.region, input.default_locale],
      );
      return rows[0];
    });
    return c.json({ organization }, 201);
  });

  r.patch("/organizations/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const input = await body(c, patchOrgSchema);
    const set = input && setClause({ name: input.name, status: input.status, default_locale: input.default_locale });
    if (!set) return invalid(c);
    const organization = await run(c, async (db) => {
      const { rows } = await db.query(
        `UPDATE app.organization SET ${set.sql} WHERE id = $${set.values.length + 1} AND deleted_at IS NULL RETURNING ${ORG_COLS}`,
        [...set.values, id],
      );
      return rows[0];
    });
    if (!organization) return notFound(c);
    return c.json({ organization });
  });

  // ── Clinics ─────────────────────────────────────────────────────────

  r.get("/organizations/:orgId/clinics", async (c) => {
    const orgId = c.req.param("orgId");
    if (!UUID.test(orgId)) return notFound(c);
    const clinics = await run(c, async (db) => {
      const { rows } = await db.query(`SELECT ${CLINIC_COLS} FROM app.clinic WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`, [orgId]);
      return rows;
    });
    return c.json({ clinics });
  });

  r.post("/organizations/:orgId/clinics", async (c) => {
    const orgId = c.req.param("orgId");
    if (!UUID.test(orgId)) return notFound(c);
    const input = await body(c, createClinicSchema);
    if (!input) return invalid(c);
    try {
      const clinic = await run(c, async (db) => {
        const org = await db.query(`SELECT 1 FROM app.organization WHERE id = $1 AND deleted_at IS NULL`, [orgId]);
        if (!org.rows[0]) return null;
        const { rows } = await db.query(
          `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           RETURNING ${CLINIC_COLS}`,
          [orgId, input.name, input.country_code, input.timezone],
        );
        return rows[0];
      });
      if (!clinic) return notFound(c);
      return c.json({ clinic }, 201);
    } catch (err) {
      if (isUnique(err)) return c.json({ error: "name_taken" }, 409);
      throw err;
    }
  });

  r.get("/clinics/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const clinic = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT c.id, c.organization_id, o.name AS organization_name, c.name, c.country_code, c.timezone, c.status, c.created_at
           FROM app.clinic c JOIN app.organization o ON o.id = c.organization_id
          WHERE c.id = $1 AND c.deleted_at IS NULL`,
        [id],
      );
      return rows[0];
    });
    if (!clinic) return notFound(c);
    return c.json({ clinic });
  });

  r.patch("/clinics/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const input = await body(c, patchClinicSchema);
    const set = input && setClause({ name: input.name, status: input.status, timezone: input.timezone });
    if (!set) return invalid(c);
    try {
      const clinic = await run(c, async (db) => {
        const { rows } = await db.query(
          `UPDATE app.clinic SET ${set.sql} WHERE id = $${set.values.length + 1} AND deleted_at IS NULL RETURNING ${CLINIC_COLS}`,
          [...set.values, id],
        );
        return rows[0];
      });
      if (!clinic) return notFound(c);
      return c.json({ clinic });
    } catch (err) {
      if (isUnique(err)) return c.json({ error: "name_taken" }, 409);
      throw err;
    }
  });

  // ── Users ───────────────────────────────────────────────────────────

  r.get("/users", async (c) => {
    const q = listUsersQuery.safeParse(c.req.query());
    if (!q.success) return invalid(c);
    const { org_id, clinic_id, status } = q.data;
    const users = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.full_name, u.status, u.created_at,
                COALESCE(json_agg(json_build_object('organization_id', m.organization_id, 'clinic_id', m.clinic_id, 'role', m.role)
                                  ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]') AS memberships
           FROM app.app_user u
           LEFT JOIN app.membership m ON m.user_id = u.id AND m.status <> 'revoked'
          WHERE u.deleted_at IS NULL AND u.kind = 'staff'
            AND ($3::text IS NULL OR u.status = $3)
            AND ($1::uuid IS NULL OR EXISTS (SELECT 1 FROM app.membership x WHERE x.user_id = u.id AND x.organization_id = $1 AND x.status <> 'revoked'))
            AND ($2::uuid IS NULL OR EXISTS (SELECT 1 FROM app.membership x WHERE x.user_id = u.id AND x.clinic_id = $2 AND x.status <> 'revoked'))
          GROUP BY u.id
          ORDER BY u.full_name, u.email
          LIMIT 500`,
        [org_id ?? null, clinic_id ?? null, status ?? null],
      );
      return rows;
    });
    return c.json({ users });
  });

  r.post("/users", async (c) => {
    const input = await body(c, createUserSchema);
    if (!input) return invalid(c);
    const clinicId = input.clinic_id ?? null;

    // Clinic-scoped roles need a clinic; org-wide roles must not have one.
    const ORG_WIDE_ROLES = ["org_admin", "platform_admin"];
    const isOrgWide = ORG_WIDE_ROLES.includes(input.role);
    if (!isOrgWide && !clinicId) return c.json({ error: "clinic_required" }, 400);
    if (isOrgWide && clinicId) return c.json({ error: "clinic_forbidden" }, 400);

    // Check everything that can be checked before an identity exists, so a refusal leaves nothing behind.
    const problem = await run(c, async (db) => {
      const org = await db.query(`SELECT 1 FROM app.organization WHERE id = $1 AND deleted_at IS NULL`, [input.organization_id]);
      if (!org.rows[0]) return "organization_not_found";
      if (clinicId) {
        const clinic = await db.query(`SELECT 1 FROM app.clinic WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`, [clinicId, input.organization_id]);
        if (!clinic.rows[0]) return "clinic_not_in_organization";
      }
      const taken = await db.query(`SELECT 1 FROM app.app_user WHERE lower(email) = $1 AND deleted_at IS NULL`, [input.email]);
      return taken.rows[0] ? "email_taken" : null;
    });
    if (problem === "email_taken") return c.json({ error: problem }, 409);
    if (problem) return c.json({ error: problem }, 400);

    const ctx = await auth.$context;
    if (await ctx.internalAdapter.findUserByEmail(input.email)) return c.json({ error: "email_taken" }, 409);

    // The identity is made through Better Auth's adapter, not the sign-up endpoint, which would sign the
    // new user in over the admin's session. Its hook mirrors the user into app.app_user as 'active'.
    const tempPassword = generateTempPassword();
    const hashedPassword = await ctx.password.hash(tempPassword);
    const authUser = await ctx.internalAdapter.createUser({ email: input.email, name: input.full_name, emailVerified: false }, { method: "admin" });

    let result: { user: unknown; membership: unknown };
    try {
      await ctx.internalAdapter.linkAccount({ userId: authUser.id, providerId: "credential", accountId: authUser.id, password: hashedPassword });
      result = await run(c, async (db) => {
        const appUser = await db.query(`UPDATE app.app_user SET status = 'invited' WHERE id = $1 RETURNING ${USER_COLS}`, [authUser.id]);
        const { rows } = await db.query(
          `INSERT INTO app.membership (user_id, organization_id, clinic_id, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, user_id, organization_id, clinic_id, role, status`,
          [authUser.id, input.organization_id, clinicId, input.role],
        );
        return { user: appUser.rows[0], membership: rows[0] };
      });
    } catch (err) {
      // Half a user is worse than none: free the email again, then report the failure.
      await run(c, (db) => db.query(`UPDATE app.app_user SET deleted_at = now(), status = 'disabled' WHERE id = $1`, [authUser.id])).catch(() => {});
      await ctx.internalAdapter.deleteUser(authUser.id).catch(() => {});
      throw err;
    }

    // The account exists whether or not the email goes out; the admin can resend it.
    const emailSent = await mailer.sendInvitation(input.email, input.full_name, tempPassword, loginUrl).catch(() => false);
    return c.json({ user: result.user, membership: result.membership, email_sent: emailSent }, 201);
  });

  r.patch("/users/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const input = await body(c, patchUserSchema);
    const set = input && setClause({ full_name: input.full_name, status: input.status });
    if (!input || !set) return invalid(c);
    // Locking yourself out is never what an admin means.
    if (input.status === "disabled" && id === c.get("user").id) return c.json({ error: "cannot_disable_self" }, 409);

    const outcome = await run(c, async (db): Promise<{ error: "not_found" | "user_invited" } | { error?: undefined; user: unknown }> => {
      const current = await db.query<{ status: string }>(`SELECT status FROM app.app_user WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [id]);
      if (!current.rows[0]) return { error: "not_found" };
      // Re-enabling is the only way to 'active' here; an invited user gets there by replacing their password.
      if (input.status === "active" && current.rows[0].status === "invited") return { error: "user_invited" };
      const { rows } = await db.query(`UPDATE app.app_user SET ${set.sql} WHERE id = $${set.values.length + 1} RETURNING ${USER_COLS}`, [...set.values, id]);
      return { user: rows[0] };
    });
    if (outcome.error === "not_found") return notFound(c);
    if (outcome.error) return c.json({ error: outcome.error }, 409);

    const ctx = await auth.$context;
    if (input.full_name !== undefined) await ctx.internalAdapter.updateUser(id, { name: input.full_name });
    // A disabled account's open sessions end now, not when they expire.
    if (input.status === "disabled") await ctx.internalAdapter.deleteUserSessions(id);
    return c.json({ user: outcome.user });
  });

  r.post("/users/:id/resend-invite", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "user_not_found" }, 404);
    const target = await run(c, async (db) => {
      const { rows } = await db.query<{ status: string; email: string; full_name: string }>(
        `SELECT status, email, full_name FROM app.app_user WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return rows[0];
    });
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (target.status !== "invited") return c.json({ error: "user_not_invited", current_status: target.status }, 409);

    // A fresh temporary password replaces the old one; the earlier email stops working.
    const tempPassword = generateTempPassword();
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(tempPassword));
    const sent = await mailer.sendInvitation(target.email, target.full_name, tempPassword, loginUrl).catch(() => false);
    return c.json({ sent });
  });

  return r;
}
