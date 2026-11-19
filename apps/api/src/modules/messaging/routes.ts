/**
 * Messaging API (design doc §5.11).
 * One secure thread per patient × therapist, with attachments.
 * Staff routes: mounted under /v1/messages (behind requireStaffSession).
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import { z } from "zod";
import { withUser, type Env } from "../../context.ts";
import { uuidv7 } from "../../ids.ts";
import { parseBody } from "../../validate.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

const createThreadSchema = z.object({
  patient_id: z.string().uuid(),
  guardian_id: z.string().uuid(),
});

const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  attachment_url: z.string().url().max(2048).optional(),
  attachment_name: z.string().max(255).optional(),
  attachment_type: z.enum(["image/jpeg", "image/png", "image/webp", "application/pdf"]).optional(),
  attachment_size: z.number().int().max(10485760).optional(),
});

export function messagingRoutes(pool: pg.Pool) {
  const app = new Hono<Env>();

  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);

  /**
   * GET /threads — list threads for the current user.
   * Staff see threads in their clinics, optionally filtered by patient.
   */
  app.get("/threads", async (c) => {
    const patientId = c.req.query("patient_id");
    const threads = await run(c, async (db) => {
      const conditions = [`1=1`];
      const params: unknown[] = [];
      if (patientId && UUID_RE.test(patientId)) {
        params.push(patientId);
        conditions.push(`t.patient_id = $${params.length}`);
      }

      const { rows } = await db.query(
        `SELECT t.id, t.patient_id, t.therapist_id, t.guardian_id, t.status, t.last_message_at, t.created_at,
                p.given_name AS patient_given_name, p.family_name AS patient_family_name,
                g.full_name AS guardian_name,
                u.full_name AS therapist_name,
                (SELECT count(*)::int FROM app.message m WHERE m.thread_id = t.id AND m.read_at IS NULL AND m.sender_id <> app.current_user_id()) AS unread_count
           FROM app.message_thread t
           JOIN app.patient p ON p.id = t.patient_id
           JOIN app.guardian g ON g.id = t.guardian_id
           JOIN app.app_user u ON u.id = t.therapist_id
          WHERE ${conditions.join(" AND ")}
          ORDER BY t.last_message_at DESC NULLS LAST, t.created_at DESC`,
        params,
      );
      return rows;
    });
    return c.json({ threads });
  });

  /**
   * POST /threads — create a new thread for a patient-guardian pair.
   */
  app.post("/threads", async (c) => {
    const body = await parseBody(c, createThreadSchema);
    if (!body.ok) return body.response;
    const { patient_id, guardian_id } = body.data;

    const result = await run(c, async (db) => {
      // Verify patient and guardian are linked
      const { rows: links } = await db.query(
        `SELECT p.clinic_id FROM app.patient p
           JOIN app.guardian_patient gp ON gp.patient_id = p.id AND gp.guardian_id = $2
          WHERE p.id = $1 AND p.deleted_at IS NULL`,
        [patient_id, guardian_id],
      );
      if (!links[0]) return { error: "not_found" as const };

      // Check for existing active thread
      const { rows: existing } = await db.query(
        `SELECT id FROM app.message_thread
          WHERE patient_id = $1 AND therapist_id = app.current_user_id() AND guardian_id = $2 AND status = 'active'`,
        [patient_id, guardian_id],
      );
      if (existing[0]) return { thread_id: existing[0].id, created: false };

      const threadId = uuidv7();
      await db.query(
        `INSERT INTO app.message_thread (id, clinic_id, patient_id, therapist_id, guardian_id)
         VALUES ($1, $2, $3, app.current_user_id(), $4)`,
        [threadId, links[0].clinic_id, patient_id, guardian_id],
      );
      return { thread_id: threadId, created: true };
    });

    if ("error" in result) return notFound(c);
    return c.json(result, result.created ? 201 : 200);
  });

  /**
   * GET /threads/:threadId/messages — list messages in a thread.
   */
  app.get("/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    const messages = await run(c, async (db) => {
      // Verify thread access (RLS handles this but explicit check for 404)
      const { rows: threads } = await db.query(
        `SELECT id FROM app.message_thread WHERE id = $1`,
        [threadId],
      );
      if (!threads[0]) return null;

      const { rows } = await db.query(
        `SELECT m.id, m.sender_id, m.sender_role, m.body, m.attachment_url, m.attachment_name, m.attachment_type,
                m.attachment_size, m.read_at, m.created_at,
                u.full_name AS sender_name
           FROM app.message m
           JOIN app.app_user u ON u.id = m.sender_id
          WHERE m.thread_id = $1
          ORDER BY m.created_at ASC`,
        [threadId],
      );
      return rows.map((r) => ({
        ...r,
        created_at: (r.created_at as Date).toISOString(),
        read_at: r.read_at ? (r.read_at as Date).toISOString() : null,
      }));
    });

    if (!messages) return notFound(c);
    return c.json({ messages });
  });

  /**
   * POST /threads/:threadId/messages — send a message.
   */
  app.post("/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    const body = await parseBody(c, sendMessageSchema);
    if (!body.ok) return body.response;

    const result = await run(c, async (db) => {
      // Verify thread exists and is active
      const { rows: threads } = await db.query(
        `SELECT id, status FROM app.message_thread WHERE id = $1`,
        [threadId],
      );
      if (!threads[0]) return { error: "not_found" as const };
      if (threads[0].status !== "active") return { error: "thread_archived" as const };

      const msgId = uuidv7();
      await db.query(
        `INSERT INTO app.message (id, thread_id, sender_id, sender_role, body, attachment_url, attachment_name, attachment_type, attachment_size)
         VALUES ($1, $2, app.current_user_id(), 'staff', $3, $4, $5, $6, $7)`,
        [msgId, threadId, body.data.body, body.data.attachment_url ?? null, body.data.attachment_name ?? null, body.data.attachment_type ?? null, body.data.attachment_size ?? null],
      );
      return { id: msgId };
    });

    if ("error" in result) {
      if (result.error === "not_found") return notFound(c);
      return c.json({ error: result.error }, 400);
    }
    return c.json(result, 201);
  });

  /**
   * POST /threads/:threadId/read — mark all unread messages in a thread as read.
   */
  app.post("/threads/:threadId/read", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    await run(c, async (db) => {
      await db.query(
        `UPDATE app.message SET read_at = now()
          WHERE thread_id = $1 AND read_at IS NULL AND sender_id <> app.current_user_id()`,
        [threadId],
      );
    });

    return c.json({ ok: true });
  });

  return app;
}

/**
 * Parent-side messaging routes — mounted under /v1/parent/messages.
 * Guardian sends/reads messages in their threads.
 */
export function parentMessagingRoutes(pool: pg.Pool) {
  const app = new Hono<Env>();

  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);

  /** GET /threads — list threads for this guardian. */
  app.get("/threads", async (c) => {
    const threads = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT t.id, t.patient_id, t.therapist_id, t.guardian_id, t.status, t.last_message_at, t.created_at,
                p.given_name AS patient_given_name, p.family_name AS patient_family_name,
                u.full_name AS therapist_name,
                (SELECT count(*)::int FROM app.message m WHERE m.thread_id = t.id AND m.read_at IS NULL AND m.sender_id <> app.current_user_id()) AS unread_count
           FROM app.message_thread t
           JOIN app.patient p ON p.id = t.patient_id
           JOIN app.app_user u ON u.id = t.therapist_id
          ORDER BY t.last_message_at DESC NULLS LAST`,
      );
      return rows;
    });
    return c.json({ threads });
  });

  /** GET /threads/:threadId/messages — list messages. */
  app.get("/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    const messages = await run(c, async (db) => {
      const { rows: threads } = await db.query(`SELECT id FROM app.message_thread WHERE id = $1`, [threadId]);
      if (!threads[0]) return null;
      const { rows } = await db.query(
        `SELECT m.id, m.sender_id, m.sender_role, m.body, m.attachment_url, m.attachment_name, m.attachment_type,
                m.attachment_size, m.read_at, m.created_at,
                u.full_name AS sender_name
           FROM app.message m
           JOIN app.app_user u ON u.id = m.sender_id
          WHERE m.thread_id = $1
          ORDER BY m.created_at ASC`,
        [threadId],
      );
      return rows.map((r) => ({
        ...r,
        created_at: (r.created_at as Date).toISOString(),
        read_at: r.read_at ? (r.read_at as Date).toISOString() : null,
      }));
    });

    if (!messages) return notFound(c);
    return c.json({ messages });
  });

  /** POST /threads/:threadId/messages — guardian sends a message. */
  app.post("/threads/:threadId/messages", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    const body = await parseBody(c, sendMessageSchema);
    if (!body.ok) return body.response;

    const result = await run(c, async (db) => {
      const { rows: threads } = await db.query(
        `SELECT id, status FROM app.message_thread WHERE id = $1`,
        [threadId],
      );
      if (!threads[0]) return { error: "not_found" as const };
      if (threads[0].status !== "active") return { error: "thread_archived" as const };

      const msgId = uuidv7();
      await db.query(
        `INSERT INTO app.message (id, thread_id, sender_id, sender_role, body, attachment_url, attachment_name, attachment_type, attachment_size)
         VALUES ($1, $2, app.current_user_id(), 'guardian', $3, $4, $5, $6, $7)`,
        [msgId, threadId, body.data.body, body.data.attachment_url ?? null, body.data.attachment_name ?? null, body.data.attachment_type ?? null, body.data.attachment_size ?? null],
      );
      return { id: msgId };
    });

    if ("error" in result) {
      if (result.error === "not_found") return notFound(c);
      return c.json({ error: result.error }, 400);
    }
    return c.json(result, 201);
  });

  /** POST /threads/:threadId/read — mark messages read. */
  app.post("/threads/:threadId/read", async (c) => {
    const threadId = c.req.param("threadId");
    if (!UUID_RE.test(threadId)) return notFound(c);

    await run(c, async (db) => {
      await db.query(
        `UPDATE app.message SET read_at = now()
          WHERE thread_id = $1 AND read_at IS NULL AND sender_id <> app.current_user_id()`,
        [threadId],
      );
    });

    return c.json({ ok: true });
  });

  return app;
}
