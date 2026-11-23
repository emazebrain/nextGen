/**
 * Reports dashboard, caseload first (reports dashboard design 2026-11-23, design doc §5.9.2).
 *
 * Three reads, all through withUser so RLS is in force, and all limited to patients the caller may treat
 * (app.can_treat_patient: a therapist's care team, a manager's clinic):
 *   GET /reports/caseload   one row per patient: recent scores against their own baseline, plan, reasons to look
 *   GET /reports/adherence  planned against done per rolling week, clinic and home apart
 *   GET /reports/overview   totals for the tiles
 *
 * Results that don't count (excluded, or awaiting review) stay out of scores and totals, as on Progress.
 * The maths lives in @emb/metrics (pure); this file only loads rows. Nothing here is logged.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { caseloadSummary, type DecisionInput, type GameInfo, type PlannedInput, type SessionInput } from "../../../../../packages/metrics/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { GAME_MANIFESTS } from "../../games.ts";
import { UUID } from "../patients/routes.ts";

const GAMES: GameInfo[] = Object.values(GAME_MANIFESTS).map((m) => ({ id: m.id, metrics: m.metrics }));

/** Enough history for a baseline and a trend without loading years of play. */
const SESSIONS_PER_PATIENT = 60;
const MAX_PATIENTS = 1000;

/** The caller's patients, optionally in one clinic. $1 = clinic or NULL. */
const MINE = `SELECT p.id, p.given_name, p.family_name FROM app.patient p
               WHERE p.deleted_at IS NULL AND app.can_treat_patient(p.id) AND ($1::uuid IS NULL OR p.clinic_id = $1::uuid)`;
/** Counted sessions of those patients. */
const COUNTED = `app.game_session g JOIN app.game_session_review r ON r.id = g.id JOIN mine ON mine.id = g.patient_id
                 WHERE g.is_valid AND r.counts IS NOT FALSE`;

type C = Context<Env>;

/** A whole number from the query string within [min, max], the default when absent, or null when it isn't one. */
function intParam(raw: string | undefined, fallback: number, min: number, max: number): number | null {
  if (raw === undefined) return fallback;
  if (!/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export function reportRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  const run = <T>(c: C, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const clinicOf = (c: C): string | null | undefined => {
    const clinic = c.req.query("clinic");
    return clinic === undefined ? null : UUID.test(clinic) ? clinic : undefined;
  };

  r.get("/reports/caseload", async (c) => {
    const clinic = clinicOf(c);
    if (clinic === undefined) return c.json({ error: "invalid_clinic" }, 400);

    const patients = await run(c, async (db) => {
      const clock = (await db.query<{ now: Date; today: string }>(`SELECT now() AS now, CURRENT_DATE::text AS today`)).rows[0]!;
      const mine = (await db.query<{ id: string; given_name: string; family_name: string }>(`${MINE} ORDER BY p.family_name, p.given_name LIMIT ${MAX_PATIENTS}`, [clinic])).rows;
      if (mine.length === 0) return [];

      const sessions = await db.query<SessionInput & { patient_id: string }>(
        `WITH mine AS (${MINE})
         SELECT * FROM (
           SELECT g.id, g.patient_id, g.game_id, g.ended_at, g.difficulty, g.accuracy::float8 AS accuracy, g.rt_median_ms, g.metrics, g.hemisphere, g.active_ms,
                  COALESCE((g.config_echo->>'monochrome')::boolean, false) AS monochrome,
                  row_number() OVER (PARTITION BY g.patient_id ORDER BY g.ended_at DESC) AS n
             FROM ${COUNTED}) x
          WHERE x.n <= ${SESSIONS_PER_PATIENT}`,
        [clinic],
      );
      const planned = await db.query<PlannedInput & { patient_id: string }>(
        `WITH mine AS (${MINE})
         SELECT ps.patient_id, ps.planned_date::text AS planned_date, ps.location, ps.status
           FROM app.planned_session ps JOIN mine ON mine.id = ps.patient_id
          WHERE ps.planned_date >= CURRENT_DATE - 8 AND ps.planned_date <= CURRENT_DATE`,
        [clinic],
      );
      const decisions = await db.query<DecisionInput & { patient_id: string }>(
        `WITH mine AS (${MINE})
         SELECT * FROM (
           SELECT d.patient_id, d.decided_at, d.action, row_number() OVER (PARTITION BY d.patient_id ORDER BY d.decided_at DESC, d.id DESC) AS n
             FROM app.progression_decision d JOIN mine ON mine.id = d.patient_id
            WHERE d.action IN ('up', 'down')) x
          WHERE x.n <= 2`,
        [clinic],
      );
      const pending = await db.query<{ patient_id: string; n: string }>(
        `WITH mine AS (${MINE})
         SELECT patient_id, count(*) AS n FROM (
           SELECT g.patient_id FROM app.game_session g JOIN app.game_session_review r ON r.id = g.id JOIN mine ON mine.id = g.patient_id
            WHERE g.is_valid AND r.review_reason IS NOT NULL AND r.decision IS NULL
           UNION ALL
           SELECT v.patient_id FROM app.video_view v JOIN app.video_view_review vr ON vr.id = v.id JOIN mine ON mine.id = v.patient_id
            WHERE vr.review_reason IS NOT NULL AND vr.decision IS NULL) x
          GROUP BY patient_id`,
        [clinic],
      );
      const active = await db.query<{ patient_id: string }>(
        `WITH mine AS (${MINE}) SELECT DISTINCT a.patient_id FROM app.protocol_assignment a JOIN mine ON mine.id = a.patient_id WHERE a.status = 'active'`,
        [clinic],
      );

      const group = <T extends { patient_id: string }>(rows: T[]) => {
        const by = new Map<string, T[]>();
        for (const row of rows) by.set(row.patient_id, [...(by.get(row.patient_id) ?? []), row]);
        return by;
      };
      const iso = (d: unknown) => (d instanceof Date ? d.toISOString() : String(d));
      const bySession = group(sessions.rows.map((s) => ({ ...s, ended_at: iso(s.ended_at) })));
      const byPlanned = group(planned.rows);
      const byDecision = group(decisions.rows.map((d) => ({ ...d, decided_at: iso(d.decided_at) })));
      const pendingBy = new Map(pending.rows.map((x) => [x.patient_id, Number(x.n)]));
      const activeSet = new Set(active.rows.map((x) => x.patient_id));

      return mine
        .map((p) => {
          const s = caseloadSummary(
            { sessions: bySession.get(p.id) ?? [], planned: byPlanned.get(p.id) ?? [], decisions: byDecision.get(p.id) ?? [], reviewPending: pendingBy.get(p.id) ?? 0, hasActiveAssignment: activeSet.has(p.id) },
            GAMES,
            clock.now,
            { today: clock.today },
          );
          return {
            patient_id: p.id,
            given_name: p.given_name,
            family_name: p.family_name,
            scores: s.scores,
            summary: s.summary,
            week: s.week,
            difficulty: s.difficulty,
            last_change: s.lastChange,
            last_session_at: s.lastSessionAt,
            reasons: s.reasons,
          };
        })
        // Most reasons first; the name order from the query breaks ties (the sort is stable).
        .sort((a, b) => b.reasons.length - a.reasons.length);
    });
    return c.json({ patients });
  });

  r.get("/reports/adherence", async (c) => {
    const clinic = clinicOf(c);
    if (clinic === undefined) return c.json({ error: "invalid_clinic" }, 400);
    const weeks = intParam(c.req.query("weeks"), 6, 1, 26);
    if (weeks === null) return c.json({ error: "invalid_weeks" }, 400);

    const rows = await run(c, async (db) => {
      // Rolling weeks that end today, so "this week" always holds seven days whatever day a week starts on locally.
      const { rows } = await db.query<{ week_start: string; planned: string; done_clinic: string; done_home: string }>(
        `WITH mine AS (${MINE}),
              w AS (SELECT n, CURRENT_DATE - (n * 7 + 6) AS week_start, CURRENT_DATE - (n * 7) AS week_end FROM generate_series(0, $2::int - 1) AS n)
         SELECT w.week_start::text AS week_start,
                count(ps.id) FILTER (WHERE ps.status NOT IN ('cancelled', 'skipped')) AS planned,
                count(ps.id) FILTER (WHERE ps.status = 'done' AND ps.location = 'clinic') AS done_clinic,
                count(ps.id) FILTER (WHERE ps.status = 'done' AND ps.location = 'home') AS done_home
           FROM w LEFT JOIN (SELECT ps.* FROM app.planned_session ps JOIN mine ON mine.id = ps.patient_id) ps
                  ON ps.planned_date BETWEEN w.week_start AND w.week_end
          GROUP BY w.n, w.week_start ORDER BY w.n DESC`,
        [clinic, weeks],
      );
      return rows;
    });
    return c.json({ weeks: rows.map((w) => ({ week_start: w.week_start, planned: Number(w.planned), done_clinic: Number(w.done_clinic), done_home: Number(w.done_home) })) });
  });

  r.get("/reports/overview", async (c) => {
    const clinic = clinicOf(c);
    if (clinic === undefined) return c.json({ error: "invalid_clinic" }, 400);
    const days = intParam(c.req.query("days"), 30, 1, 366);
    if (days === null) return c.json({ error: "invalid_days" }, 400);

    const out = await run(c, async (db) => {
      const totals = (
        await db.query<{ sessions: string; sessions_this_week: string; active_patients: string; avg_duration_ms: string | null; in_care: string; done: string; missed: string }>(
          `WITH mine AS (${MINE}),
                counted AS (SELECT g.patient_id, g.ended_at, g.active_ms FROM ${COUNTED} AND g.ended_at >= now() - make_interval(days => $2::int))
           SELECT (SELECT count(*) FROM counted) AS sessions,
                  (SELECT count(*) FROM counted WHERE ended_at >= now() - interval '7 days') AS sessions_this_week,
                  (SELECT count(DISTINCT patient_id) FROM counted) AS active_patients,
                  (SELECT round(avg(active_ms)) FROM counted) AS avg_duration_ms,
                  (SELECT count(*) FROM mine) AS in_care,
                  (SELECT count(*) FROM app.planned_session ps JOIN mine ON mine.id = ps.patient_id
                    WHERE ps.planned_date > CURRENT_DATE - $2::int AND ps.planned_date <= CURRENT_DATE AND ps.status = 'done') AS done,
                  (SELECT count(*) FROM app.planned_session ps JOIN mine ON mine.id = ps.patient_id
                    WHERE ps.planned_date > CURRENT_DATE - $2::int AND ps.planned_date <= CURRENT_DATE
                      AND (ps.status = 'missed' OR (ps.status = 'planned' AND ps.planned_date < CURRENT_DATE))) AS missed`,
          [clinic, days],
        )
      ).rows[0]!;
      const weekly = await db.query<{ week_start: string; sessions: string; avg_duration_ms: string | null }>(
        `WITH mine AS (${MINE}),
              w AS (SELECT n, now() - make_interval(days => n * 7 + 7) AS t0, now() - make_interval(days => n * 7) AS t1 FROM generate_series(0, 5) AS n)
         SELECT (CURRENT_DATE - (w.n * 7 + 6))::text AS week_start, count(x.ended_at) AS sessions, round(avg(x.active_ms)) AS avg_duration_ms
           FROM w LEFT JOIN (SELECT g.ended_at, g.active_ms FROM ${COUNTED}) x ON x.ended_at > w.t0 AND x.ended_at <= w.t1
          GROUP BY w.n ORDER BY w.n DESC`,
        [clinic],
      );
      return { totals, weekly: weekly.rows };
    });

    const done = Number(out.totals.done);
    const missed = Number(out.totals.missed);
    return c.json({
      sessions: Number(out.totals.sessions),
      sessions_this_week: Number(out.totals.sessions_this_week),
      active_patients: Number(out.totals.active_patients),
      in_care: Number(out.totals.in_care),
      avg_duration_ms: out.totals.avg_duration_ms === null ? null : Number(out.totals.avg_duration_ms),
      plan_followed: done + missed === 0 ? null : done / (done + missed),
      weekly: out.weekly.map((w) => ({ week_start: w.week_start, sessions: Number(w.sessions), avg_duration_ms: w.avg_duration_ms === null ? null : Number(w.avg_duration_ms) })),
    });
  });

  return r;
}
