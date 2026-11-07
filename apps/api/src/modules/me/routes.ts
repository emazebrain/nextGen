import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";

/** GET /v1/me — the signed-in user and their active clinic memberships (§9.1 S1). */
export function meRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  r.get("/", async (c) => {
    const user = c.get("user");
    const memberships = await withUser(pool, user.id, c.get("requestId"), async (db) => {
      const { rows } = await db.query(
        `SELECT m.clinic_id, m.organization_id, m.role, c.name AS clinic_name
           FROM app.membership m LEFT JOIN app.clinic c ON c.id = m.clinic_id
          WHERE m.user_id = app.current_user_id() AND m.status = 'active'
          ORDER BY c.name NULLS FIRST`,
      );
      const admin = await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`);
      return { rows, isPlatformAdmin: admin.rows[0]!.a };
    });
    return c.json({ user: { id: user.id, email: user.email, name: user.name }, memberships: memberships.rows, is_platform_admin: memberships.isPlatformAdmin });
  });
  return r;
}
