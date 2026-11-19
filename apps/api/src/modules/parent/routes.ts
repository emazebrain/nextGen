/**
 * Parent portal API (design doc §5.10).
 * Routes under /v1/parent/* — authenticated as a guardian user (no MFA).
 * RLS ensures guardians see only their linked children.
 */
import { Hono } from "hono";
import type pg from "pg";
import { withUser, type Env } from "../../context.ts";

export function parentRoutes(pool: pg.Pool) {
  const app = new Hono<Env>();

  const run = <T>(c: import("hono").Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);

  /**
   * GET /v1/parent/me — the parent's profile and linked children.
   * Returns the guardian record(s) for this user and their children.
   */
  app.get("/me", async (c) => {
    const data = await run(c, async (db) => {
      const userId = c.get("user").id;

      // Get the user's guardian records
      const { rows: guardians } = await db.query(
        `SELECT g.id, g.full_name, g.email, g.phone, g.preferred_locale, g.kid_mode_pin_hash IS NOT NULL AS has_pin
           FROM app.guardian g
          WHERE g.user_id = $1 AND g.deleted_at IS NULL`,
        [userId],
      );

      if (!guardians.length) return null;

      // Get all linked children across all guardian records
      const guardianIds = guardians.map((g) => g.id);
      const { rows: children } = await db.query(
        `SELECT p.id, p.given_name, p.family_name, p.date_of_birth, p.status, p.preferred_locale,
                gp.guardian_id, gp.relationship,
                cl.name AS clinic_name
           FROM app.guardian_patient gp
           JOIN app.patient p ON p.id = gp.patient_id AND p.deleted_at IS NULL
           JOIN app.clinic cl ON cl.id = p.clinic_id
          WHERE gp.guardian_id = ANY($1)
          ORDER BY p.given_name, p.family_name`,
        [guardianIds],
      );

      return {
        user: {
          id: userId,
          email: c.get("user").email,
          name: c.get("user").name,
        },
        guardians: guardians.map((g) => ({
          id: g.id,
          full_name: g.full_name,
          email: g.email,
          phone: g.phone,
          preferred_locale: g.preferred_locale,
          has_pin: g.has_pin,
        })),
        children: children.map((ch) => ({
          id: ch.id,
          given_name: ch.given_name,
          family_name: ch.family_name,
          date_of_birth: ch.date_of_birth,
          status: ch.status,
          preferred_locale: ch.preferred_locale,
          relationship: ch.relationship,
          clinic_name: ch.clinic_name,
        })),
      };
    });

    if (!data) return c.json({ error: "not_a_guardian" }, 403);
    return c.json(data);
  });

  /**
   * GET /v1/parent/children/:id/progress — progress for one child.
   * Shows approved progress data in plain language.
   */
  app.get("/children/:id/progress", async (c) => {
    const childId = c.req.param("id");

    const progress = await run(c, async (db) => {
      // Verify this guardian can see this child (RLS + explicit check)
      const { rows: linked } = await db.query(
        `SELECT 1 FROM app.guardian_patient gp
           JOIN app.guardian g ON g.id = gp.guardian_id
          WHERE gp.patient_id = $1 AND g.user_id = $2 AND g.deleted_at IS NULL`,
        [childId, c.get("user").id],
      );
      if (!linked.length) return null;

      // Get patient info
      const { rows: patients } = await db.query(
        `SELECT p.id, p.given_name, p.family_name, p.status
           FROM app.patient p
          WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [childId],
      );
      if (!patients[0]) return null;

      // Get completed sessions count and latest
      const { rows: sessionStats } = await db.query(
        `SELECT count(*)::int AS total_sessions,
                max(completed_at) AS last_session
           FROM app.session_result_raw
          WHERE patient_id = $1`,
        [childId],
      );

      // Get active protocol info
      const { rows: protocols } = await db.query(
        `SELECT pa.id, pt.title, pa.status, pa.started_at,
                (SELECT count(*)::int FROM app.planned_session ps WHERE ps.assignment_id = pa.id) AS total_sessions,
                (SELECT count(*)::int FROM app.planned_session ps WHERE ps.assignment_id = pa.id AND ps.status = 'completed') AS completed_sessions
           FROM app.protocol_assignment pa
           JOIN app.protocol_template pt ON pt.id = pa.template_id
          WHERE pa.patient_id = $1 AND pa.status IN ('active', 'paused')
          ORDER BY pa.started_at DESC`,
        [childId],
      );

      return {
        patient: patients[0],
        stats: {
          total_sessions: sessionStats[0]?.total_sessions ?? 0,
          last_session: sessionStats[0]?.last_session ?? null,
        },
        protocols: protocols.map((p) => ({
          id: p.id,
          title: p.title,
          status: p.status,
          started_at: p.started_at,
          total_sessions: p.total_sessions,
          completed_sessions: p.completed_sessions,
        })),
      };
    });

    if (!progress) return c.json({ error: "not_found" }, 404);
    return c.json(progress);
  });

  /**
   * PUT /v1/parent/pin — set or update the kid-mode PIN.
   */
  app.put("/pin", async (c) => {
    const body = await c.req.json<{ pin: string; guardian_id: string }>();
    if (!body.pin || !/^\d{4,6}$/.test(body.pin)) {
      return c.json({ error: "invalid_pin", message: "PIN must be 4–6 digits" }, 400);
    }

    await run(c, async (db) => {
      // Hash the PIN with pgcrypto
      await db.query(
        `UPDATE app.guardian SET kid_mode_pin_hash = crypt($1, gen_salt('bf'))
          WHERE id = $2 AND user_id = $3 AND deleted_at IS NULL`,
        [body.pin, body.guardian_id, c.get("user").id],
      );
    });

    return c.json({ ok: true });
  });

  /**
   * POST /v1/parent/data-request — request data export or deletion (§5.10).
   * Logs the request; actual fulfilment is manual (audit trail).
   */
  app.post("/data-request", async (c) => {
    const body = await c.req.json<{ type: "export" | "deletion"; child_id: string }>();
    if (!["export", "deletion"].includes(body.type)) {
      return c.json({ error: "invalid_type" }, 400);
    }

    await run(c, async (db) => {
      // Verify linkage
      const { rows: linked } = await db.query(
        `SELECT 1 FROM app.guardian_patient gp
           JOIN app.guardian g ON g.id = gp.guardian_id
          WHERE gp.patient_id = $1 AND g.user_id = $2 AND g.deleted_at IS NULL`,
        [body.child_id, c.get("user").id],
      );
      if (!linked.length) return c.json({ error: "not_found" }, 404);

      // Log to audit trail
      await db.query(
        `INSERT INTO app.audit_event (id, table_name, row_id, action, old_data, new_data)
         VALUES (app.uuidv7(), 'data_request', $1, $2, '{}'::jsonb, jsonb_build_object('type', $2, 'child_id', $1, 'requested_by', $3))`,
        [body.child_id, body.type, c.get("user").id],
      );
    });

    return c.json({ ok: true, message: body.type === "export" ? "Your data export request has been received. You will be contacted within 30 days." : "Your deletion request has been received. You will be contacted within 30 days." });
  });

  return app;
}
