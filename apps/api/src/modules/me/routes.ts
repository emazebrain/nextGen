import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";

/** GET /v1/me — the signed-in user and their active clinic memberships (§9.1 S1). */
export function meRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();

  r.get("/", async (c) => {
    const user = c.get("user");
    const result = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT m.clinic_id, m.organization_id, m.role, c.name AS clinic_name
           FROM app.membership m LEFT JOIN app.clinic c ON c.id = m.clinic_id
          WHERE m.user_id = app.current_user_id() AND m.status = 'active'
          ORDER BY c.name NULLS FIRST`,
      );
      const admin = await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`);
      const status = await db.query<{ status: string }>(
        `SELECT status FROM app.app_user WHERE id = app.current_user_id()`,
      );
      return { rows, isPlatformAdmin: admin.rows[0]!.a, userStatus: status.rows[0]?.status };
    });
    return c.json({
      user: { id: user.id, email: user.email, name: user.name },
      memberships: result.rows,
      is_platform_admin: result.isPlatformAdmin,
      user_status: result.userStatus,
    });
  });

  /** PATCH /v1/me/status — self-activate: invited → active only. */
  r.patch("/status", async (c) => {
    const user = c.get("user");
    const body = await c.req.json<{ status?: string }>();

    if (body.status !== "active") {
      return c.json({ error: "Only transition to 'active' is allowed" }, 400);
    }

    const result = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      // Check current status
      const current = await db.query<{ status: string }>(
        `SELECT status FROM app.app_user WHERE id = app.current_user_id()`,
      );
      const currentStatus = current.rows[0]?.status;
      if (currentStatus !== "invited") {
        return { ok: false, currentStatus };
      }
      // The user_self_activate RLS policy allows this UPDATE
      await db.query(
        `UPDATE app.app_user SET status = 'active' WHERE id = app.current_user_id()`,
      );
      return { ok: true };
    });

    if (!result.ok) {
      return c.json({ error: "User is not in 'invited' status" }, 409);
    }

    return c.json({ status: "active" });
  });

  return r;
}
