/**
 * Consent request endpoints — therapist-side CRUD and email sending.
 * Routes are registered directly on the patient router (not sub-routed)
 * so the :id param is in scope and typed correctly by Hono.
 */
import type { Hono, Context } from "hono";
import type pg from "pg";
import {
  requestConsent,
  type ConsentRequestView,
} from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { uuidv7 } from "../../ids.ts";
import type { Mailer } from "../../email.ts";
import { parseBody } from "../../validate.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

/**
 * Register consent-request routes on the parent patient router.
 * All paths include /:id/ so the patient id is part of this router's
 * own route definition — no sub-routing, no missing params.
 */
export function registerConsentRequestRoutes(
  r: Hono<Env>,
  pool: pg.Pool,
  mailer: Mailer,
  publicAppUrl: string | undefined,
) {
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) =>
    withUser(pool, c.get("user").id, c.get("requestId"), fn);
  const baseUrl = publicAppUrl ?? "https://next-gen-cyan.vercel.app";

  // POST /:id/consent-requests — create requests and send emails
  r.post("/:id/consent-requests", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, requestConsent);
    if (!body.ok) return body.response;
    const input = body.data;
    const me = c.get("user").id;

    const result = await run(c, async (db) => {
      // Verify patient exists (separate from clinic to avoid RLS JOIN issues)
      const { rows: patients } = await db.query(
        `SELECT id, clinic_id FROM app.patient WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!patients[0]) {
        console.error(`[consent-request] patient ${id} not visible (RLS or missing)`);
        return { error: "not_found" as const };
      }
      const { clinic_id } = patients[0];
      // Fetch clinic name separately (uses its own RLS policies incl. admin)
      const { rows: clinics } = await db.query(
        `SELECT name FROM app.clinic WHERE id = $1`,
        [clinic_id],
      );
      const clinic_name = clinics[0]?.name ?? "Clinic";

      // Cancel any existing pending requests for this patient
      await db.query(
        `UPDATE app.consent_request SET status = 'cancelled', cancelled_at = now()
          WHERE patient_id = $1 AND status = 'pending'`,
        [id],
      );

      const requests: ConsentRequestView[] = [];

      for (const g of input.guardians) {
        // Upsert guardian
        const guardianId = uuidv7();
        await db.query(
          `INSERT INTO app.guardian (id, clinic_id, full_name, email, phone, preferred_locale, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [guardianId, clinic_id, g.full_name, g.email, g.phone ?? null, g.preferred_locale, me],
        );
        await db.query(
          `INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian)
           VALUES ($1,$2,$3,true)
           ON CONFLICT (guardian_id, patient_id) DO UPDATE SET relationship = EXCLUDED.relationship, is_legal_guardian = true`,
          [guardianId, id, g.relationship],
        );

        // Create consent request with token
        const reqId = uuidv7();
        const token = uuidv7();
        await db.query(
          `INSERT INTO app.consent_request (id, patient_id, guardian_id, clinic_id, token, guardian_email, guardian_name, guardian_phone, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [reqId, id, guardianId, clinic_id, token, g.email, g.full_name, g.phone ?? null, me],
        );

        requests.push({
          id: reqId,
          guardian_id: guardianId,
          guardian_name: g.full_name,
          guardian_email: g.email,
          status: "pending",
          sent_at: new Date().toISOString(),
          completed_at: null,
        });

        // Send email (outside transaction would be better, but keeping simple for now)
        const consentUrl = `${baseUrl}/consent/${token}`;
        void mailer.sendConsentRequest(g.email, clinic_name, consentUrl, g.preferred_locale);
      }

      return { requests, clinic_name };
    });

    if ("error" in result) return notFound(c);
    return c.json({ consent_requests: result.requests }, 201);
  });

  // GET /:id/consent-requests — list requests
  r.get("/:id/consent-requests", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const requests = await run(c, async (db) => {
      const { rows: patient } = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!patient[0]) return null;
      const { rows } = await db.query(
        `SELECT cr.id, cr.guardian_id, cr.guardian_name, cr.guardian_email, cr.status, cr.sent_at, cr.completed_at
           FROM app.consent_request cr
          WHERE cr.patient_id = $1
          ORDER BY cr.created_at DESC`,
        [id],
      );
      return rows.map((row) => ({
        ...row,
        sent_at: (row.sent_at as Date).toISOString(),
        completed_at: row.completed_at ? (row.completed_at as Date).toISOString() : null,
      }));
    });
    return requests ? c.json({ consent_requests: requests }) : notFound(c);
  });

  // POST /:id/consent-requests/:rid/resend — resend email
  r.post("/:id/consent-requests/:rid/resend", async (c) => {
    const id = c.req.param("id");
    const rid = c.req.param("rid");
    if (!UUID.test(id) || !UUID.test(rid)) return notFound(c);
    const result = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT cr.token, cr.guardian_email, cr.guardian_name, cl.name AS clinic_name, g.preferred_locale
           FROM app.consent_request cr
           JOIN app.clinic cl ON cl.id = cr.clinic_id
           JOIN app.guardian g ON g.id = cr.guardian_id
          WHERE cr.id = $1 AND cr.patient_id = $2 AND cr.status = 'pending'`,
        [rid, id],
      );
      if (!rows[0]) return null;
      // Update sent_at
      await db.query(`UPDATE app.consent_request SET sent_at = now() WHERE id = $1`, [rid]);
      return rows[0];
    });
    if (!result) return notFound(c);
    const consentUrl = `${baseUrl}/consent/${result.token}`;
    void mailer.sendConsentRequest(result.guardian_email, result.clinic_name, consentUrl, result.preferred_locale);
    return c.json({ ok: true });
  });

  // DELETE /:id/consent-requests/:rid — cancel request
  r.delete("/:id/consent-requests/:rid", async (c) => {
    const id = c.req.param("id");
    const rid = c.req.param("rid");
    if (!UUID.test(id) || !UUID.test(rid)) return notFound(c);
    const ok = await run(c, async (db) => {
      const res = await db.query(
        `UPDATE app.consent_request SET status = 'cancelled', cancelled_at = now()
          WHERE id = $1 AND patient_id = $2 AND status = 'pending'`,
        [rid, id],
      );
      return (res.rowCount ?? 0) > 0;
    });
    return ok ? c.json({ ok: true }) : notFound(c);
  });
}
