/**
 * The offline bundle (offline devices spec §7.3–7.4, §8.3; ADR 0019): everything a therapist's space on a device
 * holds, so the app can open Today, the caseload and protocols and run sessions with no connection. Building it
 * changes no session state. Session packages carry 30-day v2 tickets bound to the caller and the device.
 */
import { Hono } from "hono";
import type pg from "pg";
import { randomInt, randomUUID } from "node:crypto";
import type {
  AssignmentView,
  LibraryManifest,
  LaunchVideoStep,
  OfflineBundle,
  OfflineVideoRef,
  PackageGameStep,
  PatientDetail,
  PatientListItem,
  SessionPackage,
} from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import type { TicketSigner } from "../../tickets.ts";
import { loadPatient, UUID } from "../patients/routes.ts";
import { listTemplates, loadAssignment, todayItems } from "../protocols/routes.ts";
import { allowedParamsFor, buildParams, loadLaunchRows, OFFLINE_TICKET_TTL_S } from "../sessions/routes.ts";
import { pick } from "../videos/routes.ts";

/** At least this many upcoming sessions per assignment, plus every one in the next PACKAGE_DAYS days. */
export const PACKAGE_MIN_SESSIONS = 4;
export const PACKAGE_DAYS = 14;
const LANGS = new Set(["he", "en", "ar", "ru", "fr", "es", "zh"]);

const fileUrl = (id: string, version: number) => `/v1/videos/${id}/file?v=${version}`;

export function offlineRoutes(pool: pg.Pool, tickets: TicketSigner) {
  const r = new Hono<Env>();
  const run = <T>(c: { get: (k: "user" | "requestId") => any }, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  r.get("/offline/bundle", async (c) => {
    const device = c.req.query("device") ?? "";
    const clinicParam = c.req.query("clinic");
    const lang = LANGS.has(c.req.query("lang") ?? "") ? c.req.query("lang")! : "en";
    if (!UUID.test(device) || (clinicParam !== undefined && !UUID.test(clinicParam))) return c.json({ error: "invalid" }, 400);
    const user = c.get("user");
    const result = await run(c, async (db): Promise<OfflineBundle | { error: string; status: 400 | 409 }> => {
      // The space decides the clinic: a bundle is only for a device the caller has set up (spec §7.3).
      const spaces = await db.query<{ clinic_id: string }>(
        `SELECT clinic_id FROM app.device_space WHERE device_id = $1 AND user_id = app.current_user_id() AND ended_at IS NULL`,
        [device],
      );
      const clinics = spaces.rows.map((s) => s.clinic_id);
      if (!clinics.length) return { error: "no_space", status: 409 };
      const clinic = clinicParam ?? (clinics.length === 1 ? clinics[0]! : null);
      if (!clinic) return { error: "clinic_required", status: 400 };
      if (!clinics.includes(clinic)) return { error: "no_space", status: 409 };

      const memberships = await db.query(
        `SELECT m.clinic_id, m.organization_id, m.role, c.name AS clinic_name
           FROM app.membership m LEFT JOIN app.clinic c ON c.id = m.clinic_id
          WHERE m.user_id = app.current_user_id() AND m.status = 'active' ORDER BY c.name NULLS FIRST`,
      );
      const admin = await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`);

      // Caseload: the caller's own patients in this clinic who may play (consent in place).
      const caseload = (
        await db.query<PatientListItem>(
          `SELECT p.id, p.clinic_id, p.given_name, p.family_name, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                  p.status, p.alert IS NOT NULL AND p.alert <> '' AS has_alert, p.deleted_at IS NOT NULL AS archived
             FROM app.patient p
            WHERE p.clinic_id = $1 AND p.deleted_at IS NULL AND app.patient_can_play(p.id)
              AND EXISTS (SELECT 1 FROM app.patient_care_team t WHERE t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL)
            ORDER BY p.family_name, p.given_name`,
          [clinic],
        )
      ).rows;
      const ids = caseload.map((p) => p.id);
      const patients: Record<string, PatientDetail> = {};
      const assignments: AssignmentView[] = [];
      for (const id of ids) {
        const detail = await loadPatient(db, id);
        if (detail) patients[id] = detail;
        const a = await loadAssignment(db, id);
        if (a) assignments.push(a);
      }

      // Upcoming sessions: the next PACKAGE_MIN_SESSIONS of each active assignment, and all within PACKAGE_DAYS.
      const upcoming = (
        await db.query<{ id: string }>(
          `SELECT id FROM (
             SELECT ps.id, ps.planned_date, ps.seq, row_number() OVER (PARTITION BY ps.assignment_id ORDER BY ps.seq) AS n
               FROM app.planned_session ps JOIN app.protocol_assignment a ON a.id = ps.assignment_id AND a.status = 'active'
              WHERE ps.patient_id = ANY($1::uuid[]) AND ps.status IN ('planned', 'in_progress') AND ps.location = 'clinic'
           ) x WHERE n <= $2 OR planned_date <= current_date + $3::int
           ORDER BY planned_date, seq`,
          [ids, PACKAGE_MIN_SESSIONS, PACKAGE_DAYS],
        )
      ).rows;
      const packages: SessionPackage[] = [];
      const videos = new Map<string, OfflineVideoRef>();
      // Each game step's recent counted results (shared by all its packages): the device's progression input.
      const histories = new Map<string, PackageGameStep["history"]>();
      const historyOf = async (stepId: string) => {
        if (!histories.has(stepId)) {
          const h = await db.query<PackageGameStep["history"][number]>(
            `SELECT accuracy, difficulty, valid FROM (
               SELECT g.accuracy::float8 AS accuracy, g.difficulty, (g.is_valid AND g.status <> 'abandoned') AS valid, g.ended_at, g.id
                 FROM app.game_session g JOIN app.game_session_review r ON r.id = g.id
                WHERE g.assignment_step_id = $1 AND r.counts ORDER BY g.ended_at DESC, g.id DESC LIMIT 20) x
             ORDER BY ended_at, id`,
            [stepId],
          );
          histories.set(stepId, h.rows);
        }
        return histories.get(stepId)!;
      };
      for (const { id } of upcoming) {
        const loaded = await loadLaunchRows(db, id);
        if ("error" in loaded) continue; // e.g. consent or care changed between the two queries
        const { row, steps, videos: vids } = loaded;
        for (const s of steps) if (s.step_type !== "video") await historyOf(s.id);
        packages.push({
          planned_session_id: id,
          planned_date: row.planned_date,
          seq: row.seq,
          week: row.week,
          total: row.total,
          patient: { id: row.patient_id, given_name: row.given_name, family_name: row.family_name, preferred_locale: row.preferred_locale, alert: row.alert },
          assignment: { id: row.assignment_id, name: row.assignment_name },
          steps: steps.map((s): PackageGameStep | LaunchVideoStep => {
            if (s.step_type === "video") {
              const v = vids.get(s.video_id!)!;
              const url = v.source === "upload" && v.has_file ? fileUrl(v.id, v.version) : null;
              if (url && v.sha256) videos.set(v.id, { id: v.id, version: v.version, sha256: v.sha256.toString("hex"), bytes: v.bytes ?? 0, file_url: url });
              // A ticket on the view too: whoever later sends it from this device, it is credited to the caller.
              const vticket = tickets.signV2({ jti: randomUUID(), psid: id, asid: s.id, pid: row.patient_id, gid: "video", sub: user.id, dev: device, allowed: { exact: {}, difficulty: { min: 1, max: 5 } } }, OFFLINE_TICKET_TTL_S);
              return {
                kind: "video",
                assignment_step_id: s.id,
                ordinal: s.ordinal,
                ticket: vticket,
                video: { id: v.id, version: v.version, source: v.source, youtube_id: v.youtube_id, duration_s: v.duration_s, title: pick(v.titles, row.preferred_locale) ?? "", file_url: url, sha256: v.sha256 ? v.sha256.toString("hex") : null },
                done: s.done,
              };
            }
            const base = buildParams(s, row, randomInt(1, 2 ** 31));
            const allowed = allowedParamsFor(base, { min: 1, max: 5 });
            const ticket = tickets.signV2({ jti: randomUUID(), psid: id, asid: s.id, pid: row.patient_id, gid: s.game_id, sub: user.id, dev: device, allowed }, OFFLINE_TICKET_TTL_S);
            return {
              kind: "game",
              assignment_step_id: s.id,
              ordinal: s.ordinal,
              game_id: s.game_id,
              ticket,
              allowed,
              base_params: base,
              practice_setting: s.practice,
              sessions_completed: s.sessions_completed,
              progression: s.progression ?? null,
              difficulty: s.current_difficulty,
              history: histories.get(s.id) ?? [],
              done: s.done,
            };
          }),
        });
      }

      // Spaces on this device that were ended in the last 30 days (the offline window): the device removes them.
      const ended = await db.query<{ id: string }>(`SELECT id FROM app.ended_spaces_on_device($1) AS id`, [device]);
      await db.query(`SELECT app.record_audit('export', 'offline_bundle', NULL, NULL, $1)`, [clinic]);
      return {
        generated_at: new Date().toISOString(),
        me: { user: { id: user.id, email: user.email, name: user.name }, memberships: memberships.rows, is_platform_admin: admin.rows[0]!.a },
        today: (await todayItems(db, clinic, null, lang)).filter((t) => ids.includes(t.patient.id)),
        caseload,
        patients,
        templates: await listTemplates(db, clinic, lang),
        assignments,
        packages,
        videos: [...videos.values()],
        ended_spaces: ended.rows.map((e) => e.id),
      };
    });
    if ("error" in result) return c.json({ error: result.error }, result.status);
    return c.json(result);
  });

  // Every published uploaded video with a file: what "Download everything" adds (spec §7.2).
  r.get("/offline/library", async (c) => {
    const videos = await run(c, async (db) => {
      const { rows } = await db.query<{ id: string; version: number; sha256: Buffer; bytes: number }>(
        `SELECT v.id, v.version, f.sha256, f.bytes::int AS bytes
           FROM app.video v JOIN app.file_object f ON f.id = v.file_id
          WHERE v.status = 'published' AND v.source = 'upload'
          ORDER BY v.id`,
      );
      return rows.map((r): OfflineVideoRef => ({ id: r.id, version: r.version, sha256: r.sha256.toString("hex"), bytes: r.bytes, file_url: fileUrl(r.id, r.version) }));
    });
    const out: LibraryManifest = { videos };
    return c.json(out);
  });

  return r;
}
