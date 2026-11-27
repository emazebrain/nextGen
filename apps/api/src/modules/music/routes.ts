/**
 * Uploaded session music (migration 0050). Staff upload recorded tracks and say which hemisphere each is for; the
 * session player uses them in place of the generated tunes. A track's scope decides who gets it: platform (every
 * clinic), organization, clinic, or personal (the uploading therapist's own patients). Row-level security decides
 * who may list, add, rename and remove; this module only shapes requests and stores the file.
 *
 * No patient data here: a title, a hemisphere and an audio file.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import { withUser, type Env } from "../../context.ts";
import { FileTooLarge, type FileStore } from "../../files.ts";
import { UUID } from "../patients/routes.ts";
import { parseRange } from "../videos/routes.ts";

export const MUSIC_SCOPES = ["platform", "organization", "clinic", "personal"] as const;
export type MusicScope = (typeof MUSIC_SCOPES)[number];
/** Audio formats browsers play. */
const MUSIC_MIME: Record<string, string> = {
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "audio/aac": "aac",
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/ogg": "ogg", "audio/webm": "webm",
};
export const MUSIC_MAX_BYTES = 20 * 1024 * 1024;

const COLUMNS = `t.id, t.scope, t.hemisphere, t.title, t.bytes, t.mime, t.clinic_id, t.organization_id,
                 t.owner_user_id = app.current_user_id() AS mine, COALESCE(u.full_name, '') AS uploaded_by,
                 app.can_manage_music(t.scope, t.organization_id, t.clinic_id, t.owner_user_id) AS can_manage,
                 to_char(t.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS created_at`;

/** The most specific level wins: a therapist's own tracks before the clinic's, the clinic's before the organization's… */
const RANK: Record<string, number> = { personal: 0, clinic: 1, organization: 2, platform: 3 };

export interface SessionTrack {
  id: string;
  hemisphere: "left" | "right";
  title: string;
}

/**
 * The uploaded tracks a patient's session plays, per hemisphere: those of the most specific level that has any for
 * that side. Empty when nothing was uploaded — the player then uses the generated tunes. Must run as the signed-in
 * user (staff who can see the patient, or the child's guardian).
 */
export async function sessionTracks(db: pg.PoolClient, patientId: string): Promise<SessionTrack[]> {
  const { rows } = await db.query<{ id: string; scope: string; hemisphere: "left" | "right"; title: string }>(`SELECT id, scope, hemisphere, title FROM app.session_music($1)`, [patientId]);
  const out: SessionTrack[] = [];
  for (const side of ["left", "right"] as const) {
    const mine = rows.filter((r) => r.hemisphere === side);
    if (mine.length === 0) continue;
    const best = Math.min(...mine.map((r) => RANK[r.scope] ?? 9));
    for (const r of mine) if ((RANK[r.scope] ?? 9) === best) out.push({ id: r.id, hemisphere: r.hemisphere, title: r.title });
  }
  return out;
}

export function musicRoutes(pool: pg.Pool, files: FileStore) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

  // What the signed-in user can see around one clinic (or, with no clinic, everything they can see), and the levels
  // they may upload to there.
  r.get("/music", async (c) => {
    const clinic = c.req.query("clinic");
    if (clinic && !UUID.test(clinic)) return c.json({ error: "invalid", issues: [{ path: "clinic", code: "invalid_uuid" }] }, 400);
    const data = await run(c, async (db) => {
      const tracks = await db.query(
        `SELECT ${COLUMNS}
           FROM app.music_track t LEFT JOIN app.app_user u ON u.id = t.owner_user_id
          WHERE $1::uuid IS NULL OR t.scope = 'platform' OR t.clinic_id = $1 OR (t.scope = 'organization' AND t.organization_id = app.clinic_org($1))
          ORDER BY t.hemisphere, t.created_at, t.id`,
        [clinic ?? null],
      );
      const can = await db.query<{ platform: boolean; organization: boolean; clinic: boolean; personal: boolean; org: string | null }>(
        `SELECT app.is_platform_admin() AS platform,
                ($1::uuid IS NOT NULL AND app.can_manage_music('organization', app.clinic_org($1), NULL, app.current_user_id())) AS organization,
                ($1::uuid IS NOT NULL AND app.can_manage_music('clinic', app.clinic_org($1), $1, app.current_user_id())) AS clinic,
                ($1::uuid IS NOT NULL AND app.can_manage_music('personal', app.clinic_org($1), $1, app.current_user_id())) AS personal`,
        [clinic ?? null],
      );
      const levels = MUSIC_SCOPES.filter((s) => can.rows[0]![s]);
      return { tracks: tracks.rows, upload_scopes: levels };
    });
    return c.json(data);
  });

  // Upload: the audio file is the body; where it goes, its hemisphere and its title are in the address. The uploader
  // must confirm they hold the rights to use the music.
  r.post("/music", async (c) => {
    const q = (k: string) => (c.req.query(k) ?? "").trim();
    const scope = q("scope") as MusicScope;
    const hemisphere = q("hemisphere");
    const title = q("title");
    const clinic = q("clinic") || null;
    const issues: { path: string; code: string }[] = [];
    if (!MUSIC_SCOPES.includes(scope)) issues.push({ path: "scope", code: "invalid_value" });
    if (hemisphere !== "left" && hemisphere !== "right") issues.push({ path: "hemisphere", code: "invalid_value" });
    if (title.length < 1 || title.length > 120) issues.push({ path: "title", code: "invalid_length" });
    if (scope !== "platform" && (!clinic || !UUID.test(clinic))) issues.push({ path: "clinic", code: "required" });
    if (issues.length) return c.json({ error: "invalid", issues }, 400);
    if (q("rights") !== "confirmed") return c.json({ error: "rights_required" }, 400);

    const mime = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    const ext = MUSIC_MIME[mime];
    if (!ext) return c.json({ error: "unsupported_type" }, 415);
    if (Number(c.req.header("content-length") ?? "0") > MUSIC_MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "empty_file" }, 400);

    // Check the level is theirs to upload to before taking the file.
    const where = await run(c, async (db) => {
      const { rows } = await db.query<{ org: string | null; ok: boolean }>(
        `SELECT app.clinic_org($2) AS org, app.can_manage_music($1, app.clinic_org($2), CASE WHEN $1 = 'organization' THEN NULL ELSE $2::uuid END, app.current_user_id()) AS ok`,
        [scope, scope === "platform" ? null : clinic],
      );
      return rows[0]!;
    });
    if (!where.ok || (scope !== "platform" && !where.org)) return c.json({ error: "forbidden" }, 403);

    const key = `music/${randomUUID()}.${ext}`;
    let stored: { bytes: number; sha256: Buffer };
    try {
      stored = await files.put(key, body, MUSIC_MAX_BYTES);
    } catch (err) {
      if (err instanceof FileTooLarge) return c.json({ error: "file_too_large" }, 413);
      throw err;
    }
    if (stored.bytes === 0) {
      await files.remove(key);
      return c.json({ error: "empty_file" }, 400);
    }
    try {
      const track = await run(c, async (db) => {
        const ins = await db.query<{ id: string }>(
          `INSERT INTO app.music_track (scope, organization_id, clinic_id, owner_user_id, hemisphere, title, storage_key, sha256, bytes, mime)
           VALUES ($1, $2, $3, app.current_user_id(), $4, $5, $6, $7, $8, $9) RETURNING id`,
          [scope, scope === "platform" ? null : where.org, scope === "clinic" || scope === "personal" ? clinic : null, hemisphere, title, key, stored.sha256, stored.bytes, mime],
        );
        const { rows } = await db.query(`SELECT ${COLUMNS} FROM app.music_track t LEFT JOIN app.app_user u ON u.id = t.owner_user_id WHERE t.id = $1`, [ins.rows[0]!.id]);
        return rows[0];
      });
      return c.json({ track }, 201);
    } catch (err) {
      await files.remove(key); // nothing points at the file: do not keep it
      throw err;
    }
  });

  // Rename, or move to the other hemisphere.
  r.patch("/music/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = (await c.req.json().catch(() => null)) as { title?: unknown; hemisphere?: unknown } | null;
    const title = typeof body?.title === "string" ? body.title.trim() : undefined;
    const hemisphere = body?.hemisphere;
    if ((title !== undefined && (title.length < 1 || title.length > 120)) || (hemisphere !== undefined && hemisphere !== "left" && hemisphere !== "right") || (title === undefined && hemisphere === undefined))
      return c.json({ error: "invalid", issues: [{ path: title === undefined ? "hemisphere" : "title", code: "invalid_value" }] }, 400);
    const track = await run(c, async (db) => {
      const res = await db.query(`UPDATE app.music_track SET title = COALESCE($2, title), hemisphere = COALESCE($3, hemisphere) WHERE id = $1`, [id, title ?? null, hemisphere ?? null]);
      if (res.rowCount === 0) return null;
      const { rows } = await db.query(`SELECT ${COLUMNS} FROM app.music_track t LEFT JOIN app.app_user u ON u.id = t.owner_user_id WHERE t.id = $1`, [id]);
      return rows[0] ?? null;
    });
    return track ? c.json({ track }) : notFound(c);
  });

  r.delete("/music/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const key = await run(c, async (db) => {
      const res = await db.query<{ storage_key: string }>(`DELETE FROM app.music_track WHERE id = $1 RETURNING storage_key`, [id]);
      return res.rows[0]?.storage_key ?? null;
    });
    if (!key) return notFound(c);
    await files.remove(key).catch(() => undefined); // the row is gone; a leftover file is unreachable
    return c.json({ ok: true });
  });

  /** The audio itself, for staff who can see the track and for the guardian of a child whose sessions play it. */
  const getFile = async (c: Context<Env>) => {
    const id = c.req.param("id") ?? "";
    if (!UUID.test(id)) return notFound(c);
    const file = await run(c, async (db) => (await db.query<{ storage_key: string; mime: string; bytes: string }>(`SELECT storage_key, mime, bytes FROM app.music_file($1)`, [id])).rows[0]);
    if (!file) return notFound(c);
    const size = Number(file.bytes);
    const range = parseRange(c.req.header("range"), size);
    const headers = { "content-type": file.mime, "accept-ranges": "bytes", "cache-control": "private, max-age=3600" };
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    const opened = await files.open(file.storage_key, range ?? undefined);
    if (!opened) return notFound(c);
    if (!range) return new Response(opened.stream, { status: 200, headers: { ...headers, "content-length": String(size) } });
    return new Response(opened.stream, { status: 206, headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${size}` } });
  };
  r.get("/music/:id/file", getFile);

  return Object.assign(r, { getFile });
}
