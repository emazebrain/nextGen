/**
 * Devices and therapist spaces (offline devices spec §7.3, §7.5, §8; ADR 0019). A device is registered by the first
 * staff member who installs the app on it; each therapist gets one space per clinic on it. The outbox secret goes to
 * anyone with an active space on the device (results waiting there may be sent by whoever signs in next); a space
 * secret goes only to its owner. Secrets are never logged.
 */
import { Hono } from "hono";
import type pg from "pg";
import { randomBytes } from "node:crypto";
import { deviceRegisterInput, type DeviceSecrets, type DeviceSpace } from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { parseBody } from "../../validate.ts";
import type { DeviceKey } from "../../device-crypto.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SPACE_SQL = `
  SELECT s.id, s.user_id, u.full_name, s.clinic_id, c.name AS clinic_name, s.last_online_at, s.ended_at
    FROM app.device_space s JOIN app.app_user u ON u.id = s.user_id JOIN app.clinic c ON c.id = s.clinic_id`;

export function deviceRoutes(pool: pg.Pool, key: DeviceKey) {
  const r = new Hono<Env>();
  const run = <T>(c: { get: (k: "user" | "requestId") => any }, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  r.post("/devices/register", async (c) => {
    const body = await parseBody(c, deviceRegisterInput);
    if (!body.ok) return body.response;
    const { device_id, outbox_public_key } = body.data;
    await run(c, async (db) => {
      // Already registered (by anyone): nothing to change, and nothing about it is revealed.
      const exists = await db.query(`SELECT app.device_exists($1) AS e`, [device_id]);
      if (exists.rows[0].e) return;
      await db.query(`INSERT INTO app.device (id, outbox_public_key, outbox_secret_enc, created_by) VALUES ($1,$2,$3,app.current_user_id())`, [
        device_id,
        outbox_public_key,
        key.seal(randomBytes(32)),
      ]);
    });
    return c.json({ device_id }, 201);
  });

  r.post("/devices/:id/spaces", async (c) => {
    const id = c.req.param("id");
    const body = (await c.req.json().catch(() => null)) as { clinic_id?: unknown } | null;
    const clinicId = body?.clinic_id;
    if (!UUID.test(id) || typeof clinicId !== "string" || !UUID.test(clinicId)) return c.json({ error: "invalid" }, 400);
    const out = await run(c, async (db) => {
      if (!(await db.query(`SELECT app.device_exists($1) AS e`, [id])).rows[0].e) return null;
      const existing = await db.query<DeviceSpace>(`${SPACE_SQL} WHERE s.device_id = $1 AND s.user_id = app.current_user_id() AND s.clinic_id = $2 AND s.ended_at IS NULL`, [id, clinicId]);
      if (existing.rows[0]) {
        await db.query(`UPDATE app.device_space SET last_online_at = now() WHERE id = $1`, [existing.rows[0].id]);
        return existing.rows[0];
      }
      const ins = await db.query<{ id: string }>(
        `INSERT INTO app.device_space (device_id, user_id, clinic_id, space_secret_enc) VALUES ($1, app.current_user_id(), $2, $3) RETURNING id`,
        [id, clinicId, key.seal(randomBytes(32))],
      );
      return (await db.query<DeviceSpace>(`${SPACE_SQL} WHERE s.id = $1`, [ins.rows[0]!.id])).rows[0]!;
    });
    if (!out) return c.json({ error: "not_found" }, 404);
    return c.json(out, 201);
  });

  r.get("/devices/:id/secrets", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const out = await run(c, async (db) => {
      if (!(await db.query(`SELECT app.device_exists($1) AS e`, [id])).rows[0].e) return null;
      const spaces = await db.query<{ id: string; clinic_id: string; space_secret_enc: Buffer }>(
        `UPDATE app.device_space SET last_online_at = now()
          WHERE device_id = $1 AND user_id = app.current_user_id() AND ended_at IS NULL
          RETURNING id, clinic_id, space_secret_enc`,
        [id],
      );
      let outbox: string | null = null;
      if (spaces.rows.length) {
        const d = await db.query<{ outbox_secret_enc: Buffer }>(`UPDATE app.device SET last_seen_at = now() WHERE id = $1 RETURNING outbox_secret_enc`, [id]);
        outbox = key.open(d.rows[0]!.outbox_secret_enc).toString("base64");
      }
      const secrets: DeviceSecrets = {
        outbox_secret: outbox,
        spaces: spaces.rows.map((s) => ({ space_id: s.id, clinic_id: s.clinic_id, space_secret: key.open(s.space_secret_enc).toString("base64") })),
      };
      return secrets;
    });
    if (!out) return c.json({ error: "not_found" }, 404);
    return c.json(out);
  });

  r.get("/devices/:id/spaces", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return c.json({ error: "not_found" }, 404);
    const rows = await run(c, async (db) => (await db.query<DeviceSpace>(`${SPACE_SQL} WHERE s.device_id = $1 AND s.ended_at IS NULL ORDER BY u.full_name`, [id])).rows);
    return c.json(rows);
  });

  r.delete("/devices/:id/spaces/:spaceId", async (c) => {
    const { id, spaceId } = c.req.param();
    if (!UUID.test(id) || !UUID.test(spaceId)) return c.json({ error: "not_found" }, 404);
    const n = await run(c, async (db) =>
      (await db.query(`UPDATE app.device_space SET ended_at = now(), ended_by = app.current_user_id() WHERE id = $1 AND device_id = $2 AND ended_at IS NULL`, [spaceId, id])).rowCount,
    );
    return n ? c.body(null, 204) : c.json({ error: "not_found" }, 404);
  });

  return r;
}
