/**
 * Calendar API (design doc §5.13).
 * Returns a unified view of planned sessions + appointments.
 * Supports creating ad-hoc appointments and rescheduling sessions.
 *
 * Visibility follows role:
 *  - Therapist: own patients (via care_team, enforced by RLS)
 *  - Clinic manager / org admin: all in the clinic, filterable by therapist
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { z } from "zod";
import { withUser, type Env } from "../../context.ts";
import { uuidv7 } from "../../ids.ts";
import { parseBody } from "../../validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

const APPOINTMENT_COLORS = ["blue", "green", "purple", "orange", "red", "teal", "pink", "yellow"] as const;

const createAppointmentSchema = z.object({
  patient_id: z.string().uuid(),
  title: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  start_time: z.string().regex(/^\d{2}:\d{2}$/),
  end_time: z.string().regex(/^\d{2}:\d{2}$/),
  color: z.enum(APPOINTMENT_COLORS).optional(),
});

const updateAppointmentSchema = z.object({
  title: z.string().trim().max(255).optional(),
  notes: z.string().trim().max(2000).optional(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  start_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  end_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]).optional(),
  color: z.enum(APPOINTMENT_COLORS).optional(),
});

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
   * GET /events — unified calendar events (sessions + appointments) for a date range.
   * Returns both types with a `kind` discriminator.
   */
  app.get("/events", async (c) => {
    const clinicId = c.req.query("clinic");
    const from = c.req.query("from");
    const to = c.req.query("to");
    const therapistId = c.req.query("therapist");

    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);
    if (from && !DATE_RE.test(from)) return c.json({ error: "invalid_from" }, 400);
    if (to && !DATE_RE.test(to)) return c.json({ error: "invalid_to" }, 400);

    const events = await run(c, async (db) => {
      const params: unknown[] = [clinicId, from ?? null, to ?? null];
      const therapistCond = therapistId && UUID_RE.test(therapistId)
        ? (params.push(therapistId), `AND EXISTS (SELECT 1 FROM app.patient_care_team ct WHERE ct.patient_id = sub.patient_id AND ct.user_id = $${params.length} AND ct.ended_at IS NULL)`)
        : "";

      // Protocol sessions — planned_time column may not exist yet (migration 0027)
      const hasTimeCol = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'planned_session' AND column_name = 'planned_time'`,
      ).then((r) => r.rowCount! > 0);
      const timeExpr = hasTimeCol ? "ps.planned_time::text" : "NULL::text";

      const { rows: sessions } = await db.query(
        `SELECT 'session' AS kind, ps.id,
                to_char(ps.planned_date, 'YYYY-MM-DD') AS date,
                ${timeExpr} AS start_time,
                NULL::text AS end_time,
                ps.seq, ps.week, ps.location, ps.status,
                p.id AS patient_id, p.given_name AS patient_given_name, p.family_name AS patient_family_name,
                a.id AS assignment_id, a.name AS assignment_name,
                '' AS title, '' AS notes,
                COALESCE(ct.user_id::text, '') AS therapist_id,
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
          WHERE ps.clinic_id = $1
            AND ps.status IN ('planned', 'in_progress')
            AND ps.planned_date >= COALESCE($2::date, current_date - 7)
            AND ps.planned_date <= COALESCE($3::date, current_date + 30)
            ${therapistCond.replace(/sub\.patient_id/g, "ps.patient_id")}`,
        params,
      );

      // Appointments — table may not exist yet (migration 0028)
      const hasApptTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'appointment'`,
      ).then((r) => r.rowCount! > 0);

      let appointments: typeof sessions = [];
      if (hasApptTable) {
        const hasColorCol = await db.query(
          `SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'appointment' AND column_name = 'color'`,
        ).then((r) => r.rowCount! > 0);
        const colorExpr = hasColorCol ? "ap.color" : "'blue'";

        const apptParams: unknown[] = [clinicId, from ?? null, to ?? null];
        const apptTherapistCond = therapistId && UUID_RE.test(therapistId)
          ? (apptParams.push(therapistId), `AND ap.created_by = $${apptParams.length}`)
          : "";

        const r = await db.query(
          `SELECT 'appointment' AS kind, ap.id,
                  to_char(ap.date, 'YYYY-MM-DD') AS date,
                  ap.start_time::text AS start_time,
                  ap.end_time::text AS end_time,
                  0 AS seq, 0 AS week, 'clinic' AS location, ap.status,
                  p.id AS patient_id, p.given_name AS patient_given_name, p.family_name AS patient_family_name,
                  '' AS assignment_id, '' AS assignment_name,
                  ap.title, ap.notes,
                  ap.created_by::text AS therapist_id,
                  COALESCE(u.full_name, '') AS therapist_name,
                  ${colorExpr} AS color
             FROM app.appointment ap
             JOIN app.patient p ON p.id = ap.patient_id AND p.deleted_at IS NULL
             LEFT JOIN app.app_user u ON u.id = ap.created_by
            WHERE ap.clinic_id = $1
              AND ap.status = 'scheduled'
              AND ap.date >= COALESCE($2::date, current_date - 7)
              AND ap.date <= COALESCE($3::date, current_date + 30)
              ${apptTherapistCond}`,
          apptParams,
        );
        appointments = r.rows;
      }

      // Merge and sort
      const all = [...sessions, ...appointments].sort((a, b) => {
        const dateComp = a.date.localeCompare(b.date);
        if (dateComp !== 0) return dateComp;
        const aTime = a.start_time ?? "99:99";
        const bTime = b.start_time ?? "99:99";
        return aTime.localeCompare(bTime);
      });

      return all;
    });

    return c.json({ events });
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
   * POST /appointments — create an ad-hoc appointment.
   */
  app.post("/appointments", async (c) => {
    const body = await parseBody(c, createAppointmentSchema);
    if (!body.ok) return body.response;
    const { patient_id, title, notes, date, start_time, end_time } = body.data;

    if (start_time >= end_time) return c.json({ error: "invalid_time_range" }, 400);

    const result = await run(c, async (db) => {
      // Check if appointment table exists (migration 0028)
      const hasTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'appointment'`,
      ).then((r) => r.rowCount! > 0);
      if (!hasTable) return { error: "not_available" as const };

      // Verify patient exists and get clinic
      const { rows } = await db.query(
        `SELECT clinic_id FROM app.patient WHERE id = $1 AND deleted_at IS NULL`,
        [patient_id],
      );
      if (!rows[0]) return { error: "not_found" as const };

      const id = uuidv7();
      await db.query(
        `INSERT INTO app.appointment (id, clinic_id, patient_id, created_by, title, notes, date, start_time, end_time, color)
         VALUES ($1, $2, $3, app.current_user_id(), $4, $5, $6::date, $7::time, $8::time, $9)`,
        [id, rows[0].clinic_id, patient_id, title ?? "", notes ?? "", date, start_time, end_time, body.data.color ?? "blue"],
      );
      return { id };
    });

    if ("error" in result) {
      if (result.error === "not_available") return c.json({ error: "not_available", message: "Appointments feature is being deployed. Try again in a few minutes." }, 503);
      return notFound(c);
    }
    return c.json(result, 201);
  });

  /**
   * PATCH /appointments/:id — update an appointment.
   */
  app.patch("/appointments/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return notFound(c);

    const body = await parseBody(c, updateAppointmentSchema);
    if (!body.ok) return body.response;
    const data = body.data;

    const result = await run(c, async (db) => {
      const hasTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'appointment'`,
      ).then((r) => r.rowCount! > 0);
      if (!hasTable) return { error: "not_available" as const };

      const sets: string[] = [];
      const vals: unknown[] = [id];
      if (data.title !== undefined) { vals.push(data.title); sets.push(`title = $${vals.length}`); }
      if (data.notes !== undefined) { vals.push(data.notes); sets.push(`notes = $${vals.length}`); }
      if (data.date !== undefined) { vals.push(data.date); sets.push(`date = $${vals.length}::date`); }
      if (data.start_time !== undefined) { vals.push(data.start_time); sets.push(`start_time = $${vals.length}::time`); }
      if (data.end_time !== undefined) { vals.push(data.end_time); sets.push(`end_time = $${vals.length}::time`); }
      if (data.status !== undefined) { vals.push(data.status); sets.push(`status = $${vals.length}`); }
      if (data.color !== undefined) { vals.push(data.color); sets.push(`color = $${vals.length}`); }
      if (!sets.length) return { ok: true };

      const { rowCount } = await db.query(
        `UPDATE app.appointment SET ${sets.join(", ")} WHERE id = $1`,
        vals,
      );
      return rowCount ? { ok: true } : { error: "not_found" as const };
    });

    if ("error" in result) {
      if (result.error === "not_available") return c.json({ error: "not_available", message: "Appointments feature is being deployed." }, 503);
      return notFound(c);
    }
    return c.json(result);
  });

  /**
   * PATCH /sessions/:id — reschedule a protocol session.
   */
  app.patch("/sessions/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID_RE.test(id)) return notFound(c);

    const body = await parseBody(c, rescheduleSchema);
    if (!body.ok) return body.response;
    const { planned_date, planned_time, shift_subsequent } = body.data;

    const result = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT ps.id, ps.planned_date, ps.assignment_id, ps.seq,
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

      // planned_time column may not exist yet (migration 0027)
      const hasTime = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'planned_session' AND column_name = 'planned_time'`,
      ).then((r) => r.rowCount! > 0);

      if (hasTime) {
        await db.query(
          `UPDATE app.planned_session SET planned_date = $2::date, planned_time = $3::time WHERE id = $1`,
          [id, planned_date, planned_time ?? null],
        );
      } else {
        await db.query(
          `UPDATE app.planned_session SET planned_date = $2::date WHERE id = $1`,
          [id, planned_date],
        );
      }

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
   * GET /patients — search patients for appointment creation.
   */
  app.get("/patients", async (c) => {
    const clinicId = c.req.query("clinic");
    const q = c.req.query("q");
    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);

    const patients = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.given_name, p.family_name
           FROM app.patient p
          WHERE p.clinic_id = $1 AND p.deleted_at IS NULL AND p.status = 'active'
            AND ($2::text IS NULL OR p.given_name ILIKE '%' || $2 || '%' OR p.family_name ILIKE '%' || $2 || '%')
          ORDER BY p.family_name, p.given_name
          LIMIT 20`,
        [clinicId, q || null],
      );
      return rows;
    });

    return c.json({ patients });
  });

  /**
   * GET /export.ics — iCal export. No patient data in titles (CLAUDE.md rule 7).
   */
  app.get("/export.ics", async (c) => {
    const clinicId = c.req.query("clinic");
    const from = c.req.query("from");
    const to = c.req.query("to");

    if (!clinicId || !UUID_RE.test(clinicId)) return c.json({ error: "clinic_required" }, 400);

    const items = await run(c, async (db) => {
      const params: unknown[] = [clinicId];
      let dateFilter = "sub.d >= current_date AND sub.d <= current_date + 90";
      if (from && DATE_RE.test(from)) {
        params.push(from);
        dateFilter = `sub.d >= $${params.length}::date`;
        if (to && DATE_RE.test(to)) {
          params.push(to);
          dateFilter += ` AND sub.d <= $${params.length}::date`;
        } else {
          dateFilter += ` AND sub.d <= $${params.length}::date + 90`;
        }
      }

      // Check which features are available
      const hasTimeCol = await db.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema = 'app' AND table_name = 'planned_session' AND column_name = 'planned_time'`,
      ).then((r) => r.rowCount! > 0);
      const hasApptTable = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = 'app' AND table_name = 'appointment'`,
      ).then((r) => r.rowCount! > 0);

      const stExpr = hasTimeCol ? "ps.planned_time" : "NULL::time";
      const parts = [
        `SELECT ps.id, ps.planned_date AS d, ${stExpr} AS st, NULL::time AS et, ps.seq, ps.location, 'session' AS kind
           FROM app.planned_session ps WHERE ps.clinic_id = $1 AND ps.status IN ('planned', 'in_progress')`,
      ];
      if (hasApptTable) {
        parts.push(
          `SELECT ap.id, ap.date AS d, ap.start_time AS st, ap.end_time AS et, 0 AS seq, 'clinic' AS location, 'appointment' AS kind
             FROM app.appointment ap WHERE ap.clinic_id = $1 AND ap.status = 'scheduled'`,
        );
      }

      const { rows } = await db.query(
        `SELECT * FROM (${parts.join(" UNION ALL ")}) sub WHERE ${dateFilter} ORDER BY sub.d, sub.st NULLS LAST`,
        params,
      );
      return rows;
    });

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//eMazeBrain//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
    ];

    for (const s of items) {
      const dc = (s.d as Date).toISOString().slice(0, 10).replace(/-/g, "");
      const st = s.st ? String(s.st).replace(/:/g, "") : null;
      const et = s.et ? String(s.et).replace(/:/g, "") : null;

      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${s.id}@emb`);
      if (st) {
        lines.push(`DTSTART:${dc}T${st.padEnd(6, "0")}`);
        if (et) {
          lines.push(`DTEND:${dc}T${et.padEnd(6, "0")}`);
        } else {
          // Default 1h for sessions
          const h = parseInt(st.slice(0, 2), 10);
          lines.push(`DTEND:${dc}T${String(h + 1).padStart(2, "0")}${st.slice(2).padEnd(4, "0")}`);
        }
      } else {
        lines.push(`DTSTART;VALUE=DATE:${dc}`);
      }
      // No patient data (CLAUDE.md rule 7)
      lines.push(`SUMMARY:${s.kind === "appointment" ? "Appointment" : `Session – ${s.seq}.`}`);
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
