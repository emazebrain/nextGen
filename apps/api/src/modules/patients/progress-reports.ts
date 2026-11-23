/**
 * Progress reports (design doc §5.9.2 export; migration 0042): a therapist issues a report for one patient over a
 * date range, with a short written summary, to print or save as PDF. The figures are worked out once, when the
 * report is issued, and stored with it, so a report always reprints exactly as it was given out.
 *
 * Staff routes run through withUser (RLS in force). Every read of a report is audited. Nothing here is logged or
 * emailed: the therapist hands the document over, or shares it into the parent portal (invariant 7).
 * Wording follows §11.6: activities and results compared with the child's own earlier sessions, no conclusions.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { z } from "zod";
import { trend, type GameInfo, type SessionInput } from "../../../../../packages/metrics/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { GAME_MANIFESTS } from "../../games.ts";
import { UUID } from "./routes.ts";

const GAMES: GameInfo[] = Object.values(GAME_MANIFESTS).map((m) => ({ id: m.id, metrics: m.metrics }));
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    from: z.string().regex(DAY),
    to: z.string().regex(DAY),
    audience: z.enum(["family", "formal"]),
    locale: z.enum(["en", "he"]),
    summary: z.string().max(2000).default(""),
    shared_with_family: z.boolean().default(false),
  })
  .refine((v) => !Number.isNaN(Date.parse(v.from)) && !Number.isNaN(Date.parse(v.to)), { path: ["from"] })
  .refine((v) => v.to >= v.from, { path: ["to"] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { path: ["to"] });

/** The figures stored with a report. Kept small and plain: the page that prints it does the wording. */
export interface ProgressReportData {
  patient: { given_name: string; family_name: string; date_of_birth: string };
  clinic: { name: string; address: string | null; phone: string | null; license_no: string | null };
  author: { name: string };
  totals: { sessions: number; minutes: number; days_active: number; clinic_sessions: number; home_sessions: number };
  plan: { planned: number; done: number; missed: number };
  activities: Array<{ game_id: string; sessions: number; avg_accuracy: number | null; first_difficulty: number; last_difficulty: number }>;
  /** Scores against the child's own baseline (100) for the sessions in the period, oldest first. */
  trend: { summary: "not_enough" | "improving" | "steady" | "declining"; points: Array<{ ended_at: string; score: number | null }> };
  changes: Array<{ decided_at: string; game_id: string; action: "up" | "down"; from: number; to: number }>;
}

const LIST_COLS = `r.id, r.patient_id, r.created_at, r.period_from::text AS period_from, r.period_to::text AS period_to, r.audience, r.locale, r.shared_with_family, u.full_name AS author_name`;
const FULL_COLS = `${LIST_COLS}, r.summary, r.data`;
const FROM = `app.progress_report r JOIN app.app_user u ON u.id = r.created_by`;

/** Works out the figures for one patient and period. Null when the caller can't see the patient. */
async function buildData(db: pg.PoolClient, patientId: string, from: string, to: string): Promise<ProgressReportData | null> {
  const head = (
    await db.query<{ given_name: string; family_name: string; date_of_birth: string; clinic_name: string; address: string | null; phone: string | null; license_no: string | null; author: string }>(
      `SELECT p.given_name, p.family_name, p.date_of_birth::text AS date_of_birth, c.name AS clinic_name, c.address, c.phone, c.license_no,
              (SELECT full_name FROM app.app_user WHERE id = app.current_user_id()) AS author
         FROM app.patient p JOIN app.clinic c ON c.id = p.clinic_id
        WHERE p.id = $1 AND p.deleted_at IS NULL AND app.can_treat_patient(p.id)`,
      [patientId],
    )
  ).rows[0];
  if (!head) return null;

  // Every counted session up to the end of the period: the baseline comes from the child's earliest sessions,
  // which may be before the period starts.
  const sessions = (
    await db.query<SessionInput & { location: string; in_period: boolean }>(
      `SELECT g.id, g.game_id, g.ended_at, g.difficulty, g.accuracy::float8 AS accuracy, g.rt_median_ms, g.metrics, g.hemisphere, g.active_ms, g.location,
              COALESCE((g.config_echo->>'monochrome')::boolean, false) AS monochrome,
              g.ended_at >= $2::date AS in_period
         FROM app.game_session g JOIN app.game_session_review r ON r.id = g.id
        WHERE g.patient_id = $1 AND g.is_valid AND r.counts IS NOT FALSE AND g.ended_at < $3::date + 1
        ORDER BY g.ended_at`,
      [patientId, from, to],
    )
  ).rows.map((s) => ({ ...s, ended_at: (s.ended_at as unknown as Date).toISOString() }));
  const inPeriod = sessions.filter((s) => s.in_period);

  const plan = (
    await db.query<{ planned: string; done: string; missed: string }>(
      `SELECT count(*) FILTER (WHERE status NOT IN ('cancelled', 'skipped')) AS planned,
              count(*) FILTER (WHERE status = 'done') AS done,
              count(*) FILTER (WHERE status = 'missed' OR (status = 'planned' AND planned_date < CURRENT_DATE)) AS missed
         FROM app.planned_session WHERE patient_id = $1 AND planned_date BETWEEN $2::date AND $3::date`,
      [patientId, from, to],
    )
  ).rows[0]!;

  const changes = (
    await db.query<{ decided_at: Date; game_id: string; action: "up" | "down"; from_difficulty: number; to_difficulty: number }>(
      `SELECT d.decided_at, s.game_id, d.action, d.from_difficulty, d.to_difficulty
         FROM app.progression_decision d JOIN app.assignment_step s ON s.id = d.assignment_step_id
        WHERE d.patient_id = $1 AND d.action IN ('up', 'down') AND d.decided_at >= $2::date AND d.decided_at < $3::date + 1
        ORDER BY d.decided_at`,
      [patientId, from, to],
    )
  ).rows;

  const byGame = new Map<string, typeof inPeriod>();
  for (const s of inPeriod) byGame.set(s.game_id, [...(byGame.get(s.game_id) ?? []), s]);
  const tr = trend(sessions, GAMES, { kind: "standard", key: "accuracy" });
  const inIds = new Set(inPeriod.map((s) => s.id));

  return {
    patient: { given_name: head.given_name, family_name: head.family_name, date_of_birth: head.date_of_birth },
    clinic: { name: head.clinic_name, address: head.address, phone: head.phone, license_no: head.license_no },
    author: { name: head.author },
    totals: {
      sessions: inPeriod.length,
      minutes: Math.round(inPeriod.reduce((sum, s) => sum + (s.active_ms ?? 0), 0) / 60_000),
      days_active: new Set(inPeriod.map((s) => s.ended_at.slice(0, 10))).size,
      clinic_sessions: inPeriod.filter((s) => s.location !== "home").length,
      home_sessions: inPeriod.filter((s) => s.location === "home").length,
    },
    plan: { planned: Number(plan.planned), done: Number(plan.done), missed: Number(plan.missed) },
    activities: [...byGame]
      .map(([game_id, list]) => {
        const acc = list.map((s) => s.accuracy).filter((a): a is number => a !== null);
        return {
          game_id,
          sessions: list.length,
          avg_accuracy: acc.length ? Math.round((acc.reduce((a, b) => a + b, 0) / acc.length) * 1000) / 1000 : null,
          first_difficulty: list[0]!.difficulty,
          last_difficulty: list.at(-1)!.difficulty,
        };
      })
      .sort((a, b) => b.sessions - a.sessions),
    trend: { summary: inPeriod.length === 0 ? "not_enough" : tr.summary, points: tr.points.filter((p) => inIds.has(p.sessionId)).map((p) => ({ ended_at: p.endedAt, score: p.score })) },
    changes: changes.map((d) => ({ decided_at: d.decided_at.toISOString(), game_id: d.game_id, action: d.action, from: d.from_difficulty, to: d.to_difficulty })),
  };
}

type C = Context<Env>;

/** Staff routes, mounted at /v1. */
export function progressReportRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  const run = <T>(c: C, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const notFound = (c: C) => c.json({ error: "not_found" }, 404);

  r.get("/patients/:id/progress-reports", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const reports = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return null;
      return (await db.query(`SELECT ${LIST_COLS} FROM ${FROM} WHERE r.patient_id = $1 ORDER BY r.created_at DESC LIMIT 100`, [id])).rows;
    });
    return reports ? c.json({ reports }) : notFound(c);
  });

  r.post("/patients/:id/progress-reports", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid", issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), code: i.code })) }, 400);
    const v = parsed.data;
    const report = await run(c, async (db) => {
      const data = await buildData(db, id, v.from, v.to);
      if (!data) return null;
      const { rows } = await db.query<{ id: string }>(
        `INSERT INTO app.progress_report (patient_id, clinic_id, created_by, period_from, period_to, audience, locale, summary, shared_with_family, data)
         VALUES ($1, (SELECT clinic_id FROM app.patient WHERE id = $1), app.current_user_id(), $2, $3, $4, $5, $6, $7, $8)
         RETURNING id`,
        [id, v.from, v.to, v.audience, v.locale, v.summary.trim(), v.shared_with_family, JSON.stringify(data)],
      );
      return (await db.query(`SELECT ${FULL_COLS} FROM ${FROM} WHERE r.id = $1`, [rows[0]!.id])).rows[0];
    });
    return report ? c.json({ report }, 201) : notFound(c);
  });

  r.get("/progress-reports/:rid", async (c) => {
    const rid = c.req.param("rid");
    if (!UUID.test(rid)) return notFound(c);
    const report = await run(c, async (db) => {
      const row = (await db.query<{ id: string; patient_id: string }>(`SELECT ${FULL_COLS} FROM ${FROM} WHERE r.id = $1`, [rid])).rows[0];
      if (row) await db.query(`SELECT app.record_audit('view', 'progress_report', $1, $2)`, [row.id, row.patient_id]);
      return row;
    });
    return report ? c.json({ report }) : notFound(c);
  });

  r.patch("/progress-reports/:rid", async (c) => {
    const rid = c.req.param("rid");
    if (!UUID.test(rid)) return notFound(c);
    const body = z.object({ shared_with_family: z.boolean() }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "invalid" }, 400);
    const report = await run(c, async (db) => {
      const done = await db.query(`UPDATE app.progress_report SET shared_with_family = $2 WHERE id = $1`, [rid, body.data.shared_with_family]);
      if (!done.rowCount) return null;
      return (await db.query(`SELECT ${LIST_COLS} FROM ${FROM} WHERE r.id = $1`, [rid])).rows[0];
    });
    return report ? c.json({ report }) : notFound(c);
  });

  return r;
}

/**
 * Parent portal reads, mounted under /v1/parent. Like the other parent routes these use the service connection
 * and check the link in code: the caller must be a guardian of the child, and the report must be shared.
 */
export function parentProgressReportRoutes(servicePool: pg.Pool) {
  const r = new Hono<Env>();
  const LINKED = `EXISTS (SELECT 1 FROM app.guardian_patient gp JOIN app.guardian g ON g.id = gp.guardian_id
                           WHERE gp.patient_id = r.patient_id AND g.user_id = $2 AND g.deleted_at IS NULL)`;

  r.get("/children/:id/reports", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const { rows } = await servicePool.query(`SELECT ${LIST_COLS} FROM ${FROM} WHERE r.patient_id = $1 AND r.shared_with_family AND ${LINKED} ORDER BY r.created_at DESC LIMIT 100`, [id, c.get("user").id]);
    return c.json({ reports: rows });
  });

  r.get("/reports/:rid", async (c) => {
    const rid = c.req.param("rid");
    if (!UUID.test(rid)) return c.json({ error: "not_found" }, 404);
    const { rows } = await servicePool.query(`SELECT ${FULL_COLS} FROM ${FROM} WHERE r.id = $1 AND r.shared_with_family AND ${LINKED}`, [rid, c.get("user").id]);
    return rows[0] ? c.json({ report: rows[0] }) : c.json({ error: "not_found" }, 404);
  });

  return r;
}
