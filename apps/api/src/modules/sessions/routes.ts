/**
 * Running a session (design doc §5.6, §8.2, §9.8).
 *
 * Launch: checks consent and the protocol, builds each game's parameters on
 * the server, and signs a ticket per game. Results: verifies the ticket,
 * stores every upload attempt (append-only), stores the game session once
 * (the device's UUIDv7 is the idempotency key), applies progression and
 * closes the planned session when every game has a result.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { createHash, randomInt } from "node:crypto";
import {
  canonicalJson,
  resultUpload,
  type GameSessionView,
  type LaunchPackage,
  type ProgressionDecisionView,
  type ResultEnvelopeInput,
  type ResultReceipt,
} from "../../../../../packages/contracts/src/index.ts";
import { decide, type Rule } from "../../../../../packages/progression/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { GAME_MANIFESTS } from "../../games.ts";
import { paramsHash, type TicketSigner } from "../../tickets.ts";
import { parseBody } from "../../validate.ts";
import { UUID } from "../patients/routes.ts";
import { timerPositionFor, timerShown } from "@emb/session-rules";

const CLINIC_TICKET_TTL_S = 24 * 3600;
const GAME_LANGS = new Set(["he", "en", "ar", "ru", "fr", "es", "zh"]);

interface StepRow {
  id: string;
  ordinal: number;
  game_id: string;
  session_mode: "timed" | "lives" | "timed_lives";
  duration_s: number | null;
  lives: number | null;
  current_difficulty: number;
  hemisphere: "left" | "right";
  timer_position: "left" | "right" | "hidden";
  practice: "auto" | "on" | "off";
  trial_window_ms: number | null;
  game_params: Record<string, unknown>;
  sessions_completed: number;
}

/** Platform parameters (§8.2) for one step, plus the game's own settings namespaced by game id. */
export function buildParams(step: StepRow, patient: { preferred_locale: string; colour_vision_deficiency: boolean }, seed: number) {
  const ns = step.game_id.replace(/-/g, "_");
  const own: Record<string, unknown> = { ...step.game_params };
  if (patient.colour_vision_deficiency && GAME_MANIFESTS[step.game_id]?.paramsSchema.properties.cvd_mode) own.cvd_mode = true; // from the patient record (§8.1)
  return {
    session_mode: step.session_mode,
    ...(step.duration_s !== null ? { duration_s: step.duration_s } : {}),
    ...(step.lives !== null ? { lives: step.lives } : {}),
    difficulty: step.current_difficulty,
    start_level: "from_difficulty",
    hemisphere: step.hemisphere,
    // Older steps may hold the v1 same-side value: the corner always follows the hemisphere (ADR 0008).
    timer_position: timerPositionFor(step.hemisphere, timerShown(step.timer_position)),
    trial_window_ms: step.trial_window_ms,
    // "Auto" practice: on for a step's first session, then off.
    practice: step.practice === "auto" ? (step.sessions_completed === 0 ? "on" : "off") : step.practice,
    instructions: step.sessions_completed < 2 ? "always" : "short",
    lang: GAME_LANGS.has(patient.preferred_locale) ? patient.preferred_locale : "en",
    sound: "off",
    reduce_motion: "os",
    high_contrast: false,
    show_score: true,
    context: "clinic",
    seed,
    input_assist: "none",
    speed_scale: 1,
    ...Object.fromEntries(Object.entries(own).map(([k, v]) => [`${ns}.${k}`, v])),
  };
}

export function sessionRoutes(pool: pg.Pool, tickets: TicketSigner) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  r.post("/planned-sessions/:id/launch", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const me = c.get("user").id;
    const result = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT ps.id, ps.seq, ps.week, ps.status, a.id AS assignment_id, a.name AS assignment_name, a.status AS assignment_status,
                (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status <> 'cancelled') AS total,
                p.id AS patient_id, p.given_name, p.family_name, p.preferred_locale, p.alert, p.colour_vision_deficiency,
                app.patient_can_play(p.id) AS can_play, app.can_treat_patient(p.id) AS can_treat
           FROM app.planned_session ps
           JOIN app.protocol_assignment a ON a.id = ps.assignment_id
           JOIN app.patient p ON p.id = ps.patient_id
          WHERE ps.id = $1`,
        [id],
      );
      const row = rows[0];
      if (!row) return { error: "not_found" as const };
      if (!row.can_treat) return { error: "forbidden" as const };
      // Consent for clinic sessions must be in place (§11.3). Checked again here, not only in the app.
      if (!row.can_play) return { error: "consent_required" as const };
      if (row.assignment_status !== "active") return { error: "protocol_not_active" as const };
      if (row.status !== "planned" && row.status !== "in_progress") return { error: "session_closed" as const };
      const steps = await db.query<StepRow & { done: boolean }>(
        `SELECT s.id, s.ordinal, s.game_id, s.session_mode, s.duration_s, s.lives, s.current_difficulty, s.hemisphere, s.timer_position, s.practice, s.trial_window_ms,
                s.game_params, s.sessions_completed,
                EXISTS (SELECT 1 FROM app.game_session g WHERE g.planned_session_id = $2 AND g.assignment_step_id = s.id) AS done
           FROM app.assignment_step s WHERE s.assignment_id = $1 ORDER BY s.ordinal`,
        [row.assignment_id, id],
      );
      await db.query(`UPDATE app.planned_session SET status = 'in_progress' WHERE id = $1 AND status = 'planned'`, [id]);
      const pkg: LaunchPackage = {
        planned_session_id: id,
        seq: row.seq,
        week: row.week,
        total: row.total,
        patient: { id: row.patient_id, given_name: row.given_name, family_name: row.family_name, preferred_locale: row.preferred_locale, alert: row.alert },
        assignment: { id: row.assignment_id, name: row.assignment_name },
        steps: steps.rows.map((s) => {
          const params = buildParams(s, row, randomInt(1, 2 ** 31));
          const ticket = tickets.sign({ jti: crypto.randomUUID(), psid: id, asid: s.id, pid: row.patient_id, gid: s.game_id, ph: paramsHash(params), sub: me }, CLINIC_TICKET_TTL_S);
          return { assignment_step_id: s.id, ordinal: s.ordinal, game_id: s.game_id, params, ticket, done: s.done };
        }),
      };
      return pkg;
    });
    if ("error" in result) {
      const status = result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 409;
      return c.json({ error: result.error }, status);
    }
    return c.json({ launch: result });
  });

  r.post("/results", async (c) => {
    const me = c.get("user").id;
    const raw = await c.req.json().catch(() => null);
    const body = await parseBody(c, resultUpload);
    // Every attempt is kept, even ones we reject (§9.8: never drop a result silently).
    const record = (db: pg.PoolClient, outcome: string, error: string | null, extra: { sessionId?: string | null; psid?: string | null; pid?: string | null } = {}) =>
      db.query(
        `INSERT INTO app.session_result_raw (client_session_id, planned_session_id, patient_id, recorded_by, envelope_version, payload, payload_sha256, outcome, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          extra.sessionId ?? null,
          extra.psid ?? null,
          extra.pid ?? null,
          me,
          (raw as { envelope?: { envelope_version?: string } } | null)?.envelope?.envelope_version ?? null,
          JSON.stringify(raw ?? {}),
          createHash("sha256").update(canonicalJson(raw ?? {})).digest(),
          outcome,
          error,
        ],
      );
    const sessionIdOf = () => {
      const s = (raw as { envelope?: { session_id?: unknown } } | null)?.envelope?.session_id;
      return typeof s === "string" && UUID.test(s) ? s : null;
    };

    if (!body.ok) {
      await run(c, (db) => record(db, "rejected", "invalid_envelope", { sessionId: sessionIdOf() }));
      return body.response;
    }
    const { ticket, envelope } = body.data;
    const claims = tickets.verify(ticket);
    const reject = async (error: string) => {
      await run(c, (db) => record(db, "rejected", error, { sessionId: envelope.session_id, psid: claims?.psid ?? null, pid: claims?.pid ?? null }));
      return c.json({ error }, 422);
    };
    if (!claims) return reject("invalid_ticket");
    if (envelope.demo) return reject("demo_result");
    if (claims.gid !== envelope.game_id) return reject("game_mismatch");
    if (paramsHash(envelope.params) !== claims.ph) return reject("params_mismatch");

    const receipt = await run(c, (db) => ingest(db, envelope, claims, me, record));
    return c.json(receipt, receipt.outcome === "accepted" ? 201 : 200);
  });

  r.get("/patients/:id/sessions", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const sessions = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return null;
      const { rows } = await db.query<GameSessionView>(
        `SELECT g.id, g.game_id, g.status, g.session_mode, g.difficulty, g.hemisphere, g.started_at, g.ended_at, g.active_ms,
                g.accuracy::float8 AS accuracy, g.rt_median_ms, g.trials_total, g.correct, g.errors, g.lives_lost, g.highest_level,
                g.planned_session_id, ps.seq, g.metrics
           FROM app.game_session g LEFT JOIN app.planned_session ps ON ps.id = g.planned_session_id
          WHERE g.patient_id = $1 AND g.is_valid
          ORDER BY g.ended_at DESC LIMIT 500`,
        [id],
      );
      await db.query(`SELECT app.record_audit('view', 'game_session', NULL, $1)`, [id]);
      return rows;
    });
    return sessions ? c.json({ sessions }) : c.json({ error: "not_found" }, 404);
  });

  // Why difficulty changed (§5.5): one row per automatic decision that moved it.
  // "Hold" decisions are left out; they would bury the few that matter.
  r.get("/patients/:id/progression", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const decisions = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return null;
      const { rows } = await db.query<ProgressionDecisionView>(
        `SELECT d.id, d.game_session_id, g.game_id, d.decided_at, d.action, d.from_difficulty, d.to_difficulty, d.reason
           FROM app.progression_decision d JOIN app.game_session g ON g.id = d.game_session_id
          WHERE d.patient_id = $1 AND d.action <> 'hold'
          ORDER BY d.decided_at DESC LIMIT 200`,
        [id],
      );
      await db.query(`SELECT app.record_audit('view', 'progression_decision', NULL, $1)`, [id]);
      return rows;
    });
    return decisions ? c.json({ decisions }) : c.json({ error: "not_found" }, 404);
  });

  return r;
}

async function ingest(
  db: pg.PoolClient,
  e: ResultEnvelopeInput,
  claims: { psid: string; asid: string; pid: string },
  me: string,
  record: (db: pg.PoolClient, outcome: string, error: string | null, extra: { sessionId?: string | null; psid?: string | null; pid?: string | null }) => Promise<unknown>,
): Promise<ResultReceipt> {
  const extra = { sessionId: e.session_id, psid: claims.psid, pid: claims.pid };
  const p = e.params as Record<string, unknown>;
  const metrics = e.metrics as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const inserted = await db.query(
    `INSERT INTO app.game_session (id, patient_id, clinic_id, assignment_step_id, planned_session_id, recorded_by, game_id, game_version, location, status, end_reason,
        session_mode, difficulty, hemisphere, started_at, ended_at, active_ms, paused_ms, lives_start, lives_lost, lives_remaining,
        trials_total, correct, errors, timeouts, accuracy, rt_median_ms, rt_mean_ms, left_accuracy, right_accuracy, highest_level, levels_completed,
        metrics, std, levels, config_echo)
     SELECT $1, $2, p.clinic_id, $3, $4, $5, $6, $7, 'clinic', $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34
       FROM app.patient p WHERE p.id = $2
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      e.session_id, claims.pid, claims.asid, claims.psid, me, e.game_id, e.game_version, e.status, e.end_reason,
      e.mode, p.difficulty, p.hemisphere, e.started_at, e.ended_at, e.active_ms, e.paused_ms, e.lives_start, e.lives_lost, e.lives_remaining,
      e.std.trials_total, e.std.correct, e.std.errors, e.std.timeouts, e.std.accuracy, e.std.rt_median_ms !== null ? Math.round(e.std.rt_median_ms) : null,
      e.std.rt_mean_ms !== null ? Math.round(e.std.rt_mean_ms) : null, e.std.left_accuracy, e.std.right_accuracy,
      num(metrics.highest_level), num(metrics.levels_completed),
      JSON.stringify(e.metrics), JSON.stringify(e.std), JSON.stringify(e.levels), JSON.stringify(e.params),
    ],
  );

  if (inserted.rowCount === 0) {
    // Already stored (a retry after a lost response, or the outbox sending twice): same answer, nothing new.
    const existing = await db.query(`SELECT assignment_step_id FROM app.game_session WHERE id = $1`, [e.session_id]);
    const same = existing.rows[0]?.assignment_step_id === claims.asid;
    await record(db, same ? "duplicate" : "conflict", same ? null : "session_id_reused", extra);
    const ps = await db.query(`SELECT status FROM app.planned_session WHERE id = $1`, [claims.psid]);
    return { outcome: "duplicate", session_id: e.session_id, progression: null, planned_session_status: ps.rows[0]?.status ?? null };
  }
  await record(db, "accepted", null, extra);

  let progression: ResultReceipt["progression"] = null;
  if (e.status !== "abandoned") {
    const step = await db.query<{ current_difficulty: number; progression: Rule | null }>(
      `UPDATE app.assignment_step SET sessions_completed = sessions_completed + 1 WHERE id = $1 RETURNING current_difficulty, progression`,
      [claims.asid],
    );
    const s = step.rows[0];
    if (s) {
      const history = await db.query<{ accuracy: number | null; difficulty: number; valid: boolean }>(
        `SELECT accuracy::float8 AS accuracy, difficulty, (is_valid AND status <> 'abandoned') AS valid
           FROM app.game_session WHERE assignment_step_id = $1 ORDER BY ended_at, id`,
        [claims.asid],
      );
      const d = decide(s.progression, history.rows, s.current_difficulty);
      progression = { action: d.action, from: d.from, to: d.to };
      if (d.action !== "hold") await db.query(`UPDATE app.assignment_step SET current_difficulty = $2 WHERE id = $1`, [claims.asid, d.to]);
      if (s.progression) {
        await db.query(
          `INSERT INTO app.progression_decision (assignment_step_id, patient_id, game_session_id, action, from_difficulty, to_difficulty, inputs, reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [claims.asid, claims.pid, e.session_id, d.action, d.from, d.to, JSON.stringify({ rule: s.progression, accuracies: d.used }), d.reason],
        );
      }
    }
  }

  // The planned session is done once every game in it has a result.
  const ps = await db.query<{ status: string }>(
    `WITH missing AS (
       SELECT count(*) AS n FROM app.assignment_step s
        JOIN app.planned_session x ON x.assignment_id = s.assignment_id AND x.id = $1
        WHERE NOT EXISTS (SELECT 1 FROM app.game_session g WHERE g.planned_session_id = $1 AND g.assignment_step_id = s.id))
     UPDATE app.planned_session ps
        SET status = CASE WHEN (SELECT n FROM missing) = 0 THEN 'done' ELSE 'in_progress' END,
            completed_at = CASE WHEN (SELECT n FROM missing) = 0 THEN now() ELSE NULL END
      WHERE ps.id = $1 AND ps.status IN ('planned', 'in_progress')
      RETURNING status`,
    [claims.psid],
  );
  return { outcome: "accepted", session_id: e.session_id, progression, planned_session_status: ps.rows[0]?.status ?? null };
}
