/**
 * Public parent portal endpoints — unauthenticated, token-based.
 * Mounted OUTSIDE /v1 (no auth middleware).
 *
 * GET  /parent-portal/:token — validate token and return guardian info for registration
 * POST /parent-portal/:token — create the parent account
 */
import { Hono } from "hono";
import type pg from "pg";
import type { Auth } from "../../auth.ts";
import { uuidv7 } from "../../ids.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicEnv = { Variables: { requestId: string } };

/** Run in a transaction as emb_app with the given user_id. */
async function withServiceUser<T>(
  pool: pg.Pool,
  userId: string,
  requestId: string,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE emb_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [userId, requestId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function publicParentPortalRoutes(pool: pg.Pool, auth: Auth) {
  const app = new Hono<PublicEnv>();

  /**
   * GET /parent-portal/:token — look up a portal invite by token.
   * Returns the guardian's name and email so the registration form can be pre-filled.
   */
  app.get("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID.test(token)) return c.json({ error: "invalid_token" }, 400);

    const client = await pool.connect();
    try {
      const { rows } = await client.query(
        `SELECT pi.id, pi.guardian_id, pi.status,
                g.full_name, g.email, g.phone, g.preferred_locale, g.user_id,
                cl.name AS clinic_name
           FROM app.portal_invite pi
           JOIN app.guardian g ON g.id = pi.guardian_id
           JOIN app.clinic cl ON cl.id = pi.clinic_id
          WHERE pi.token = $1`,
        [token],
      );

      if (!rows[0]) return c.json({ error: "not_found" }, 404);
      const invite = rows[0];

      if (invite.status === "accepted") return c.json({ error: "already_accepted" }, 410);
      if (invite.status === "cancelled") return c.json({ error: "cancelled" }, 410);
      if (invite.user_id) return c.json({ error: "already_registered" }, 410);

      return c.json({
        guardian_name: invite.full_name,
        guardian_email: invite.email,
        clinic_name: invite.clinic_name,
        preferred_locale: invite.preferred_locale,
      });
    } finally {
      client.release();
    }
  });

  /**
   * POST /parent-portal/:token — register a parent account.
   * Creates a Better Auth user with kind='guardian', links it to the guardian record,
   * and marks the invite as accepted.
   */
  app.post("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID.test(token)) return c.json({ error: "invalid_token" }, 400);

    const body = await c.req.json<{ password: string }>();
    if (!body.password || body.password.length < 12) {
      return c.json({ error: "password_too_short", message: "Password must be at least 12 characters" }, 400);
    }

    const client = await pool.connect();
    try {
      // Look up the invite
      const { rows } = await client.query(
        `SELECT pi.id, pi.guardian_id, pi.created_by, pi.clinic_id,
                g.full_name, g.email, g.user_id
           FROM app.portal_invite pi
           JOIN app.guardian g ON g.id = pi.guardian_id
          WHERE pi.token = $1 AND pi.status = 'pending'`,
        [token],
      );

      if (!rows[0]) return c.json({ error: "not_found" }, 404);
      const invite = rows[0];

      if (invite.user_id) return c.json({ error: "already_registered" }, 410);
      if (!invite.email) return c.json({ error: "no_email", message: "Guardian must have an email address" }, 400);

      // Create the auth user via Better Auth's internal API
      const userId = uuidv7();
      const authUser = await auth.api.signUpEmail({
        body: {
          email: invite.email,
          password: body.password,
          name: invite.full_name,
        },
      });

      if (!authUser || !authUser.user) {
        return c.json({ error: "registration_failed" }, 500);
      }

      // Link to guardian and mark invite accepted (service connection — no RLS)
      await withServiceUser(pool, invite.created_by, c.get("requestId"), async (db) => {
        // Update the app_user kind to guardian
        await db.query(`UPDATE app.app_user SET kind = 'guardian' WHERE id = $1`, [authUser.user.id]);

        // Link guardian → user
        await db.query(`UPDATE app.guardian SET user_id = $1 WHERE id = $2`, [authUser.user.id, invite.guardian_id]);

        // Mark invite as accepted
        await db.query(`UPDATE app.portal_invite SET status = 'accepted', accepted_at = now() WHERE id = $1`, [invite.id]);
      });

      return c.json({ ok: true, user_id: authUser.user.id }, 201);
    } finally {
      client.release();
    }
  });

  return app;
}
