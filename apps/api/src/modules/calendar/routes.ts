/**
 * Calendar API (design doc §5.13).
 * Day/range view of planned sessions, reschedule, iCal export.
 *
 * Visibility follows role:
 *  - Therapist: own patients (via care_team, enforced by RLS)
 *  - Clinic manager / org admin: all patients in the clinic, filterable by therapist
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { z } from "zod";
import { withUser, type Env } from "../../context.ts";
import { parseBody } from "../../validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

export interface CalendarSession {
  id: string;
  planned_date: string;
  planned_time: string | null;
  seq: number;
  week: number;
  location: string;
  status: string;
  patient_id: string;
  patient_given_name: string;
  patient_family_name: string;
  assignment_id: string;
  assignment_name: string;
  therapist_id: string;
  therapist_name: string;
}

const rescheduleSchema = z.object({
  planned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  planned_time: z.string().regex(/^\d{2}:\d{2}$/).nullable().optional(),
  shift_subsequent: z.boolean().optional(),
});

export function calendarRoutes(pool: pg.Pool) {
  const app = new Hono<Env>();

  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);

  /**
   * GET /sessions — planned sessions for a date range.
   * Query params:
   *   clinic (required) — which clinic
   *   from, to — date range (defaults to today)
   *   therapist — filter by therapist (care_team user_id)
   *   status — filter by status (default: planned,in_progress)
   */
  app.get("/sessions", async (c) => {
    const clinicId = c.req.query("clinic");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const therapistId = c.req.query("therapist");
    const statusFilter = c.req.query("status");

    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);
    if (from && !DATE_RE.test(from)) return c.json({ error: "invalid_from" }, 400);
    if (to && !DATE_RE.test(to)) return c.json({ error: "invalid_to" }, 400);
    if (therapistId && !UUID_RE.test(therapistId)) return c.json({ error: "invalid_therapist" }, 400);

    const statuses = statusFilter
      ? statusFilter.split(",").filter((s) => ["planned", "in_progress", "done", "missed", "skipped", "cancelled"].includes(s))
      : ["planned", "in_progress"];

    const sessions = await run(c, async (db) => {
      const params: unknown[] = [clinicId];
      const conditions = [`ps.clinic_id = $1`];

      // Date range
      if (from) {
        params.push(from);
        conditions.push(`ps.planned_date >= $${params.length}::date`);
      } else {
        conditions.push(`ps.planned_date >= current_date`);
      }
      if (to) {
        params.push(to);
        conditions.push(`ps.planned_date <= $${params.length}::date`);
      } else if (!from) {
        conditions.push(`ps.planned_date <= current_date`);
      }

      // Status filter
      params.push(statuses);
      conditions.push(`ps.status = ANY($${params.length}::text[])`);

      // Therapist filter: only show sessions where this therapist is on the care team
      if (therapistId) {
        params.push(therapistId);
        conditions.push(`EXISTS (SELECT 1 FROM app.patient_care_team ct WHERE ct.patient_id = ps.patient_id AND ct.user_id = $${params.length} AND ct.ended_at IS NULL)`);
      }

      const { rows } = await db.query<CalendarSession>(
        `SELECT ps.id,
                to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date,
                ps.planned_time::text AS planned_time,
                ps.seq, ps.week, ps.location, ps.status,
                p.id AS patient_id, p.given_name AS patient_given_name, p.family_name AS patient_family_name,
                a.id AS assignment_id, a.name AS assignment_name,
                COALESCE(ct.user_id, '00000000-0000-0000-0000-000000000000'::uuid) AS therapist_id,
                COALESCE(u.full_name, '') AS therapist_name
           FROM app.planned_session ps
           JOIN app.patient p ON p.id = ps.patient_id AND p.deleted_at IS NULL
           JOIN app.protocol_assignment a ON a.id = ps.assignment_id
           LEFT JOIN LATERAL (
             SELECT ct2.user_id FROM app.patient_care_team ct2
              WHERE ct2.patient_id = ps.patient_id AND ct2.role = 'primary' AND ct2.ended_at IS NULL
              LIMIT 1
           ) ct ON true
           LEFT JOIN app.app_user u ON u.id = ct.user_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY ps.planned_date, ps.planned_time NULLS LAST, p.family_name, p.given_name`,
        params,
      );
      return rows;
    });

    return c.json({ sessions });
  });

  /**
   * GET /therapists — list therapists in a clinic (for the filter dropdown).
   */
  app.get("/therapists", async (c) => {
    const clinicId = c.req.query("clinic");
    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);

    const therapists = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT DISTINCT u.id, u.full_name
           FROM app.membership m
           JOIN app.app_user u ON u.id = m.user_id
          WHERE m.clinic_id = $1 AND m.role IN ('therapist', 'clinic_manager') AND m.status = 'active'
          ORDER BY u.full_name`,
        [clinicId],
      );
      return rows;
    });

    return c.json({ therapists });
  });

  /**
   * PATCH /sessions/:id — reschedule a session.
   * Optionally shifts all subsequent sessions in the same assignment by the same delta.
   */
  app.patch("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return notFound(c);

    const body = await parseBody(c, rescheduleSchema);
    if (!body.ok) return body.response;
    const { planned_date, planned_time, shift_subsequent } = body.data;

    const result = await run(c, async (db) => {
      // Load the current session
      const { rows } = await db.query(
        `SELECT ps.id, ps.planned_date, ps.assignment_id, ps.seq, ps.clinic_id,
                app.can_treat_patient(ps.patient_id) AS can_treat
           FROM app.planned_session ps
          WHERE ps.id = $1 AND ps.status IN ('planned', 'in_progress')`,
        [id],
      );
      if (!rows[0]) return { error: "not_found" as const };
      if (!rows[0].can_treat) return { error: "forbidden" as const };

      const session = rows[0];
      const oldDate = session.planned_date as Date;
      const newDate = new Date(planned_date + "T00:00:00Z");
      const daysDelta = Math.round((newDate.getTime() - oldDate.getTime()) / (24 * 60 * 60 * 1000));

      // Update this session
      await db.query(
        `UPDATE app.planned_session SET planned_date = $2::date, planned_time = $3::time WHERE id = $1`,
        [id, planned_date, planned_time ?? null],
      );

      // Shift subsequent sessions if requested
      let shifted = 0;
      if (shift_subsequent && daysDelta !== 0) {
        const { rowCount } = await db.query(
          `UPDATE app.planned_session
              SET planned_date = planned_date + $3::int * INTERVAL '1 day'
            WHERE assignment_id = $1 AND seq > $2 AND status IN ('planned', 'in_progress')`,
          [session.assignment_id, session.seq, daysDelta],
        );
        shifted = rowCount ?? 0;
      }

      return { ok: true, shifted };
    });

    if ("error" in result) {
      if (result.error === "not_found") return notFound(c);
      return c.json({ error: result.error }, 403);
    }
    return c.json(result);
  });

  /**
   * GET /export.ics — iCal export for a date range.
   * No patient data in event titles (CLAUDE.md rule 7): "Session – N."
   */
  app.get("/export.ics", async (c) => {
    const clinicId = c.req.query("clinic");
    const from = c.req.query("from");
    const to = c.req.query("to");

    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);

    const sessions = await run(c, async (db) => {
      const params: unknown[] = [clinicId];
      let dateFilter = "ps.planned_date >= current_date AND ps.planned_date <= current_date + 90";
      if (from && DATE_RE.test(from)) {
        params.push(from);
        dateFilter = `ps.planned_date >= $${params.length}::date`;
        if (to && DATE_RE.test(to)) {
          params.push(to);
          dateFilter += ` AND ps.planned_date <= $${params.length}::date`;
        } else {
          dateFilter += ` AND ps.planned_date <= $${params.length}::date + 90`;
        }
      }

      const { rows } = await db.query(
        `SELECT ps.id, to_char(ps.planned_date, 'YYYYMMDD') AS date_compact,
                ps.planned_time, ps.seq, ps.location
           FROM app.planned_session ps
          WHERE ps.clinic_id = $1 AND ps.status IN ('planned', 'in_progress')
            AND ${dateFilter}
          ORDER BY ps.planned_date, ps.planned_time NULLS LAST`,
        params,
      );
      return rows;
    });

    // Build iCal
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//eMazeBrain//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const s of sessions) {
      const timeStr = s.planned_time
        ? `${s.date_compact}T${String(s.planned_time).replace(/:/g, "")}00`
        : `${s.date_compact}`;
      const isAllDay = !s.planned_time;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${s.id}@emb`);
      if (isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${s.date_compact}`);
      } else {
        lines.push(`DTSTART:${timeStr}`);
        // 1-hour default duration
        const hour = parseInt(String(s.planned_time).slice(0, 2), 10);
        const endHour = String(hour + 1).padStart(2, "0");
        lines.push(`DTEND:${s.date_compact}T${endHour}${String(s.planned_time).slice(3).replace(/:/g, "")}00`);
      }
      // No patient data in titles (CLAUDE.md rule 7)
      lines.push(`SUMMARY:Session – ${s.seq}.`);
      lines.push(`LOCATION:${s.location === "home" ? "Home" : "Clinic"}`);
      lines.push("END:VEVENT");
    }

    lines.push("END:VCALENDAR");

    return new Response(lines.join("\r\n"), {
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": "attachment; filename=emb-calendar.ics",
      },
    });
  });

  return app;
}
