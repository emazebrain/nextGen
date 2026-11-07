/**
 * Protocol templates, assignments and Today (design doc §5.4–5.5, §4.1).
 * Templates: platform library + clinic templates (private or shared).
 * Assigning copies the steps onto the patient and lays out the schedule.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import {
  isVideoStep,
  assignInput,
  scheduleDates,
  templateInput,
  type AssignmentView,
  type GameStepInput,
  type StepItem,
  type StepInput,
  type TemplateDetail,
  type TemplateSummary,
  type TodayItem,
} from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { checkStepAgainstGame } from "../../games.ts";
import { uuidv7 } from "../../ids.ts";
import { parseBody } from "../../validate.ts";
import { UUID } from "../patients/routes.ts";
import { pick } from "../videos/routes.ts";
import { timerPositionFor, timerShown } from "@emb/session-rules";

const STEP_COLUMNS = `game_id, session_mode, duration_s, lives, difficulty_start, hemisphere, timer_position, practice, trial_window_ms, game_params, progression, monochrome, lives_auto, step_type, video_id`;

function stepValues(s: StepInput) {
  // A video step carries no game settings; the not-null game columns get neutral values (ADR 0018).
  if (isVideoStep(s)) return [null, null, null, null, 3, "left", "hidden", "off", null, "{}", null, false, false, "video", s.video_id];
  // The timer corner is derived from the hemisphere (ADR 0008); only shown or hidden comes from the client.
  return [s.game_id, s.session_mode, s.duration_s, s.lives, s.difficulty_start, s.hemisphere, timerPositionFor(s.hemisphere, timerShown(s.timer_position)), s.practice, s.trial_window_ms, JSON.stringify(s.game_params), s.progression ? JSON.stringify(s.progression) : null, s.monochrome === true, s.lives_auto === true, "game", null];
}

function gameIssues(steps: StepInput[]) {
  return steps.flatMap((s, i) => (isVideoStep(s) ? [] : checkStepAgainstGame(s as GameStepInput, i)));
}

/** A video step may only use a published video, unless the protocol being edited already had it (it stays). */
async function videoIssues(db: pg.PoolClient, steps: StepInput[], keep: Set<string> = new Set()) {
  const issues: Array<{ path: string; code: string }> = [];
  for (const [i, s] of steps.entries()) {
    if (!isVideoStep(s) || keep.has(s.video_id)) continue;
    const { rows } = await db.query<{ status: string }>(`SELECT status FROM app.video WHERE id = $1`, [s.video_id]);
    if (rows[0]?.status !== "published") issues.push({ path: `steps.${i}.video_id`, code: "video_not_available" });
  }
  return issues;
}

/** One step as clients see it: a video step is just the video; a game step has no video_id. */
export function cleanStep<T extends Record<string, unknown>>(row: T): T {
  if (row.step_type === "video") {
    const out: Record<string, unknown> = { step_type: "video", video_id: row.video_id };
    for (const k of ["id", "ordinal", "current_difficulty", "sessions_completed"]) if (k in row) out[k] = row[k];
    return out as T;
  }
  const { video_id: _v, ...rest } = row;
  return rest as unknown as T;
}

type RawItem = { kind: "game" | "video"; game_id: string | null; video_id: string | null; titles: Record<string, string> | null };
export const ITEMS_SQL = (table: "template_step" | "assignment_step", key: string, owner: string) => `
  COALESCE((SELECT json_agg(json_build_object('kind', s.step_type, 'game_id', s.game_id, 'video_id', s.video_id,
                    'titles', (SELECT jsonb_object_agg(i.locale, i.title) FROM app.video_i18n i WHERE i.video_id = s.video_id)) ORDER BY s.ordinal)
              FROM app.${table} s WHERE s.${key} = ${owner}), '[]') AS items`;
export function toItems(raw: RawItem[], lang: string): StepItem[] {
  return raw.map((r) => (r.kind === "video" ? { kind: "video", video_id: r.video_id!, title: pick(r.titles ?? {}, lang) ?? "" } : { kind: "game", game_id: r.game_id! }));
}
const LANGS = new Set(["en", "he", "ar", "ru", "fr", "es", "zh"]);
const langOf = (c: Context) => (LANGS.has(c.req.query("lang") ?? "") ? c.req.query("lang")! : "en");

const SUMMARY_SQL = `
  SELECT t.id, t.clinic_id, t.name, t.description, t.weeks, t.sessions_per_week, t.setting, t.visibility, t.version,
         u.full_name AS owner_name, app.can_edit_template(t.id) AS can_edit,
         COALESCE((SELECT array_agg(s.game_id ORDER BY s.ordinal) FILTER (WHERE s.step_type = 'game') FROM app.template_step s WHERE s.template_id = t.id), '{}') AS games,
         ${ITEMS_SQL("template_step", "template_id", "t.id")}
    FROM app.protocol_template t LEFT JOIN app.app_user u ON u.id = t.owner_user_id`;

async function loadTemplate(db: pg.PoolClient, id: string, lang = "en"): Promise<TemplateDetail | null> {
  const { rows } = await db.query(`${SUMMARY_SQL} WHERE t.id = $1 AND t.deleted_at IS NULL`, [id]);
  if (!rows[0]) return null;
  const steps = await db.query(`SELECT id, ordinal, ${STEP_COLUMNS} FROM app.template_step WHERE template_id = $1 ORDER BY ordinal`, [id]);
  return { ...rows[0], items: toItems(rows[0].items, lang), steps: steps.rows.map(cleanStep) };
}

export async function loadAssignment(db: pg.PoolClient, patientId: string): Promise<AssignmentView | null> {
  const { rows } = await db.query(
    `SELECT a.id, a.name, a.template_id, to_char(a.start_date, 'YYYY-MM-DD') AS start_date, a.weeks, a.sessions_per_week, a.setting, a.status,
            u.full_name AS assigned_by_name
       FROM app.protocol_assignment a LEFT JOIN app.app_user u ON u.id = a.assigned_by
      WHERE a.patient_id = $1 AND a.status IN ('active', 'paused')`,
    [patientId],
  );
  const a = rows[0];
  if (!a) return null;
  const [steps, sessions] = await Promise.all([
    db.query(`SELECT id, ordinal, ${STEP_COLUMNS}, current_difficulty, sessions_completed FROM app.assignment_step WHERE assignment_id = $1 ORDER BY ordinal`, [a.id]).then((r) => ({ rows: r.rows.map(cleanStep) })),
    db.query(`SELECT id, seq, week, to_char(planned_date, 'YYYY-MM-DD') AS planned_date, status FROM app.planned_session WHERE assignment_id = $1 ORDER BY seq`, [a.id]),
  ]);
  return { ...a, steps: steps.rows, sessions: sessions.rows };
}


/** Templates the caller may use (their clinic's and platform ones), with steps in order. */
export async function listTemplates(db: pg.PoolClient, clinic: string | null, lang: string): Promise<TemplateSummary[]> {
  const { rows } = await db.query<TemplateSummary>(
    `${SUMMARY_SQL} WHERE t.deleted_at IS NULL AND ($1::uuid IS NULL OR t.clinic_id IS NULL OR t.clinic_id = $1::uuid)
      ORDER BY (t.visibility = 'platform'), t.name`,
    [clinic],
  );
  return rows.map((t) => ({ ...t, items: toItems(t.items as unknown as RawItem[], lang) }));
}

/** Today: each of the caller's patients' earliest open clinic session, planned up to today (and overdue 7 days). */
export async function todayItems(db: pg.PoolClient, clinic: string | null, date: string | null, lang: string): Promise<TodayItem[]> {
  const { rows } = await db.query<TodayItem & { patient_id: string }>(
    `SELECT ps.id AS planned_session_id, to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date, ps.seq, ps.week,
            (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status <> 'cancelled') AS total,
            json_build_object('id', p.id, 'given_name', p.given_name, 'family_name', p.family_name,
                              'date_of_birth', to_char(p.date_of_birth, 'YYYY-MM-DD'), 'alert', p.alert,
                              'can_play', app.patient_can_play(p.id)) AS patient,
            json_build_object('id', a.id, 'name', a.name, 'weeks', a.weeks) AS assignment,
            (SELECT array_agg(s.game_id ORDER BY s.ordinal) FILTER (WHERE s.step_type = 'game') FROM app.assignment_step s WHERE s.assignment_id = a.id) AS games,
            ${ITEMS_SQL("assignment_step", "assignment_id", "a.id")}
       FROM app.planned_session ps
       JOIN app.protocol_assignment a ON a.id = ps.assignment_id AND a.status = 'active'
       JOIN app.patient p ON p.id = ps.patient_id AND p.deleted_at IS NULL
      WHERE ps.status IN ('planned', 'in_progress') AND ps.location = 'clinic'
        AND ps.planned_date BETWEEN COALESCE($2::date, current_date) - 7 AND COALESCE($2::date, current_date)
        AND ($1::uuid IS NULL OR ps.clinic_id = $1::uuid)
        AND EXISTS (SELECT 1 FROM app.patient_care_team t WHERE t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL)
        -- one item per patient: their earliest open session
        AND ps.seq = (SELECT min(y.seq) FROM app.planned_session y WHERE y.assignment_id = a.id AND y.status IN ('planned', 'in_progress'))
      ORDER BY ps.planned_date, p.family_name, p.given_name`,
    [clinic, date],
  );
  if (rows.length) await db.query(`SELECT app.record_audit('list', 'planned_session', NULL)`);
  return rows.map((r) => ({ ...r, games: r.games ?? [], items: toItems((r as unknown as { items: RawItem[] }).items, lang) }));
}

export function protocolRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

  // ---- Templates

  r.get("/templates", async (c) => {
    const clinic = c.req.query("clinic");
    if (clinic !== undefined && !UUID.test(clinic)) return c.json({ error: "invalid_clinic" }, 400);
    const templates = await run(c, (db) => listTemplates(db, clinic ?? null, langOf(c)));
    return c.json({ templates });
  });

  r.get("/templates/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const t = await run(c, (db) => loadTemplate(db, id, langOf(c)));
    return t ? c.json({ template: t }) : notFound(c);
  });

  r.post("/templates", async (c) => {
    const body = await parseBody(c, templateInput);
    if (!body.ok) return body.response;
    const input = body.data;
    const issues = gameIssues(input.steps);
    if (issues.length) return c.json({ error: "invalid", issues }, 400);
    const me = c.get("user").id;
    const result = await run(c, async (db) => {
      const vIssues = await videoIssues(db, input.steps);
      if (vIssues.length) return { issues: vIssues };
      const { rows } = await db.query(`SELECT organization_id FROM app.clinic WHERE id = $1`, [input.clinic_id]);
      if (!rows[0]) return null;
      const id = uuidv7();
      await db.query(
        `INSERT INTO app.protocol_template (id, organization_id, clinic_id, owner_user_id, name, description, weeks, sessions_per_week, setting, visibility)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, rows[0].organization_id, input.clinic_id, me, input.name, input.description ?? null, input.weeks, input.sessions_per_week, input.setting, input.visibility],
      );
      await insertTemplateSteps(db, id, input.steps);
      return loadTemplate(db, id, langOf(c));
    });
    if (result && "issues" in result) return c.json({ error: "invalid", issues: result.issues }, 400);
    return result ? c.json({ template: result }, 201) : c.json({ error: "forbidden" }, 403);
  });

  // Saving an edited template bumps its version. Patients already on it keep their own copy of the steps.
  r.put("/templates/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, templateInput);
    if (!body.ok) return body.response;
    const input = body.data;
    const issues = gameIssues(input.steps);
    if (issues.length) return c.json({ error: "invalid", issues }, 400);
    const result = await run(c, async (db) => {
      const had = await db.query<{ video_id: string }>(`SELECT video_id FROM app.template_step WHERE template_id = $1 AND video_id IS NOT NULL`, [id]);
      const vIssues = await videoIssues(db, input.steps, new Set(had.rows.map((r) => r.video_id)));
      if (vIssues.length) return { issues: vIssues };
      const upd = await db.query(
        `UPDATE app.protocol_template SET name = $2, description = $3, weeks = $4, sessions_per_week = $5, setting = $6, visibility = $7, version = version + 1
          WHERE id = $1 AND deleted_at IS NULL`,
        [id, input.name, input.description ?? null, input.weeks, input.sessions_per_week, input.setting, input.visibility],
      );
      if (upd.rowCount === 0) return null;
      await db.query(`DELETE FROM app.template_step WHERE template_id = $1`, [id]);
      await insertTemplateSteps(db, id, input.steps);
      return loadTemplate(db, id, langOf(c));
    });
    if (result && "issues" in result) return c.json({ error: "invalid", issues: result.issues }, 400);
    return result ? c.json({ template: result }) : notFound(c);
  });

  r.delete("/templates/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const ok = await run(c, async (db) => (await db.query(`UPDATE app.protocol_template SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL`, [id])).rowCount === 1);
    return ok ? c.json({ ok: true }) : notFound(c);
  });

  // ---- Assignments

  r.get("/patients/:id/assignment", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const result = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return undefined;
      return loadAssignment(db, id);
    });
    if (result === undefined) return notFound(c);
    return c.json({ assignment: result });
  });

  r.post("/patients/:id/assignment", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, assignInput);
    if (!body.ok) return body.response;
    const input = body.data;
    const issues = gameIssues(input.steps);
    if (issues.length) return c.json({ error: "invalid", issues }, 400);
    const me = c.get("user").id;
    const result = await run(c, async (db) => {
      const p = await db.query(`SELECT clinic_id FROM app.patient WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!p.rows[0]) return "not_found" as const;
      const running = await db.query(`SELECT 1 FROM app.protocol_assignment WHERE patient_id = $1 AND status IN ('active', 'paused')`, [id]);
      if (running.rowCount) return "already_assigned" as const;
      // Videos the chosen template already has may stay even if archived since (same rule as editing it).
      const fromTemplate = input.template_id
        ? (await db.query<{ video_id: string }>(`SELECT video_id FROM app.template_step WHERE template_id = $1 AND video_id IS NOT NULL`, [input.template_id])).rows.map((r) => r.video_id)
        : [];
      const vIssues = await videoIssues(db, input.steps, new Set(fromTemplate));
      if (vIssues.length) return { issues: vIssues };
      let version: number | null = null;
      if (input.template_id) {
        const t = await db.query(`SELECT version FROM app.protocol_template WHERE id = $1 AND deleted_at IS NULL`, [input.template_id]);
        if (!t.rows[0]) return "template_not_found" as const;
        version = t.rows[0].version;
      }
      const clinicId = p.rows[0].clinic_id;
      const aid = uuidv7();
      await db.query(
        `INSERT INTO app.protocol_assignment (id, patient_id, clinic_id, template_id, template_version, assigned_by, name, start_date, weeks, sessions_per_week, setting)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [aid, id, clinicId, input.template_id, version, me, input.name, input.start_date, input.weeks, input.sessions_per_week, input.setting],
      );
      for (const [i, s] of input.steps.entries()) {
        await db.query(
          `INSERT INTO app.assignment_step (assignment_id, patient_id, ordinal, ${STEP_COLUMNS}, current_difficulty)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$8)`,
          [aid, id, i + 1, ...stepValues(s)],
        );
      }
      const location = input.setting === "home" ? "home" : "clinic";
      for (const s of scheduleDates(input.start_date, input.weeks, input.sessions_per_week)) {
        await db.query(
          `INSERT INTO app.planned_session (assignment_id, patient_id, clinic_id, seq, week, planned_date, location) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [aid, id, clinicId, s.seq, s.week, s.date, location],
        );
      }
      return loadAssignment(db, id);
    });
    if (typeof result === "object" && result && "issues" in result) return c.json({ error: "invalid", issues: result.issues }, 400);
    if (result === "not_found" || result === "template_not_found") return notFound(c);
    if (result === "already_assigned") return c.json({ error: "already_assigned" }, 409);
    return c.json({ assignment: result }, 201);
  });

  // Pause, resume or stop a running protocol. Stopping cancels the sessions that haven't happened.
  r.patch("/assignments/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = (await c.req.json().catch(() => null)) as { status?: string } | null;
    const status = body?.status;
    if (status !== "active" && status !== "paused" && status !== "cancelled") return c.json({ error: "invalid", issues: [{ path: "status", code: "invalid_value" }] }, 400);
    const result = await run(c, async (db) => {
      const res = await db.query<{ patient_id: string }>(
        `UPDATE app.protocol_assignment SET status = $2 WHERE id = $1 AND status IN ('active', 'paused') RETURNING patient_id`,
        [id, status],
      );
      const row = res.rows[0];
      if (!row) return null;
      if (status === "cancelled") await db.query(`UPDATE app.planned_session SET status = 'cancelled' WHERE assignment_id = $1 AND status = 'planned'`, [id]);
      return { patient_id: row.patient_id, assignment: await loadAssignment(db, row.patient_id) };
    });
    return result ? c.json(result) : notFound(c);
  });

  // ---- Today: planned sessions for today (and overdue in the last 7 days) for patients the user can see.
  r.get("/today", async (c) => {
    const clinic = c.req.query("clinic");
    const date = c.req.query("date");
    if (clinic !== undefined && !UUID.test(clinic)) return c.json({ error: "invalid_clinic" }, 400);
    if (date !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ error: "invalid_date" }, 400);
    const items = await run(c, (db) => todayItems(db, clinic ?? null, date ?? null, langOf(c)));
    return c.json({ items });
  });

  return r;
}

async function insertTemplateSteps(db: pg.PoolClient, templateId: string, steps: StepInput[]) {
  for (const [i, s] of steps.entries()) {
    await db.query(`INSERT INTO app.template_step (template_id, ordinal, ${STEP_COLUMNS}) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`, [templateId, i + 1, ...stepValues(s)]);
  }
}
