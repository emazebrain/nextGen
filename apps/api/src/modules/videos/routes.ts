/**
 * The video library (design doc §7, ADR 0018). Everyone signed in reads the brain-region tree and published videos;
 * platform admins add videos (YouTube links or uploaded files), tag them by region and publish them. Writes are
 * guarded by RLS (only platform admins), and checked up front so an upload is refused before any byte is stored.
 */
import { loadRegions } from "../../regions.ts";
import { Hono, type Context } from "hono";
import type pg from "pg";
import { randomUUID } from "node:crypto";
import {
  VIDEO_MAX_BYTES,
  VIDEO_MIME,
  videoInput,
  youtubeId,
  type BrainRegion,
  type VideoInput,
  type VideoSummary,
} from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { FileTooLarge, type FileStore } from "../../files.ts";
import { parseBody } from "../../validate.ts";
import { UUID } from "../patients/routes.ts";

class NeedsFile extends Error {}

const LANGS = new Set(["en", "he", "ar", "ru", "fr", "es", "zh"]);
const langOf = (c: Context) => {
  const l = c.req.query("lang");
  return l && LANGS.has(l) ? l : "en";
};

/** Text in the asked language, then English, then Hebrew, then whatever there is. */
export function pick(texts: Record<string, string>, lang: string): string | null {
  for (const l of [lang, "en", "he"]) if (texts[l]) return texts[l];
  return Object.values(texts).find(Boolean) ?? null;
}

const SUMMARY_SQL = `
  SELECT v.id, v.source, v.youtube_id, v.duration_s, v.age_min, v.age_max, v.status, v.version, v.file_id IS NOT NULL AS has_file,
         COALESCE((SELECT jsonb_object_agg(i.locale, i.title) FROM app.video_i18n i WHERE i.video_id = v.id), '{}') AS titles,
         COALESCE((SELECT jsonb_object_agg(i.locale, i.description) FROM app.video_i18n i WHERE i.video_id = v.id AND i.description IS NOT NULL), '{}') AS descriptions,
         COALESCE((SELECT json_agg(json_build_object('id', r.id, 'kind', r.kind, 'code', r.code, 'path', r.path) ORDER BY r.path)
                     FROM app.video_region vr JOIN app.brain_region r ON r.id = vr.region_id WHERE vr.video_id = v.id), '[]') AS regions
    FROM app.video v`;

type Row = Omit<VideoSummary, "title" | "description" | "needs_internet">;

export function toSummary(r: Row, lang: string): VideoSummary {
  return { ...r, title: pick(r.titles as Record<string, string>, lang) ?? "", description: pick(r.descriptions as Record<string, string>, lang), needs_internet: r.source === "youtube" };
}

export async function loadVideo(db: pg.PoolClient, id: string, lang: string): Promise<VideoSummary | null> {
  const { rows } = await db.query<Row>(`${SUMMARY_SQL} WHERE v.id = $1`, [id]);
  return rows[0] ? toSummary(rows[0], lang) : null;
}

const isAdmin = async (db: pg.PoolClient) => (await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`)).rows[0]!.a;

async function writeTexts(db: pg.PoolClient, id: string, input: VideoInput) {
  await db.query(`DELETE FROM app.video_i18n WHERE video_id = $1`, [id]);
  for (const [locale, title] of Object.entries(input.titles)) {
    if (!title?.trim()) continue;
    const description = input.descriptions?.[locale as keyof typeof input.titles]?.trim() || null;
    await db.query(`INSERT INTO app.video_i18n (video_id, locale, title, description) VALUES ($1,$2,$3,$4)`, [id, locale, title.trim(), description]);
  }
  await db.query(`DELETE FROM app.video_region WHERE video_id = $1`, [id]);
  for (const region of new Set(input.region_ids)) await db.query(`INSERT INTO app.video_region (video_id, region_id) VALUES ($1,$2)`, [id, region]);
}

/** Parses an HTTP Range header against a file size: the inclusive range, "invalid", or null for the whole file. */
export function parseRange(header: string | undefined, size: number): { start: number; end: number } | "invalid" | null {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === "" && m[2] === "")) return "invalid";
  let start: number;
  let end: number;
  if (m[1] === "") {
    const suffix = Number(m[2]);
    if (suffix === 0) return "invalid";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return "invalid";
  return { start, end };
}

export function videoRoutes(pool: pg.Pool, files: FileStore) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

  r.get("/brain-regions", async (c) => {
    const lang = langOf(c);
    const regions = await run(c, (db) => loadRegions(db, lang));
    return c.json({ regions });
  });

  r.get("/videos", async (c) => {
    const lang = langOf(c);
    const region = c.req.query("region");
    if (region !== undefined && !UUID.test(region)) return c.json({ error: "invalid_region" }, 400);
    const q = c.req.query("q")?.trim().slice(0, 100) || null;
    // A lobe or area code without a hemisphere ("ba44", "frontal") matches it in both hemispheres.
    const code = c.req.query("code") ?? null;
    if (code !== null && !/^[a-z0-9_]{1,40}$/.test(code)) return c.json({ error: "invalid_code" }, 400);
    const all = c.req.query("all") === "1";
    const videos = await run(c, async (db) => {
      const like = q ? `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%` : null;
      const { rows } = await db.query<Row>(
        `${SUMMARY_SQL}
          WHERE (v.status = 'published' OR ($1 AND app.is_platform_admin()))
            AND ($2::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM app.video_region vr JOIN app.brain_region t ON t.id = vr.region_id, app.brain_region f
                   WHERE vr.video_id = v.id AND f.id = $2::uuid AND (t.path = f.path OR t.path LIKE f.path || '.%')))
            AND ($3::text IS NULL OR EXISTS (SELECT 1 FROM app.video_i18n i WHERE i.video_id = v.id AND (i.title ILIKE $3 OR i.description ILIKE $3)))
            AND ($4::text IS NULL OR EXISTS (
                  SELECT 1 FROM app.video_region vr JOIN app.brain_region t ON t.id = vr.region_id
                   WHERE vr.video_id = v.id AND (t.code = $4 OR split_part(t.path, '.', 2) = $4)))
          ORDER BY v.created_at DESC`,
        [all, region ?? null, like, code],
      );
      return rows.map((row) => toSummary(row, lang)).sort((a, b) => a.title.localeCompare(b.title, lang));
    });
    return c.json({ videos });
  });

  r.get("/videos/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const video = await run(c, (db) => loadVideo(db, id, langOf(c)));
    return video ? c.json({ video }) : notFound(c);
  });

  r.get("/videos/:id/file", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    // ?v=<version> names exact bytes (a session mid-way keeps getting the file it started with); no v = the current file.
    const vParam = c.req.query("v");
    const version = vParam === undefined ? null : /^[1-9]\d{0,8}$/.test(vParam) ? Number(vParam) : -1;
    if (version === -1) return notFound(c);
    const file = await run(c, async (db) => {
      const { rows } = await db.query<{ storage_key: string; mime: string; sha256: Buffer; bytes: string }>(
        version === null
          ? `SELECT f.storage_key, f.mime, f.sha256, f.bytes FROM app.video v JOIN app.file_object f ON f.id = v.file_id WHERE v.id = $1`
          : `SELECT f.storage_key, f.mime, f.sha256, f.bytes FROM app.video v JOIN app.file_object f ON f.video_id = v.id AND f.video_version = $2 WHERE v.id = $1`,
        version === null ? [id] : [id, version],
      );
      return rows[0] ?? null;
    });
    if (!file) return notFound(c);
    const size = Number(file.bytes);
    const range = parseRange(c.req.header("range"), size);
    const headers: Record<string, string> = {
      "accept-ranges": "bytes",
      "content-type": file.mime,
      etag: `"${file.sha256.toString("hex")}"`,
      // A versioned URL never changes its bytes, so it may be kept for good; the bare URL follows new uploads.
      "cache-control": version === null ? "private, no-cache" : "private, max-age=31536000, immutable",
    };
    if (range === "invalid") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
    const opened = await files.open(file.storage_key, range ?? undefined);
    if (!opened) return notFound(c);
    if (!range) return new Response(opened.stream, { status: 200, headers: { ...headers, "content-length": String(size) } });
    return new Response(opened.stream, {
      status: 206,
      headers: { ...headers, "content-length": String(range.end - range.start + 1), "content-range": `bytes ${range.start}-${range.end}/${size}` },
    });
  });

  // ---- Platform admins

  r.post("/admin/videos", async (c) => {
    const body = await parseBody(c, videoInput);
    if (!body.ok) return body.response;
    const input = body.data;
    const me = c.get("user").id;
    // An upload has no file yet when it is created: it can't be published until its file is in.
    if (input.source === "upload" && input.status === "published") return c.json({ error: "invalid", issues: [{ path: "status", code: "needs_file" }] }, 400);
    const video = await run(c, async (db) => {
      if (!(await isAdmin(db))) return null;
      const id = randomUUID();
      await db.query(
        `INSERT INTO app.video (id, source, youtube_id, duration_s, age_min, age_max, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, input.source, input.source === "youtube" ? youtubeId(input.youtube_url!) : null, input.duration_s ?? null, input.age_min, input.age_max, input.status, me],
      );
      await writeTexts(db, id, input);
      return loadVideo(db, id, langOf(c));
    });
    return video ? c.json({ video }, 201) : c.json({ error: "forbidden" }, 403);
  });

  r.put("/admin/videos/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, videoInput);
    if (!body.ok) return body.response;
    const input = body.data;
    const result = await run(c, async (db) => {
      if (!(await isAdmin(db))) return "forbidden" as const;
      const cur = await db.query<{ source: string; youtube_id: string | null }>(`SELECT source, youtube_id FROM app.video WHERE id = $1 FOR UPDATE`, [id]);
      const old = cur.rows[0];
      if (!old) return "not_found" as const;
      const yt = input.source === "youtube" ? youtubeId(input.youtube_url!) : null;
      // A new version means devices must fetch the video again (project 2); only the media itself changes it.
      const media = old.source !== input.source || old.youtube_id !== yt;
      await db.query(
        `UPDATE app.video SET source = $2, youtube_id = $3, file_id = CASE WHEN $2 = 'upload' THEN file_id END, duration_s = COALESCE($4, duration_s),
                age_min = $5, age_max = $6, status = $7, version = version + $8 WHERE id = $1`,
        [id, input.source, yt, input.duration_s ?? null, input.age_min, input.age_max, input.status, media ? 1 : 0],
      );
      await writeTexts(db, id, input);
      const after = await db.query<{ ok: boolean }>(`SELECT NOT (source = 'upload' AND status = 'published' AND file_id IS NULL) AS ok FROM app.video WHERE id = $1`, [id]);
      if (!after.rows[0]!.ok) throw new NeedsFile(); // rolls the whole edit back
      return loadVideo(db, id, langOf(c));
    }).catch((err: unknown) => {
      if (err instanceof NeedsFile) return "needs_file" as const;
      throw err;
    });
    if (result === "needs_file") return c.json({ error: "invalid", issues: [{ path: "status", code: "needs_file" }] }, 400);
    if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (result === "not_found" || !result) return notFound(c);
    return c.json({ video: result });
  });

  r.put("/admin/videos/:id/file", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const check = await run(c, async (db) => {
      if (!(await isAdmin(db))) return "forbidden" as const;
      const { rows } = await db.query<{ source: string; version: number }>(`SELECT source, version FROM app.video WHERE id = $1`, [id]);
      if (!rows[0]) return "not_found" as const;
      if (rows[0].source !== "upload") return "not_upload" as const;
      return rows[0];
    });
    if (check === "forbidden") return c.json({ error: "forbidden" }, 403);
    if (check === "not_found") return notFound(c);
    if (check === "not_upload") return c.json({ error: "not_an_upload" }, 409);
    const mime = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!(VIDEO_MIME as readonly string[]).includes(mime)) return c.json({ error: "unsupported_type" }, 415);
    const declared = Number(c.req.header("content-length") ?? "0");
    if (declared > VIDEO_MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
    const body = c.req.raw.body;
    if (!body) return c.json({ error: "empty_file" }, 400);
    const version = check.version + 1;
    const key = `videos/${id}/${version}-${randomUUID().slice(0, 8)}.${mime === "video/webm" ? "webm" : "mp4"}`;
    let stored: { bytes: number; sha256: Buffer };
    try {
      stored = await files.put(key, body, VIDEO_MAX_BYTES);
    } catch (err) {
      if (err instanceof FileTooLarge) return c.json({ error: "file_too_large" }, 413);
      throw err;
    }
    if (stored.bytes === 0) {
      await files.remove(key);
      return c.json({ error: "empty_file" }, 400);
    }
    const me = c.get("user").id;
    const video = await run(c, async (db) => {
      // The new file is the next version; the previous one stays reachable at its own ?v= (a session may be playing it).
      const next = await db.query<{ version: number }>(`UPDATE app.video SET version = version + 1 WHERE id = $1 RETURNING version`, [id]);
      const f = await db.query<{ id: string }>(
        `INSERT INTO app.file_object (storage_key, sha256, bytes, mime, created_by, video_id, video_version) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [key, stored.sha256, stored.bytes, mime, me, id, next.rows[0]!.version],
      );
      await db.query(`UPDATE app.video SET file_id = $2 WHERE id = $1`, [id, f.rows[0]!.id]);
      return loadVideo(db, id, langOf(c));
    });
    return c.json({ video });
  });

  return r;
}
