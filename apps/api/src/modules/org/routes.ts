/**
 * Org-admin API — org admins manage clinics, staff and patients within
 * their own organization.
 *
 * Every handler runs through withUser() so RLS (0024) is active.
 * A middleware at the router level rejects users who are not org_admins.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import type { z } from "zod";
import { withUser, type Env as BaseEnv } from "../../context.ts";

type Env = BaseEnv & { Variables: BaseEnv["Variables"] & { orgId: string } };
import type { Auth } from "../../auth.ts";
import type { Mailer } from "../../email.ts";
import { generateTempPassword } from "../../email.ts";
import { UUID } from "../patients/routes.ts";
import {
  createClinicSchema,
  patchClinicSchema,
  createStaffSchema,
  patchStaffSchema,
  listStaffQuery,
  listOrgPatientsQuery,
  createOrgPatientSchema,
} from "./schemas.ts";
import { uuidv7 } from "../../ids.ts";

const CLINIC_COLS = `id, organization_id, name, country_code, timezone, status, created_at`;
const USER_COLS = `id, email, full_name, status, created_at`;

type C = Context<Env>;

async function body<S extends z.ZodTypeAny>(c: C, schema: S): Promise<z.output<S> | null> {
  const raw: unknown = await c.req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  return parsed.success ? (parsed.data as z.output<S>) : null;
}

const invalid = (c: C) => c.json({ error: "invalid" }, 400);
const notFound = (c: C) => c.json({ error: "not_found" }, 404);
const isUnique = (err: unknown) => (err as { code?: string }).code === "23505";

function setClause(fields: Record<string, unknown>): { sql: string; values: unknown[] } | null {
  const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
  if (!entries.length) return null;
  return { sql: entries.map(([k], i) => `${k} = $${i + 1}`).join(", "), values: entries.map(([, v]) => v) };
}

/** Roles an org admin is allowed to assign. */
const ASSIGNABLE_ROLES = ["therapist", "assistant", "clinic_manager"] as const;

export function orgAdminRoutes(pool: pg.Pool, auth: Auth, mailer: Mailer, publicAppUrl?: string) {
  const r = new Hono<Env>();
  const run = <T>(c: C, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const loginUrl = `${publicAppUrl ?? "https://app.emazebrain.com"}/sign-in`;

  // ── Middleware: reject non-org-admins, resolve their org ────────────
  r.use("*", async (c, next) => {
    const org = await run(c, async (db) => {
      const { rows } = await db.query<{ organization_id: string }>(
        `SELECT organization_id FROM app.membership
          WHERE user_id = app.current_user_id() AND role = 'org_admin' AND status = 'active'
          LIMIT 1`,
      );
      return rows[0]?.organization_id ?? null;
    });
    if (!org) return c.json({ error: "forbidden" }, 403);
    c.set("orgId", org);
    await next();
  });

  // ── Organization info ──────────────────────────────────────────────

  r.get("/", async (c) => {
    const orgId = c.get("orgId");
    const result = await run(c, async (db) => {
      const org = await db.query(
        `SELECT id, name, region, default_locale, status, created_at FROM app.organization WHERE id = $1 AND deleted_at IS NULL`,
        [orgId],
      );
      if (!org.rows[0]) return null;
      const clinics = await db.query(
        `SELECT ${CLINIC_COLS} FROM app.clinic WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [orgId],
      );
      return { organization: org.rows[0], clinics: clinics.rows };
    });
    if (!result) return notFound(c);
    return c.json(result);
  });

  // ── Clinics ────────────────────────────────────────────────────────

  r.get("/clinics", async (c) => {
    const orgId = c.get("orgId");
    const clinics = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT ${CLINIC_COLS} FROM app.clinic WHERE organization_id = $1 AND deleted_at IS NULL ORDER BY name`,
        [orgId],
      );
      return rows;
    });
    return c.json({ clinics });
  });

  r.post("/clinics", async (c) => {
    const orgId = c.get("orgId");
    const input = await body(c, createClinicSchema);
    if (!input) return invalid(c);
    try {
      const clinic = await run(c, async (db) => {
        const { rows } = await db.query(
          `INSERT INTO app.clinic (id, organization_id, name, country_code, timezone)
           VALUES (gen_random_uuid(), $1, $2, $3, $4)
           RETURNING ${CLINIC_COLS}`,
          [orgId, input.name, input.country_code, input.timezone],
        );
        return rows[0];
      });
      return c.json({ clinic }, 201);
    } catch (err) {
      if (isUnique(err)) return c.json({ error: "name_taken" }, 409);
      throw err;
    }
  });

  r.get("/clinics/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const orgId = c.get("orgId");
    const result = await run(c, async (db) => {
      const { rows: clinicRows } = await db.query(
        `SELECT c.id, c.organization_id, c.name, c.country_code, c.timezone, c.status, c.created_at
           FROM app.clinic c
          WHERE c.id = $1 AND c.organization_id = $2 AND c.deleted_at IS NULL`,
        [id, orgId],
      );
      if (!clinicRows[0]) return null;
      const { rows: staffRows } = await db.query(
        `SELECT u.id, u.email, u.full_name, u.status, m.role, m.clinic_id
           FROM app.app_user u
           JOIN app.membership m ON m.user_id = u.id AND m.status <> 'revoked'
          WHERE m.clinic_id = $1 AND u.deleted_at IS NULL
          ORDER BY u.full_name`,
        [id],
      );
      return { clinic: clinicRows[0], staff: staffRows };
    });
    if (!result) return notFound(c);
    return c.json(result);
  });

  r.patch("/clinics/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const orgId = c.get("orgId");
    const input = await body(c, patchClinicSchema);
    const set = input && setClause({ name: input.name, status: input.status, timezone: input.timezone });
    if (!set) return invalid(c);
    try {
      const clinic = await run(c, async (db) => {
        const { rows } = await db.query(
          `UPDATE app.clinic SET ${set.sql}
            WHERE id = $${set.values.length + 1} AND organization_id = $${set.values.length + 2} AND deleted_at IS NULL
            RETURNING ${CLINIC_COLS}`,
          [...set.values, id, orgId],
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

  // ── Staff ──────────────────────────────────────────────────────────

  r.get("/staff", async (c) => {
    const orgId = c.get("orgId");
    const q = listStaffQuery.safeParse(c.req.query());
    if (!q.success) return invalid(c);
    const { clinic_id, status } = q.data;
    const staff = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT u.id, u.email, u.full_name, u.status, u.created_at,
                COALESCE(json_agg(json_build_object('clinic_id', m.clinic_id, 'role', m.role)
                                  ORDER BY m.created_at) FILTER (WHERE m.id IS NOT NULL), '[]') AS memberships
           FROM app.app_user u
           JOIN app.membership m ON m.user_id = u.id AND m.organization_id = $1 AND m.status <> 'revoked'
          WHERE u.deleted_at IS NULL AND u.kind = 'staff'
            AND ($2::text IS NULL OR u.status = $2)
            AND ($3::uuid IS NULL OR m.clinic_id = $3)
          GROUP BY u.id
          ORDER BY u.full_name, u.email
          LIMIT 500`,
        [orgId, status ?? null, clinic_id ?? null],
      );
      return rows;
    });
    return c.json({ staff });
  });

  r.post("/staff", async (c) => {
    const orgId = c.get("orgId");
    const input = await body(c, createStaffSchema);
    if (!input) return invalid(c);

    if (!ASSIGNABLE_ROLES.includes(input.role as (typeof ASSIGNABLE_ROLES)[number])) {
      return c.json({ error: "role_not_allowed" }, 403);
    }
    if (!input.clinic_id) return c.json({ error: "clinic_required" }, 400);

    const problem = await run(c, async (db) => {
      const clinic = await db.query(
        `SELECT 1 FROM app.clinic WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [input.clinic_id, orgId],
      );
      if (!clinic.rows[0]) return "clinic_not_in_organization";
      const taken = await db.query(
        `SELECT 1 FROM app.app_user WHERE lower(email) = $1 AND deleted_at IS NULL`,
        [input.email],
      );
      return taken.rows[0] ? "email_taken" : null;
    });
    if (problem === "email_taken") return c.json({ error: problem }, 409);
    if (problem) return c.json({ error: problem }, 400);

    const ctx = await auth.$context;
    if (await ctx.internalAdapter.findUserByEmail(input.email)) return c.json({ error: "email_taken" }, 409);

    const tempPassword = generateTempPassword();
    const hashedPassword = await ctx.password.hash(tempPassword);
    const authUser = await ctx.internalAdapter.createUser(
      { email: input.email, name: input.full_name, emailVerified: false },
      { method: "admin" },
    );

    let result: { user: unknown; membership: unknown };
    try {
      await ctx.internalAdapter.linkAccount({
        userId: authUser.id,
        providerId: "credential",
        accountId: authUser.id,
        password: hashedPassword,
      });
      result = await run(c, async (db) => {
        const appUser = await db.query(
          `UPDATE app.app_user SET status = 'invited' WHERE id = $1 RETURNING ${USER_COLS}`,
          [authUser.id],
        );
        const { rows } = await db.query(
          `INSERT INTO app.membership (user_id, organization_id, clinic_id, role)
           VALUES ($1, $2, $3, $4)
           RETURNING id, user_id, organization_id, clinic_id, role, status`,
          [authUser.id, orgId, input.clinic_id, input.role],
        );
        return { user: appUser.rows[0], membership: rows[0] };
      });
    } catch (err) {
      await run(c, (db) =>
        db.query(`UPDATE app.app_user SET deleted_at = now(), status = 'disabled' WHERE id = $1`, [authUser.id]),
      ).catch(() => {});
      await ctx.internalAdapter.deleteUser(authUser.id).catch(() => {});
      throw err;
    }

    const emailSent = await mailer.sendInvitation(input.email, input.full_name, tempPassword, loginUrl).catch(() => false);
    return c.json({ user: result.user, membership: result.membership, email_sent: emailSent }, 201);
  });

  r.patch("/staff/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const orgId = c.get("orgId");
    const input = await body(c, patchStaffSchema);
    const set = input && setClause({ full_name: input.full_name, status: input.status });
    if (!input || !set) return invalid(c);
    if (input.status === "disabled" && id === c.get("user").id) return c.json({ error: "cannot_disable_self" }, 409);

    // Verify the target belongs to this org.
    const outcome = await run(c, async (db): Promise<{ error: "not_found" | "user_invited" } | { error?: undefined; user: unknown }> => {
      const inOrg = await db.query(
        `SELECT 1 FROM app.membership WHERE user_id = $1 AND organization_id = $2 AND status <> 'revoked'`,
        [id, orgId],
      );
      if (!inOrg.rows[0]) return { error: "not_found" };
      const current = await db.query<{ status: string }>(
        `SELECT status FROM app.app_user WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
        [id],
      );
      if (!current.rows[0]) return { error: "not_found" };
      if (input.status === "active" && current.rows[0].status === "invited") return { error: "user_invited" };
      const { rows } = await db.query(
        `UPDATE app.app_user SET ${set.sql} WHERE id = $${set.values.length + 1} RETURNING ${USER_COLS}`,
        [...set.values, id],
      );
      return { user: rows[0] };
    });
    if (outcome.error === "not_found") return notFound(c);
    if (outcome.error) return c.json({ error: outcome.error }, 409);

    const ctx = await auth.$context;
    if (input.full_name !== undefined) await ctx.internalAdapter.updateUser(id, { name: input.full_name });
    if (input.status === "disabled") await ctx.internalAdapter.deleteUserSessions(id);
    return c.json({ user: outcome.user });
  });

  // ── Patients ────────────────────────────────────────────────────────

  r.get("/patients", async (c) => {
    const orgId = c.get("orgId");
    const q = listOrgPatientsQuery.safeParse(c.req.query());
    if (!q.success) return invalid(c);
    const { clinic_id, archived } = q.data;
    const patients = await run(c, async (db) => {
      // Verify clinic belongs to this org when filtering
      if (clinic_id) {
        const clinicCheck = await db.query(
          `SELECT 1 FROM app.clinic WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
          [clinic_id, orgId],
        );
        if (!clinicCheck.rows[0]) return [];
      }
      const { rows } = await db.query(
        `SELECT p.id, p.clinic_id, p.given_name, p.family_name,
                to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                p.status, p.alert IS NOT NULL AND p.alert <> '' AS has_alert,
                p.deleted_at IS NOT NULL AS archived,
                cl.name AS clinic_name
           FROM app.patient p
           JOIN app.clinic cl ON cl.id = p.clinic_id
          WHERE cl.organization_id = $1
            AND (p.deleted_at IS NOT NULL) = $2
            AND ($3::uuid IS NULL OR p.clinic_id = $3)
          ORDER BY p.family_name, p.given_name
          LIMIT 1000`,
        [orgId, archived === "1", clinic_id ?? null],
      );
      return rows;
    });
    return c.json({ patients });
  });

  r.post("/patients", async (c) => {
    const orgId = c.get("orgId");
    const input = await body(c, createOrgPatientSchema);
    if (!input) return invalid(c);

    const result = await run(c, async (db) => {
      // Verify clinic belongs to this org
      const clinicCheck = await db.query(
        `SELECT 1 FROM app.clinic WHERE id = $1 AND organization_id = $2 AND deleted_at IS NULL`,
        [input.clinic_id, orgId],
      );
      if (!clinicCheck.rows[0]) return { error: "clinic_not_in_organization" as const };

      // Verify therapist belongs to the same clinic (if provided)
      const therapistId = input.therapist_id ?? c.get("user").id;
      if (input.therapist_id) {
        const therapistCheck = await db.query(
          `SELECT 1 FROM app.membership
            WHERE user_id = $1 AND clinic_id = $2 AND status = 'active'
              AND role IN ('therapist', 'clinic_manager', 'org_admin')`,
          [input.therapist_id, input.clinic_id],
        );
        if (!therapistCheck.rows[0]) return { error: "therapist_not_in_clinic" as const };
      }

      // Duplicate check
      if (!input.allow_duplicate) {
        const dup = await db.query<{ d: boolean }>(
          `SELECT app.patient_duplicate_exists($1,$2,$3,$4) AS d`,
          [input.clinic_id, input.given_name, input.family_name, input.date_of_birth],
        );
        if (dup.rows[0]?.d) return { error: "possible_duplicate" as const };
      }

      const id = uuidv7();
      await db.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, preferred_locale, sex, handedness, alert, colour_vision_deficiency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, input.clinic_id, input.given_name, input.family_name, input.date_of_birth, input.preferred_locale,
         input.sex ?? null, input.handedness ?? null, input.alert || null, input.colour_vision_deficiency ?? false, c.get("user").id],
      );
      await db.query(
        `INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'primary')`,
        [id, therapistId],
      );
      return { id };
    });

    if ("error" in result) {
      if (result.error === "possible_duplicate") return c.json({ error: result.error }, 409);
      if (result.error === "clinic_not_in_organization") return c.json({ error: result.error }, 400);
      if (result.error === "therapist_not_in_clinic") return c.json({ error: result.error }, 400);
      return c.json({ error: result.error }, 400);
    }
    return c.json(result, 201);
  });

  r.post("/staff/:id/resend-invite", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "user_not_found" }, 404);
    const orgId = c.get("orgId");
    const target = await run(c, async (db) => {
      const inOrg = await db.query(
        `SELECT 1 FROM app.membership WHERE user_id = $1 AND organization_id = $2 AND status <> 'revoked'`,
        [id, orgId],
      );
      if (!inOrg.rows[0]) return null;
      const { rows } = await db.query<{ status: string; email: string; full_name: string }>(
        `SELECT status, email, full_name FROM app.app_user WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      return rows[0];
    });
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (target.status !== "invited") return c.json({ error: "user_not_invited", current_status: target.status }, 409);

    const tempPassword = generateTempPassword();
    const ctx = await auth.$context;
    await ctx.internalAdapter.updatePassword(id, await ctx.password.hash(tempPassword));
    const sent = await mailer.sendInvitation(target.email, target.full_name, tempPassword, loginUrl).catch(() => false);
    return c.json({ sent });
  });

  return r;
}
