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
  type LaunchStep,
  type VideoViewReceipt,
  videoViewInput,
  type ProgressionDecisionView,
  type ResultEnvelopeInput,
  type ResultReceipt,
  paramsWithinAllowed,
  type AllowedParams,
  type ReviewReason,
} from "../../../../../packages/contracts/src/index.ts";
import { decide, type Rule } from "../../../../../packages/progression/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { GAME_MANIFESTS } from "../../games.ts";
import { paramsHash, type TicketClaims, type TicketClaimsV2, type TicketSigner } from "../../tickets.ts";
import { parseBody } from "../../validate.ts";
import { UUID } from "../patients/routes.ts";
import { pick } from "../videos/routes.ts";
import { timerPositionFor, timerShown } from "@emb/session-rules";
import { ageBand, resolveRegion, seededIndex, type RegionCatalog } from "../../../../../packages/contracts/src/index.ts";
import { loadRegionCatalog } from "../../regions.ts";

const CLINIC_TICKET_TTL_S = 24 * 3600;
/** Offline package tickets live 30 days (design doc §8.2; offline devices spec §7.4). */
export const OFFLINE_TICKET_TTL_S = 30 * 24 * 3600;

/** Offline tickets leave these to the device: difficulty within a range, and the free per-session values. */
const DEVICE_CHOSEN = new Set(["difficulty", "seed", "practice", "instructions"]);
/** The settings that define a step; if any differs now from what the ticket allowed, the step changed. */
const STRUCTURAL = ["session_mode", "duration_s", "lives", "hemisphere", "timer_position", "monochrome", "trial_window_ms", "region"];

export function allowedParamsFor(params: Record<string, unknown>, difficulty: { min: number; max: number }): AllowedParams {
  return { exact: Object.fromEntries(Object.entries(params).filter(([k]) => !DEVICE_CHOSEN.has(k))), difficulty };
}
const GAME_LANGS = new Set(["he", "en", "ar", "ru", "fr", "es", "zh"]);

export interface StepRow {
  id: string;
  ordinal: number;
  step_type?: "game" | "video";
  video_id?: string | null;
  game_id: string;
  session_mode: "timed" | "lives" | "timed_lives";
  duration_s: number | null;
  lives: number | null;
  lives_auto: boolean;
  current_difficulty: number;
  hemisphere: "left" | "right";
  timer_position: "left" | "right" | "hidden";
  monochrome: boolean;
  practice: "auto" | "on" | "off";
  trial_window_ms: number | null;
  game_params: Record<string, unknown>;
  /** Brain-region filter (spec 2026-11-09); null = side only. */
  region_id?: string | null;
  sessions_completed: number;
  progression?: Rule | null;
}

/**
 * Platform parameters (§8.2) for one step, plus the game's own settings namespaced by game id.
 * With a brain-region filter (spec 2026-11-09) the table's row decides: `region` carries it, the hemisphere follows the
 * row (cold → right, warm → left), and games that declare `regionUse.background` get their background from it.
 */
export function buildParams(step: StepRow, patient: { preferred_locale: string; colour_vision_deficiency: boolean; date_of_birth?: string | null }, seed: number, regions?: RegionCatalog) {
  const ns = step.game_id.replace(/-/g, "_");
  const own: Record<string, unknown> = { ...step.game_params };
  if (patient.colour_vision_deficiency && GAME_MANIFESTS[step.game_id]?.paramsSchema.properties.cvd_mode) own.cvd_mode = true; // from the patient record (§8.1)
  const resolved = step.region_id && regions ? resolveRegion(regions, step.region_id, seed) : null;
  const hemisphere = resolved?.hemisphere ?? step.hemisphere;
  const bg = resolved ? GAME_MANIFESTS[step.game_id]?.regionUse?.background : undefined;
  if (resolved && bg) {
    own[bg.temperature] = resolved.param.bg_temperature;
    own[bg.type] = resolved.param.bg_types[seededIndex(seed, "bg", resolved.param.bg_types.length)];
  }
  return {
    session_mode: step.session_mode,
    ...(step.duration_s !== null ? { duration_s: step.duration_s } : {}),
    ...(step.lives_auto ? { lives: "auto" as const } : step.lives !== null ? { lives: step.lives } : {}),
    difficulty: step.current_difficulty,
    start_level: "from_difficulty",
    hemisphere,
    // Older steps may hold the v1 same-side value: the corner always follows the hemisphere (ADR 0008).
    timer_position: timerPositionFor(hemisphere, timerShown(step.timer_position)),
    ...(resolved ? { region: resolved.param } : {}),
    // Black and white only for games that support it (ADR 0009).
    monochrome: step.monochrome === true && GAME_MANIFESTS[step.game_id]?.capabilities.monochrome === true,
    trial_window_ms: step.trial_window_ms,
    // "Auto" practice: on for a step's first session, then off.
    practice: step.practice === "auto" ? (step.sessions_completed === 0 ? "on" : "off") : step.practice,
    instructions: step.sessions_completed < 2 ? "always" : "short",
    lang: GAME_LANGS.has(patient.preferred_locale) ? patient.preferred_locale : "en",
    // Only the band, never the birth date (picture-line game spec 2026-11-10).
    age_band: ageBand(patient.date_of_birth, new Date()),
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


export type LaunchRows = {
  row: { id: string; seq: number; week: number; status: string; assignment_id: string; assignment_name: string; total: number; patient_id: string; given_name: string; family_name: string; preferred_locale: string; alert: string | null; colour_vision_deficiency: boolean; planned_date: string; date_of_birth: string | null };
  steps: Array<StepRow & { done: boolean }>;
  videos: Map<string, { id: string; version: number; source: "upload" | "youtube"; youtube_id: string | null; duration_s: number | null; titles: Record<string, string>; sha256: Buffer | null; has_file: boolean; bytes: number | null }>;
};

/** What a launch needs for one planned session, checked (care, consent, active, open); changes nothing. */
export async function loadLaunchRows(db: pg.PoolClient, id: string): Promise<LaunchRows | { error: "not_found" | "forbidden" | "consent_required" | "protocol_not_active" | "session_closed" }> {
  const { rows } = await db.query(
    `SELECT ps.id, ps.seq, ps.week, ps.status, to_char(ps.planned_date, 'YYYY-MM-DD') AS planned_date, a.id AS assignment_id, a.name AS assignment_name, a.status AS assignment_status,
            (SELECT count(*)::int FROM app.planned_session x WHERE x.assignment_id = a.id AND x.status <> 'cancelled') AS total,
            p.id AS patient_id, p.given_name, p.family_name, p.preferred_locale, p.alert, p.colour_vision_deficiency,
            to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
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
    `SELECT s.id, s.ordinal, s.step_type, s.video_id, s.game_id, s.session_mode, s.duration_s, s.lives, s.lives_auto, s.current_difficulty, s.hemisphere, s.timer_position, s.monochrome, s.practice, s.trial_window_ms,
            s.game_params, s.sessions_completed, s.progression, s.region_id,
            CASE WHEN s.step_type = 'video'
                 THEN EXISTS (SELECT 1 FROM app.video_view w WHERE w.planned_session_id = $2 AND w.assignment_step_id = s.id)
                 ELSE EXISTS (SELECT 1 FROM app.game_session g WHERE g.planned_session_id = $2 AND g.assignment_step_id = s.id) END AS done
       FROM app.assignment_step s WHERE s.assignment_id = $1 ORDER BY s.ordinal`,
    [row.assignment_id, id],
  );
  // Videos are played by the app itself: no ticket, just what it needs to show (and later keep) the file.
  const videoIds = steps.rows.filter((s) => s.step_type === "video").map((s) => s.video_id!);
  const videos: LaunchRows["videos"] = new Map();
  if (videoIds.length) {
    const v = await db.query(
      `SELECT v.id, v.version, v.source, v.youtube_id, v.duration_s, f.sha256, f.bytes::int AS bytes, v.file_id IS NOT NULL AS has_file,
              COALESCE((SELECT jsonb_object_agg(i.locale, i.title) FROM app.video_i18n i WHERE i.video_id = v.id), '{}') AS titles
         FROM app.video v LEFT JOIN app.file_object f ON f.id = v.file_id WHERE v.id = ANY($1::uuid[])`,
      [videoIds],
    );
    for (const r of v.rows) videos.set(r.id, r);
  }
  return { row, steps: steps.rows, videos };
}

export function sessionRoutes(pool: pg.Pool, tickets: TicketSigner) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  r.post("/planned-sessions/:id/launch", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const me = c.get("user").id;
    // Launched on a device set up for offline use (the caller holds a space there): tickets name the device, so if
    // the connection drops mid-session anyone who may use the device can send the results (review finding).
    const asked = ((await c.req.json().catch(() => null)) as { device_id?: unknown } | null)?.device_id;
    const result = await run(c, async (db) => {
      const loaded = await loadLaunchRows(db, id);
      if ("error" in loaded) return loaded;
      const dev =
        typeof asked === "string" && UUID.test(asked) && (await db.query<{ ok: boolean }>(`SELECT app.has_space_on($1, app.current_user_id()) AS ok`, [asked])).rows[0]!.ok
          ? asked
          : undefined;
      const { row, steps, videos } = loaded;
      const regions = steps.some((s) => s.region_id) ? await loadRegionCatalog(db) : undefined;
      await db.query(`UPDATE app.planned_session SET status = 'in_progress' WHERE id = $1 AND status = 'planned'`, [id]);
      const pkg: LaunchPackage = {
        planned_session_id: id,
        seq: row.seq,
        week: row.week,
        total: row.total,
        patient: { id: row.patient_id, given_name: row.given_name, family_name: row.family_name, preferred_locale: row.preferred_locale, alert: row.alert },
        assignment: { id: row.assignment_id, name: row.assignment_name },
        steps: steps.map((s): LaunchStep => {
          if (s.step_type === "video") {
            const v = videos.get(s.video_id!)!;
            const vticket = dev
              ? tickets.signV2({ jti: crypto.randomUUID(), psid: id, asid: s.id, pid: row.patient_id, gid: "video", sub: me, dev, allowed: { exact: {}, difficulty: { min: 1, max: 5 } } }, CLINIC_TICKET_TTL_S)
              : undefined;
            return {
              kind: "video",
              assignment_step_id: s.id,
              ordinal: s.ordinal,
              ...(vticket ? { ticket: vticket } : {}),
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
          const ticket = tickets.sign({ jti: crypto.randomUUID(), psid: id, asid: s.id, pid: row.patient_id, gid: s.game_id, ph: paramsHash(params), sub: me, ...(dev ? { dev } : {}) }, CLINIC_TICKET_TTL_S);
          return { kind: "game", assignment_step_id: s.id, ordinal: s.ordinal, game_id: s.game_id, params, ticket, done: s.done };
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

  /** The sender must be the ticket's therapist, or hold an active space on the device an offline ticket was issued to. */
  const uploaderMay = (c: Context<Env>, claims: TicketClaims | TicketClaimsV2) =>
    run(c, async (db) => {
      const { rows } = await db.query<{ ok: boolean }>(
        `SELECT ($1::uuid = app.current_user_id())
             OR ($2::uuid IS NOT NULL AND app.may_use_device($2::uuid, app.current_user_id()) AND app.held_space_on($2::uuid, $1::uuid)) AS ok`,
        [claims.sub, claims.dev ?? null],
      );
      return rows[0]!.ok;
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
    // Valid when played, not when uploaded (spec §7.4): a month offline must not turn results into refusals.
    const checked = tickets.verify(ticket) ? { claims: tickets.verify(ticket)!, validThen: true } : tickets.verifyPlayed(ticket, Date.parse(envelope.started_at ?? ""));
    const claims = checked?.claims ?? null;
    const reject = async (error: string, status: 403 | 422 = 422) => {
      await run(c, (db) => record(db, "rejected", error, { sessionId: envelope.session_id, psid: claims?.psid ?? null, pid: claims?.pid ?? null }));
      return c.json({ error }, status);
    };
    if (!claims) return reject("invalid_ticket");
    if (envelope.demo) return reject("demo_result");
    if (claims.gid !== envelope.game_id) return reject("game_mismatch");
    // v1 (online launch): the exact parameters. v2 (offline package): within what the ticket allows, or kept for review.
    let paramsReason: ReviewReason | null = checked && !checked.validThen ? "ticket_expired" : null;
    if (claims.v === 1) {
      if (paramsHash(envelope.params) !== claims.ph) return reject("params_mismatch");
    } else if (!paramsReason && !paramsWithinAllowed(claims.allowed, envelope.params)) paramsReason = "params_outside_ticket";
    if (!(await uploaderMay(c, claims))) return reject("uploader_not_allowed", 403);

    const receipt = await run(c, (db) => ingest(db, envelope, claims, me, record, paramsReason));
    if ("conflict" in receipt) return c.json({ error: "session_id_reused" }, 409);
    return c.json(receipt, receipt.outcome === "duplicate" ? 200 : 201);
  });

  // A watched video (ADR 0018). The app's UUIDv7 view id makes retries safe; the view is kept once, append-only.
  // Every attempt, accepted or not, also goes to the raw log, as results do (never dropped silently, §9.8).
  r.post("/video-views", async (c) => {
    const raw = await c.req.raw.clone().json().catch(() => null);
    const body = await parseBody(c, videoViewInput);
    const me = c.get("user").id;
    const log = (db: pg.PoolClient, outcome: string, error: string | null, extra: { viewId?: string | null; psid?: string | null; pid?: string | null } = {}) =>
      db.query(
        `INSERT INTO app.session_result_raw (client_session_id, planned_session_id, patient_id, recorded_by, envelope_version, payload, payload_sha256, outcome, error)
         VALUES ($1,$2,$3,$4,'video_view.1',$5,$6,$7,$8)`,
        [extra.viewId ?? null, extra.psid ?? null, extra.pid ?? null, me, JSON.stringify(raw ?? {}), createHash("sha256").update(canonicalJson(raw ?? {})).digest(), outcome, error],
      );
    if (!body.ok) {
      const viewId = (raw as { client_view_id?: unknown } | null)?.client_view_id;
      await run(c, (db) => log(db, "rejected", "invalid_view", { viewId: typeof viewId === "string" && UUID.test(viewId) ? viewId : null }));
      return body.response;
    }
    const v = body.data;
    // Offline views carry the package's v2 ticket for that step: it names the therapist and the device.
    const checked = v.ticket ? (tickets.verify(v.ticket) ? { claims: tickets.verify(v.ticket)!, validThen: true } : tickets.verifyPlayed(v.ticket, Date.parse(v.started_at))) : null;
    const claims = checked?.claims ?? null;
    const expiredReason: ReviewReason | null = checked && !checked.validThen ? "ticket_expired" : null;
    if (v.ticket && (!claims || claims.v !== 2 || claims.asid !== v.assignment_step_id || claims.psid !== v.planned_session_id)) {
      await run(c, (db) => log(db, "rejected", "invalid_ticket", { viewId: v.client_view_id }));
      return c.json({ error: "invalid_ticket" }, 422);
    }
    if (claims && !(await uploaderMay(c, claims))) {
      await run(c, (db) => log(db, "rejected", "uploader_not_allowed", { viewId: v.client_view_id }));
      return c.json({ error: "uploader_not_allowed" }, 403);
    }
    const therapist = claims?.sub ?? me;
    const device = claims?.dev ?? null;
    const result = await run(c, async (db): Promise<{ error: string; status: 404 | 409 | 422 } | VideoViewReceipt> => {
      // Without a ticket nothing server-signed vouches for the view: the sender must be able to treat the patient
      // under their own RLS, as before offline support (invariant 3).
      if (!claims) {
        const mine = await db.query<{ ok: boolean }>(
          `SELECT app.can_treat_patient(ps.patient_id) AS ok FROM app.planned_session ps WHERE ps.id = $1`,
          [v.planned_session_id],
        );
        if (!mine.rows[0]?.ok) {
          await log(db, "rejected", "not_found", { viewId: v.client_view_id });
          return { error: "not_found", status: 404 };
        }
      }
      await db.query(`SELECT app.act_for_ticket($1, $2)`, [therapist, device]);
      const asUploader = () => db.query(`SELECT set_config('app.user_id', $1, true)`, [me]);
      const ps = await db.query<{ status: string; assignment_id: string; patient_id: string; clinic_id: string }>(`SELECT * FROM app.ticket_session($1)`, [v.planned_session_id]);
      const session = ps.rows[0];
      const extra = { viewId: v.client_view_id, psid: session ? v.planned_session_id : null, pid: session?.patient_id ?? null };
      if (!session) {
        await asUploader();
        await log(db, "rejected", "not_found", extra);
        return { error: "not_found", status: 404 };
      }
      const stored = (await db.query<{ s: string | null }>(`SELECT app.ticket_stored_step('video', $1) AS s`, [v.client_view_id])).rows[0]!.s;
      if (stored) {
        await asUploader();
        if (stored !== v.assignment_step_id) {
          await log(db, "conflict", "view_id_reused", extra);
          return { error: "view_id_reused", status: 409 };
        }
        await log(db, "duplicate", null, extra);
        return { outcome: "duplicate", planned_session_status: session.status, review_reason: null };
      }
      const step = await db.query<{ step_type: string; video_id: string | null; assignment_id: string }>(`SELECT step_type, video_id, assignment_id FROM app.ticket_step($1)`, [v.assignment_step_id]);
      const s = step.rows[0];
      if (!s || s.assignment_id !== session.assignment_id || s.step_type !== "video" || s.video_id !== v.video_id) {
        await asUploader();
        await log(db, "rejected", "step_mismatch", extra);
        return { error: "step_mismatch", status: 422 };
      }
      let reason = expiredReason ?? (await db.query<{ r: ReviewReason | null }>(`SELECT app.review_reason_for($1,$2,$3,$4) AS r`, [session.patient_id, therapist, v.assignment_step_id, v.planned_session_id])).rows[0]!.r;
      if (!reason && (await db.query<{ p: boolean }>(`SELECT app.ticket_step_played('video', $1, $2) AS p`, [v.planned_session_id, v.assignment_step_id])).rows[0]!.p) reason = "played_twice";
      const { ticket: _t, ...view } = v;
      await db.query(`SELECT app.ingest_video_view($1::jsonb)`, [JSON.stringify({ ...view, patient_id: session.patient_id, review_reason: reason })]);
      const status = reason ? session.status : await closeIfComplete(db, v.planned_session_id);
      await asUploader();
      await log(db, reason ? "kept_for_review" : "accepted", reason, extra);
      return { outcome: reason ? "kept_for_review" : "accepted", planned_session_status: status, review_reason: reason };
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result, result.outcome === "duplicate" ? 200 : 201);
  });

  // Reviewing a flagged result or view (spec §7.4): an append-only decision; the latest one counts.
  for (const [path, column, table] of [["/results/:id/review", "game_session_id", "game_session"], ["/video-views/:id/review", "video_view_id", "video_view"]] as const) {
    r.post(path, async (c) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
      const body = (await c.req.json().catch(() => null)) as { decision?: unknown; note?: unknown } | null;
      const decision = body?.decision;
      const note = typeof body?.note === "string" ? body.note.slice(0, 1000) : null;
      const out = await run(c, async (db) => {
        const target = await db.query<{ ok: boolean }>(`SELECT app.can_treat_patient(patient_id) AS ok FROM app.${table} WHERE id = $1`, [id]);
        if (!target.rows[0]?.ok) return "not_found" as const;
        if (decision !== "accept" && decision !== "exclude") return "invalid" as const;
        await db.query(`INSERT INTO app.result_review (${column}, decision, decided_by, note) VALUES ($1, $2, app.current_user_id(), $3)`, [id, decision, note]);
        return "ok" as const;
      });
      if (out === "not_found") return c.json({ error: "not_found" }, 404);
      if (out === "invalid") return c.json({ error: "invalid", issues: [{ path: "decision", code: "invalid_value" }] }, 400);
      return c.json({ decision }, 201);
    });
  }

  r.get("/patients/:id/sessions", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const sessions = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return null;
      const { rows } = await db.query<GameSessionView>(
        `SELECT g.id, g.game_id, g.status, g.session_mode, g.difficulty, g.hemisphere, g.started_at, g.ended_at, g.active_ms,
                g.accuracy::float8 AS accuracy, g.rt_median_ms, g.trials_total, g.correct, g.errors, g.lives_lost, g.highest_level,
                g.planned_session_id, ps.seq, g.metrics, COALESCE((g.config_echo->>'monochrome')::boolean, false) AS monochrome,
                CASE WHEN g.config_echo ? 'region' THEN jsonb_build_object('path', g.config_echo->'region'->'path', 'sublobe', g.config_echo->'region'->'sublobe',
                  'drawn', g.config_echo->'region'->'drawn', 'revision', g.config_echo->'region'->'revision') END AS region,
                r.counts, CASE WHEN r.review_reason IS NULL THEN NULL ELSE json_build_object('reason', r.review_reason, 'decision', r.decision) END AS review
           FROM app.game_session g LEFT JOIN app.planned_session ps ON ps.id = g.planned_session_id
           JOIN app.game_session_review r ON r.id = g.id
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
  claims: TicketClaims | TicketClaimsV2,
  me: string,
  record: (db: pg.PoolClient, outcome: string, error: string | null, extra: { sessionId?: string | null; psid?: string | null; pid?: string | null }) => Promise<unknown>,
  paramsReason: ReviewReason | null,
): Promise<ResultReceipt | { conflict: true }> {
  const extra = { sessionId: e.session_id, psid: claims.psid, pid: claims.pid };
  // Act for the therapist the (verified) ticket names; the raw log is written back as the sender.
  await db.query(`SELECT app.act_for_ticket($1, $2)`, [claims.sub, claims.dev ?? null]);
  const asUploader = () => db.query(`SELECT set_config('app.user_id', $1, true)`, [me]);
  const sessionStatus = async () => (await db.query<{ status: string }>(`SELECT status FROM app.ticket_session($1)`, [claims.psid])).rows[0]?.status ?? null;

  const stored = (await db.query<{ s: string | null }>(`SELECT app.ticket_stored_step('game', $1) AS s`, [e.session_id])).rows[0]!.s;
  if (stored) {
    // Already stored (a retry after a lost response, or the outbox sending twice): same answer, nothing new.
    const status = await sessionStatus();
    await asUploader();
    if (stored !== claims.asid) {
      await record(db, "conflict", "session_id_reused", extra);
      return { conflict: true };
    }
    await record(db, "duplicate", null, extra);
    return { outcome: "duplicate", session_id: e.session_id, progression: null, planned_session_status: status, review_reason: null };
  }

  let reason: ReviewReason | null =
    paramsReason ?? (await db.query<{ r: ReviewReason | null }>(`SELECT app.review_reason_for($1,$2,$3,$4) AS r`, [claims.pid, claims.sub, claims.asid, claims.psid])).rows[0]!.r;
  if (!reason && claims.v === 2 && (await stepChanged(db, claims))) reason = "step_changed";
  if (!reason && (await db.query<{ p: boolean }>(`SELECT app.ticket_step_played('game', $1, $2) AS p`, [claims.psid, claims.asid])).rows[0]!.p) reason = "played_twice";

  const p = e.params as Record<string, unknown>;
  const metrics = e.metrics as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const row = {
    id: e.session_id, patient_id: claims.pid, assignment_step_id: claims.asid, planned_session_id: claims.psid, review_reason: reason,
    game_id: e.game_id, game_version: e.game_version, status: e.status, end_reason: e.end_reason, session_mode: e.mode, difficulty: p.difficulty,
    hemisphere: p.hemisphere, started_at: e.started_at, ended_at: e.ended_at, active_ms: e.active_ms, paused_ms: e.paused_ms,
    lives_start: e.lives_start, lives_lost: e.lives_lost, lives_remaining: e.lives_remaining,
    trials_total: e.std.trials_total, correct: e.std.correct, errors: e.std.errors, timeouts: e.std.timeouts, accuracy: e.std.accuracy,
    rt_median_ms: e.std.rt_median_ms !== null ? Math.round(e.std.rt_median_ms) : null, rt_mean_ms: e.std.rt_mean_ms !== null ? Math.round(e.std.rt_mean_ms) : null,
    left_accuracy: e.std.left_accuracy, right_accuracy: e.std.right_accuracy, highest_level: num(metrics.highest_level), levels_completed: num(metrics.levels_completed),
    metrics: e.metrics, std: e.std, levels: e.levels, config_echo: e.params,
  };
  const inserted = (await db.query<{ id: string | null }>(`SELECT app.ingest_game_session($1::jsonb) AS id`, [JSON.stringify(row)])).rows[0]!.id;
  if (!inserted) {
    const status = await sessionStatus();
    await asUploader();
    await record(db, "duplicate", null, extra);
    return { outcome: "duplicate", session_id: e.session_id, progression: null, planned_session_status: status, review_reason: null };
  }

  let progression: ResultReceipt["progression"] = null;
  if (!reason && e.status !== "abandoned") {
    const step = await db.query<{ current_difficulty: number; progression: Rule | null; set_after_ticket: boolean }>(
      `UPDATE app.assignment_step SET sessions_completed = sessions_completed + 1 WHERE id = $1
       RETURNING current_difficulty, progression, (difficulty_set_at IS NOT NULL AND difficulty_set_at > to_timestamp($2)) AS set_after_ticket`,
      [claims.asid, claims.iat],
    );
    const s = step.rows[0];
    // A difficulty the therapist set by hand after this ticket was issued wins over a late result.
    if (s && !s.set_after_ticket) {
      const history = await db.query<{ accuracy: number | null; difficulty: number; valid: boolean }>(
        `SELECT g.accuracy::float8 AS accuracy, g.difficulty, (g.is_valid AND g.status <> 'abandoned') AS valid
           FROM app.game_session g JOIN app.game_session_review r ON r.id = g.id
          WHERE g.assignment_step_id = $1 AND r.counts ORDER BY g.ended_at, g.id`,
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
  const status = reason ? await sessionStatus() : await closeIfComplete(db, claims.psid);
  await asUploader();
  await record(db, reason ? "kept_for_review" : "accepted", reason, extra);
  return { outcome: reason ? "kept_for_review" : "accepted", session_id: e.session_id, progression, planned_session_status: status, review_reason: reason };
}

/** Whether the step's defining settings differ now from what an offline ticket allowed (edited while the device was away). */
async function stepChanged(db: pg.PoolClient, claims: TicketClaimsV2): Promise<boolean> {
  const { rows } = await db.query<StepRow>(`SELECT * FROM app.ticket_step($1)`, [claims.asid]);
  const step = rows[0];
  if (!step || step.step_type === "video" || step.game_id !== claims.gid) return true;
  const now = buildParams(step, { preferred_locale: "en", colour_vision_deficiency: false }, 0);
  const ns = `${step.game_id.replace(/-/g, "_")}.`;
  const exact = claims.allowed.exact;
  const was = (exact.region as { path?: string } | undefined)?.path ?? null;
  // The filter as a launch would resolve it now: a region whose row is gone launches side only (null), as buildParams does.
  const cat = step.region_id ? await loadRegionCatalog(db) : null;
  const nowPath = cat && step.region_id && resolveRegion(cat, step.region_id, 0) ? cat.byId.get(step.region_id)!.path : null;
  if (nowPath === null && was === null) {
    const keys = [...STRUCTURAL, ...Object.keys(now).filter((k) => k.startsWith(ns) && k !== `${ns}cvd_mode`)];
    return keys.some((k) => JSON.stringify((now as Record<string, unknown>)[k] ?? null) !== JSON.stringify(exact[k] ?? null));
  }
  // A filtered step (spec 2026-11-09 §6): compare the filter the therapist chose, not what it resolved to. The hemisphere,
  // timer corner, drawn sub-lobe, row revision and the row-driven background legitimately differ between packages.
  if (nowPath !== was) return true;
  if (timerShown(step.timer_position) !== (exact.timer_position !== "hidden")) return true;
  const bg = GAME_MANIFESTS[step.game_id]?.regionUse?.background;
  const fromRow = new Set(bg ? [`${ns}${bg.temperature}`, `${ns}${bg.type}`] : []);
  const keys = [...STRUCTURAL.filter((k) => k !== "hemisphere" && k !== "timer_position" && k !== "region"), ...Object.keys(now).filter((k) => k.startsWith(ns) && k !== `${ns}cvd_mode` && !fromRow.has(k))];
  return keys.some((k) => JSON.stringify((now as Record<string, unknown>)[k] ?? null) !== JSON.stringify(exact[k] ?? null));
}

/** The planned session is done once every game has a result and every video a view. Returns its status. */
async function closeIfComplete(db: pg.PoolClient, psid: string): Promise<string | null> {
  const ps = await db.query<{ status: string }>(
    `WITH missing AS (
       SELECT count(*) AS n FROM app.assignment_step s
        JOIN app.planned_session x ON x.assignment_id = s.assignment_id AND x.id = $1
        WHERE (s.step_type = 'game'  AND NOT EXISTS (SELECT 1 FROM app.game_session g WHERE g.planned_session_id = $1 AND g.assignment_step_id = s.id))
           OR (s.step_type = 'video' AND NOT EXISTS (SELECT 1 FROM app.video_view w WHERE w.planned_session_id = $1 AND w.assignment_step_id = s.id)))
     UPDATE app.planned_session ps
        SET status = CASE WHEN (SELECT n FROM missing) = 0 THEN 'done' ELSE 'in_progress' END,
            completed_at = CASE WHEN (SELECT n FROM missing) = 0 THEN now() ELSE NULL END
      WHERE ps.id = $1 AND ps.status IN ('planned', 'in_progress')
      RETURNING status`,
    [psid],
  );
  return ps.rows[0]?.status ?? null;
}
