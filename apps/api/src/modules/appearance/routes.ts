/**
 * Platform appearance: the background every user sees (the theme default, a solid colour, or an uploaded image).
 *
 * Reading is public — the sign-in page and the parent portal show it too, and it holds no patient data.
 * Changing it is for platform admins: checked up front, and again by RLS on the single row (migration 0040).
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { createHash } from "node:crypto";
import { z } from "zod";
import { withUser, type Env } from "../../context.ts";

export const APPEARANCE_IMAGE_MAX_BYTES = 3 * 1024 * 1024;
const IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"] as const;
type ImageMime = (typeof IMAGE_MIME)[number];

const putSchema = z.object({
  kind: z.enum(["default", "color", "image"]),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  blur: z.enum(["none", "light", "strong"]).optional(),
});

interface Row {
  kind: "default" | "color" | "image";
  color: string | null;
  blur: "none" | "light" | "strong";
  version: number;
  has_image: boolean;
}
const COLS = `kind, color, blur, version, image IS NOT NULL AS has_image`;

/** What every client gets: enough to paint the background, nothing about who set it. */
const publicView = (r: Row) => ({
  kind: r.kind,
  color: r.kind === "color" ? r.color : null,
  blur: r.blur,
  version: r.version,
  image_url: r.kind === "image" ? `/api/appearance/image?v=${r.version}` : null,
});
/** The admin screen also needs the saved colour and whether an image is on file, whichever kind is active. */
const adminView = (r: Row) => ({ ...publicView(r), color: r.color, has_image: r.has_image });

/** The format the bytes really are, from their signature; null when they are none of the three we accept. */
export function sniffImage(b: Buffer): ImageMime | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP") return "image/webp";
  return null;
}

/** A read with no signed-in user: as the app role, so only the read-for-all policy applies. */
async function readPublic<T>(pool: pg.Pool, fn: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query("SET LOCAL ROLE emb_app");
    const out = await fn(db);
    await db.query("COMMIT");
    return out;
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

/** Mounted outside /v1 (no session needed), under /api so the web host forwards it. */
export function publicAppearanceRoutes(pool: pg.Pool) {
  const r = new Hono();

  r.get("/", async (c) => {
    const row = await readPublic(pool, async (db) => (await db.query<Row>(`SELECT ${COLS} FROM app.platform_appearance`)).rows[0]);
    c.header("cache-control", "no-cache");
    return c.json(row ? publicView(row) : { kind: "default", color: null, blur: "light", version: 1, image_url: null });
  });

  r.get("/image", async (c) => {
    const row = await readPublic(
      pool,
      async (db) =>
        (await db.query<{ image: Buffer; image_mime: string; image_sha256: Buffer; version: number }>(`SELECT image, image_mime, image_sha256, version FROM app.platform_appearance WHERE kind = 'image'`)).rows[0],
    );
    if (!row) return c.json({ error: "not_found" }, 404);
    const etag = `"${row.image_sha256.toString("hex")}"`;
    // A URL that names the current version never changes its bytes; any other URL follows new uploads.
    const pinned = c.req.query("v") === String(row.version);
    const headers = {
      "content-type": row.image_mime,
      "x-content-type-options": "nosniff",
      "cache-control": pinned ? "public, max-age=31536000, immutable" : "no-cache",
      etag,
    };
    if (c.req.header("if-none-match") === etag) return new Response(null, { status: 304, headers });
    return new Response(new Uint8Array(row.image), { status: 200, headers: { ...headers, "content-length": String(row.image.length) } });
  });

  return r;
}

type C = Context<Env>;

/** Mounted at /v1/admin/appearance. */
export function adminAppearanceRoutes(pool: pg.Pool) {
  const r = new Hono<Env>();
  const run = <T>(c: C, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  r.use("*", async (c, next) => {
    const ok = await run(c, async (db) => (await db.query<{ a: boolean }>(`SELECT app.is_platform_admin() AS a`)).rows[0]!.a);
    if (!ok) return c.json({ error: "forbidden" }, 403);
    await next();
  });

  r.get("/", async (c) => {
    const row = await run(c, async (db) => (await db.query<Row>(`SELECT ${COLS} FROM app.platform_appearance`)).rows[0]!);
    return c.json({ appearance: adminView(row) });
  });

  r.put("/", async (c) => {
    const parsed = putSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "invalid" }, 400);
    const { kind, blur } = parsed.data;
    const color = parsed.data.color?.toLowerCase();
    if (kind === "color" && !color) return c.json({ error: "invalid" }, 400);
    const result = await run(c, async (db) => {
      if (kind === "image") {
        const { rows } = await db.query<{ has: boolean }>(`SELECT image IS NOT NULL AS has FROM app.platform_appearance`);
        if (!rows[0]?.has) return "no_image" as const;
      }
      const { rows } = await db.query<Row>(
        `UPDATE app.platform_appearance
            SET kind = $1, color = COALESCE($2, color), blur = COALESCE($3, blur), version = version + 1, updated_at = now(), updated_by = $4
          RETURNING ${COLS}`,
        [kind, color ?? null, blur ?? null, c.get("user").id],
      );
      return rows[0] ?? ("forbidden" as const);
    });
    if (result === "no_image") return c.json({ error: "no_image" }, 409);
    if (result === "forbidden") return c.json({ error: "forbidden" }, 403);
    return c.json({ appearance: adminView(result) });
  });

  r.put("/image", async (c) => {
    if (Number(c.req.header("content-length") ?? "0") > APPEARANCE_IMAGE_MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
    const bytes = Buffer.from(await c.req.arrayBuffer());
    if (bytes.length === 0) return c.json({ error: "empty_file" }, 400);
    if (bytes.length > APPEARANCE_IMAGE_MAX_BYTES) return c.json({ error: "file_too_large" }, 413);
    // The bytes decide the type, not the header: only real JPEG, PNG or WebP is stored and served.
    const mime = sniffImage(bytes);
    if (!mime) return c.json({ error: "unsupported_type" }, 415);
    const sha = createHash("sha256").update(bytes).digest();
    const row = await run(c, async (db) => {
      const { rows } = await db.query<Row>(
        `UPDATE app.platform_appearance
            SET kind = 'image', image = $1, image_mime = $2, image_sha256 = $3, version = version + 1, updated_at = now(), updated_by = $4
          RETURNING ${COLS}`,
        [bytes, mime, sha, c.get("user").id],
      );
      return rows[0];
    });
    if (!row) return c.json({ error: "forbidden" }, 403);
    return c.json({ appearance: adminView(row) });
  });

  return r;
}
