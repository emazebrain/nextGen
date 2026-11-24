/**
 * Parent portal API (design doc §5.10).
 * Routes under /v1/parent/* — authenticated as a guardian user (no MFA).
 *
 * IMPORTANT: Parent routes use a SERVICE-LEVEL pool connection (no RLS).
 * Authorization is handled entirely in code by verifying guardian linkage.
 * This avoids the RLS recursion issues on Supabase where postgres has no
 * BYPASSRLS — guardian queries touch tables whose policies were designed
 * for staff users and recurse when evaluated for users with no memberships.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { randomInt } from "node:crypto";
import type { GameSessionView, LaunchPackage, LaunchStep } from "../../../../../packages/contracts/src/index.ts";
import { toneParamsForPatient } from "@emb/tones";
import { ageBand, resolveRegion, seededIndex } from "../../../../../packages/contracts/src/index.ts";
import type { Env } from "../../context.ts";
import type { TicketSigner } from "../../tickets.ts";
import { paramsHash } from "../../tickets.ts";
import { buildParams, type StepRow } from "../sessions/routes.ts";
import { pick } from "../videos/routes.ts";
import { loadRegionCatalog } from "../../regions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOME_TICKET_TTL_S = 7 * 24 * 3600;

/**
 * Run a callback with a plain pool connection (NO RLS, no SET LOCAL ROLE).
 * Authorization is verified in code before every query.
 */
async function withService<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

/** Verify this user is a guardian linked to this child. */
async function isLinkedGuardian(db: pg.PoolClient, childId: string, userId: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT 1 FROM app.guardian_patient gp
       JOIN app.guardian g ON g.id = gp.guardian_id
      WHERE gp.patient_id = $1 AND g.user_id = $2 AND g.deleted_at IS NULL`,
    [childId, userId],
  );
  return rows.length > 0;
}

/** Get all guardian IDs for this user. Returns empty array if not a guardian. */
async function getGuardianIds(db: pg.PoolClient, userId: string): Promise<string[]> {
  const { rows } = await db.query<{ id: string }>(
    `SELECT g.id FROM app.guardian g WHERE g.user_id = $1 AND g.deleted_at IS NULL`,
    [userId],
  );
  return rows.map((r) => r.id);
}

export function parentRoutes(servicePool: pg.Pool, tickets?: TicketSigner) {
  const app = new Hono<Env>();

  /**
   * GET /v1/parent/me — the parent's profile and linked children.
   */
  app.get("/me", async (c) => {
    const userId = c.get("user").id;

    const data = await withService(servicePool, async (db) => {
      const { rows: guardians } = await db.query(
        `SELECT g.id, g.full_name, g.email, g.phone, g.preferred_locale, g.kid_mode_pin_hash IS NOT NULL AS has_pin
           FROM app.guardian g
          WHERE g.user_id = $1 AND g.deleted_at IS NULL`,
        [userId],
      );

      if (!guardians.length) return null;

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
        user: { id: userId, email: c.get("user").email, name: c.get("user").name },
        guardians: guardians.map((g) => ({
          id: g.id, full_name: g.full_name, email: g.email, phone: g.phone,
          preferred_locale: g.preferred_locale, has_pin: g.has_pin,
        })),
        children: children.map((ch) => ({
          id: ch.id, given_name: ch.given_name, family_name: ch.family_name,
          date_of_birth: ch.date_of_birth, status: ch.status,
          preferred_locale: ch.preferred_locale, relationship: ch.relationship,
          clinic_name: ch.clinic_name,
        })),
      };
    });

    if (!data) return c.json({ error: "not_a_guardian" }, 403);
    return c.json(data);
  });

  /**
   * GET /v1/parent/children/:id/progress — progress for one child.
   */
  app.get("/children/:id/progress", async (c) => {
    const childId = c.req.param("id");
    const userId = c.get("user").id;

    const progress = await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, childId, userId))) return null;

      const { rows: patients } = await db.query(
        `SELECT p.id, p.given_name, p.family_name, p.status FROM app.patient p WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [childId],
      );
      if (!patients[0]) return null;

      const { rows: sessionStats } = await db.query(
        `SELECT count(*)::int AS total_sessions, max(completed_at) AS last_session FROM app.session_result_raw WHERE patient_id = $1`,
        [childId],
      );

      const { rows: protocols } = await db.query(
        `SELECT pa.id, pt.title, pa.status, pa.started_at,
                (SELECT count(*)::int FROM app.planned_session ps WHERE ps.assignment_id = pa.id) AS total_sessions,
                (SELECT count(*)::int FROM app.planned_session ps WHERE ps.assignment_id = pa.id AND ps.status = 'done') AS completed_sessions
           FROM app.protocol_assignment pa
           JOIN app.protocol_template pt ON pt.id = pa.template_id
          WHERE pa.patient_id = $1 AND pa.status IN ('active', 'paused')
          ORDER BY pa.started_at DESC`,
        [childId],
      );

      return {
        patient: patients[0],
        stats: { total_sessions: sessionStats[0]?.total_sessions ?? 0, last_session: sessionStats[0]?.last_session ?? null },
        protocols: protocols.map((p) => ({ id: p.id, title: p.title, status: p.status, started_at: p.started_at, total_sessions: p.total_sessions, completed_sessions: p.completed_sessions })),
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

    await withService(servicePool, async (db) => {
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
   */
  app.post("/data-request", async (c) => {
    const body = await c.req.json<{ type: "export" | "deletion"; child_id: string }>();
    if (!["export", "deletion"].includes(body.type)) return c.json({ error: "invalid_type" }, 400);

    await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, body.child_id, c.get("user").id))) {
        return c.json({ error: "not_found" }, 404);
      }
      await db.query(
        `INSERT INTO app.audit_event (id, table_name, row_id, action, old_data, new_data)
         VALUES (gen_random_uuid(), 'data_request', $1, $2, '{}'::jsonb, jsonb_build_object('type', $2, 'child_id', $1, 'requested_by', $3))`,
        [body.child_id, body.type, c.get("user").id],
      );
    });

    return c.json({ ok: true, message: body.type === "export" ? "Your data export request has been received. You will be contacted within 30 days." : "Your deletion request has been received. You will be contacted within 30 days." });
  });

  /**
   * GET /v1/parent/children/:id/sessions — home sessions for one child.
   */
  app.get("/children/:id/sessions", async (c) => {
    const childId = c.req.param("id");
    if (!UUID.test(childId)) return c.json({ error: "not_found" }, 404);

    const data = await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, childId, c.get("user").id))) return null;

      const { rows: upcoming } = await db.query(
        `SELECT ps.id, ps.seq, ps.week, ps.status, to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date,
                ps.location, a.id AS assignment_id, a.name AS assignment_name, a.status AS assignment_status,
                (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status <> 'cancelled') AS total,
                (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status = 'done') AS completed
           FROM app.planned_session ps
           JOIN app.protocol_assignment a ON a.id = ps.assignment_id
          WHERE ps.patient_id = $1 AND ps.location = 'home'
            AND ps.status IN ('planned', 'in_progress')
            AND a.status = 'active'
          ORDER BY ps.planned_date, ps.seq`,
        [childId],
      );

      const { rows: recent } = await db.query(
        `SELECT ps.id, ps.seq, ps.week, ps.status, to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date,
                ps.location, ps.completed_at, a.id AS assignment_id, a.name AS assignment_name
           FROM app.planned_session ps
           JOIN app.protocol_assignment a ON a.id = ps.assignment_id
          WHERE ps.patient_id = $1 AND ps.location = 'home' AND ps.status = 'done'
          ORDER BY ps.completed_at DESC LIMIT 10`,
        [childId],
      );

      return { upcoming, recent };
    });

    if (!data) return c.json({ error: "not_found" }, 404);
    return c.json(data);
  });

  /**
   * GET /v1/parent/children/:id/appointments — the coming appointments the clinic set for one child.
   *
   * Read-only, and only for a guardian linked to that child (checked in code, as on every parent route). A guardian
   * gets when, how long, the title and the clinic; never the staff's notes, who booked it, or cancelled entries.
   * There is no parent route that creates or changes an appointment.
   */
  app.get("/children/:id/appointments", async (c) => {
    const childId = c.req.param("id");
    if (!UUID.test(childId)) return c.json({ error: "not_found" }, 404);

    const appointments = await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, childId, c.get("user").id))) return null;
      const { rows } = await db.query(
        `SELECT ap.id, to_char(ap.date, 'YYYY-MM-DD') AS date,
                to_char(ap.start_time, 'HH24:MI') AS start_time, to_char(ap.end_time, 'HH24:MI') AS end_time,
                ap.title, cl.name AS clinic_name
           FROM app.appointment ap
           JOIN app.patient p ON p.id = ap.patient_id AND p.deleted_at IS NULL
           JOIN app.clinic cl ON cl.id = ap.clinic_id
          WHERE ap.patient_id = $1 AND ap.status = 'scheduled' AND ap.date >= CURRENT_DATE
          ORDER BY ap.date, ap.start_time
          LIMIT 100`,
        [childId],
      );
      return rows;
    });

    if (!appointments) return c.json({ error: "not_found" }, 404);
    return c.json({ appointments });
  });

  /**
   * POST /v1/parent/children/:id/sessions/:sessionId/launch — launch a home session.
   */
  app.post("/children/:id/sessions/:sessionId/launch", async (c) => {
    if (!tickets) return c.json({ error: "not_configured" }, 500);
    const childId = c.req.param("id");
    const sessionId = c.req.param("sessionId");
    if (!UUID.test(childId) || !UUID.test(sessionId)) return c.json({ error: "not_found" }, 404);
    const me = c.get("user").id;

    const result = await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, childId, me))) return { error: "forbidden" as const };

      const { rows } = await db.query(
        `SELECT ps.id, ps.seq, ps.week, ps.status, ps.location, to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date,
                a.id AS assignment_id, a.name AS assignment_name, a.status AS assignment_status,
                (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status <> 'cancelled') AS total,
                p.id AS patient_id, p.given_name, p.family_name, p.preferred_locale, p.alert, p.colour_vision_deficiency,
                to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth, p.tone_age_group, p.tones_enabled
           FROM app.planned_session ps
           JOIN app.protocol_assignment a ON a.id = ps.assignment_id
           JOIN app.patient p ON p.id = ps.patient_id
          WHERE ps.id = $1 AND ps.patient_id = $2`,
        [sessionId, childId],
      );
      const row = rows[0];
      if (!row) return { error: "not_found" as const };
      if (row.location !== "home") return { error: "not_home_session" as const };
      if (row.assignment_status !== "active") return { error: "protocol_not_active" as const };
      if (row.status !== "planned" && row.status !== "in_progress") return { error: "session_closed" as const };

      const steps = await db.query<StepRow & { done: boolean }>(
        `SELECT s.id, s.ordinal, s.step_type, s.video_id, s.game_id, s.session_mode, s.duration_s, s.lives, s.lives_auto,
                s.current_difficulty, s.hemisphere, s.timer_position, s.monochrome, s.practice, s.trial_window_ms,
                s.game_params, s.sessions_completed, s.progression, s.region_id, s.tones_enabled,
                CASE WHEN s.step_type = 'video'
                     THEN EXISTS (SELECT 1 FROM app.video_view w WHERE w.planned_session_id = $2 AND w.assignment_step_id = s.id)
                     ELSE EXISTS (SELECT 1 FROM app.game_session g WHERE g.planned_session_id = $2 AND g.assignment_step_id = s.id) END AS done
           FROM app.assignment_step s WHERE s.assignment_id = $1 ORDER BY s.ordinal`,
        [row.assignment_id, sessionId],
      );

      const videoIds = steps.rows.filter((s) => s.step_type === "video").map((s) => s.video_id!);
      const videos = new Map<string, { id: string; version: number; source: "upload" | "youtube"; youtube_id: string | null; duration_s: number | null; titles: Record<string, string>; sha256: Buffer | null; has_file: boolean }>();
      if (videoIds.length) {
        const v = await db.query(
          `SELECT v.id, v.version, v.source, v.youtube_id, v.duration_s, f.sha256, v.file_id IS NOT NULL AS has_file,
                  COALESCE((SELECT jsonb_object_agg(i.locale, i.title) FROM app.video_i18n i WHERE i.video_id = v.id), '{}') AS titles
             FROM app.video v LEFT JOIN app.file_object f ON f.id = v.file_id WHERE v.id = ANY($1::uuid[])`,
          [videoIds],
        );
        for (const r of v.rows) videos.set(r.id, r);
      }

      const regions = steps.rows.some((s) => s.region_id) ? await loadRegionCatalog(db) : undefined;

      await db.query(`UPDATE app.planned_session SET status = 'in_progress' WHERE id = $1 AND status = 'planned'`, [sessionId]);

      const firstGameStep = steps.rows.find((s) => s.step_type !== "video");
      const sessionTones = row.tones_enabled && row.date_of_birth && firstGameStep
        ? toneParamsForPatient(row.date_of_birth, firstGameStep.hemisphere as "left" | "right", row.tone_age_group) ?? undefined
        : undefined;

      const pkg: LaunchPackage = {
        planned_session_id: sessionId,
        seq: row.seq, week: row.week, total: row.total,
        patient: { id: row.patient_id, given_name: row.given_name, family_name: row.family_name, preferred_locale: row.preferred_locale, alert: row.alert },
        assignment: { id: row.assignment_id, name: row.assignment_name },
        steps: steps.rows.map((s): LaunchStep => {
          if (s.step_type === "video") {
            const v = videos.get(s.video_id!)!;
            return {
              kind: "video", assignment_step_id: s.id, ordinal: s.ordinal,
              video: {
                id: v.id, version: v.version, source: v.source, youtube_id: v.youtube_id, duration_s: v.duration_s,
                title: pick(v.titles, row.preferred_locale) ?? "",
                file_url: v.source === "upload" && v.has_file ? `/v1/videos/${v.id}/file?v=${v.version}` : null,
                sha256: v.sha256 ? v.sha256.toString("hex") : null,
              },
              done: s.done,
            };
          }
          const params = buildParams(s, row, randomInt(1, 2 ** 31), regions);
          const ticket = tickets.sign({ jti: crypto.randomUUID(), psid: sessionId, asid: s.id, pid: row.patient_id, gid: s.game_id, ph: paramsHash(params), sub: me }, HOME_TICKET_TTL_S);
          return { kind: "game", assignment_step_id: s.id, ordinal: s.ordinal, game_id: s.game_id, params, ticket, done: s.done };
        }),
        ...(sessionTones ? { tones: sessionTones } : {}),
      };
      return pkg;
    });

    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : result.error === "not_home_session" ? 403 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ launch: result });
  });

  /**
   * GET /v1/parent/children/:id/history — full session history for one child.
   */
  app.get("/children/:id/history", async (c) => {
    const childId = c.req.param("id");
    if (!UUID.test(childId)) return c.json({ error: "not_found" }, 404);

    const sessions = await withService(servicePool, async (db) => {
      if (!(await isLinkedGuardian(db, childId, c.get("user").id))) return null;

      const { rows } = await db.query<GameSessionView>(
        `SELECT g.id, g.game_id, g.status, g.session_mode, g.difficulty, g.hemisphere, g.started_at, g.ended_at, g.active_ms,
                g.accuracy::float8 AS accuracy, g.rt_median_ms, g.trials_total, g.correct, g.errors, g.lives_lost, g.highest_level,
                g.planned_session_id, ps.seq, g.metrics, COALESCE((g.config_echo->>'monochrome')::boolean, false) AS monochrome,
                CASE WHEN g.config_echo ? 'region' THEN jsonb_build_object('path', g.config_echo->'region'->'path', 'sublobe', g.config_echo->'region'->'sublobe',
                  'drawn', g.config_echo->'region'->'drawn', 'revision', g.config_echo->'region'->'revision') END AS region,
                r.counts, CASE WHEN r.review_reason IS NULL THEN NULL ELSE json_build_object('reason', r.review_reason, 'decision', r.decision) END AS review,
                a.id AS assignment_id, a.name AS assignment_name
           FROM app.game_session g LEFT JOIN app.planned_session ps ON ps.id = g.planned_session_id
           LEFT JOIN app.protocol_assignment a ON a.id = ps.assignment_id
           JOIN app.game_session_review r ON r.id = g.id
          WHERE g.patient_id = $1 AND g.is_valid
          ORDER BY g.ended_at DESC LIMIT 500`,
        [childId],
      );
      return rows;
    });

    if (!sessions) return c.json({ error: "not_found" }, 404);
    return c.json({ sessions });
  });

  return app;
}
