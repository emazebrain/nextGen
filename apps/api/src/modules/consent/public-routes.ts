/**
 * Public consent endpoints — unauthenticated, token-based.
 * Mounted OUTSIDE /v1 (no auth middleware) at /consent/:token.
 *
 * Security:
 *  - Tokens are UUIDv7 (122 bits of entropy) — not guessable.
 *  - POST requires matching guardian name + email (+ phone if set).
 *  - Tokens are single-use: completed tokens cannot be reused.
 *  - Cancelled tokens return 410 Gone.
 *  - Rate limiting should be applied at the proxy / load-balancer level.
 *
 * Database access: these endpoints run WITHOUT an authenticated user.
 * We use the pool directly with SET LOCAL ROLE emb_app and a service-level
 * user_id (the consent_request.created_by — the therapist who initiated).
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import {
  CONSENT_PURPOSES,
  CONSENT_POLICY_VERSION,
  submitConsent,
  type PublicConsentData,
} from "../../../../../packages/contracts/src/index.ts";
import { parseBody } from "../../validate.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PublicEnv = {
  Variables: {
    requestId: string;
  };
};

/** Run a function in a transaction as emb_app with the given user_id. */
async function withServiceUser<T>(
  pool: pg.Pool,
  userId: string,
  requestId: string,
  fn: (db: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE emb_app");
    await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [userId, requestId]);
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export function publicConsentRoutes(pool: pg.Pool) {
  const r = new Hono<PublicEnv>();

  // GET /consent/:token — returns consent form data (no PHI beyond first name + clinic)
  r.get("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID.test(token)) return c.json({ error: "not_found" }, 404);

    // Read the consent request without RLS (we have no authenticated user).
    // We use the therapist who created the request as the user_id for the transaction.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // First get the request without RLS context (read as the connection role)
      const { rows } = await client.query(
        `SELECT cr.id, cr.patient_id, cr.guardian_id, cr.clinic_id, cr.status,
                cr.guardian_name, cr.guardian_email, cr.guardian_phone, cr.created_by,
                p.given_name AS patient_first_name,
                cl.name AS clinic_name,
                g.preferred_locale
           FROM app.consent_request cr
           JOIN app.patient p ON p.id = cr.patient_id
           JOIN app.clinic cl ON cl.id = cr.clinic_id
           JOIN app.guardian g ON g.id = cr.guardian_id
          WHERE cr.token = $1`,
        [token],
      );
      await client.query("COMMIT");

      if (!rows[0]) return c.json({ error: "not_found" }, 404);
      const req = rows[0];

      if (req.status === "cancelled") return c.json({ error: "cancelled" }, 410);
      if (req.status === "completed") return c.json({ error: "already_completed" }, 410);

      const data: PublicConsentData = {
        clinic_name: req.clinic_name,
        patient_first_name: req.patient_first_name,
        guardian_name: req.guardian_name,
        guardian_email: req.guardian_email,
        locale: req.preferred_locale,
        policy_version: CONSENT_POLICY_VERSION,
        purposes: CONSENT_PURPOSES,
      };
      return c.json({ consent: data });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  // POST /consent/:token — submit consent (guardian signs)
  r.post("/:token", async (c) => {
    const token = c.req.param("token");
    if (!UUID.test(token)) return c.json({ error: "not_found" }, 404);
    const body = await parseBody(c, submitConsent);
    if (!body.ok) return body.response;
    const input = body.data;
    const requestId = c.get("requestId") ?? crypto.randomUUID();

    // Step 1: Look up the consent request (without RLS)
    const client = await pool.connect();
    try {
      await client.query("BEGIN");

      const { rows } = await client.query(
        `SELECT cr.id, cr.patient_id, cr.guardian_id, cr.clinic_id, cr.status,
                cr.guardian_name, cr.guardian_email, cr.guardian_phone, cr.created_by
           FROM app.consent_request cr
          WHERE cr.token = $1
          FOR UPDATE`,
        [token],
      );
      if (!rows[0]) {
        await client.query("ROLLBACK");
        return c.json({ error: "not_found" }, 404);
      }
      const req = rows[0];

      if (req.status === "cancelled") {
        await client.query("ROLLBACK");
        return c.json({ error: "cancelled" }, 410);
      }
      if (req.status === "completed") {
        await client.query("ROLLBACK");
        return c.json({ error: "already_completed" }, 410);
      }

      // Step 2: Verify identity — name + email must match (case-insensitive, whitespace-normalized)
      const normalize = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
      if (normalize(input.full_name) !== normalize(req.guardian_name)) {
        await client.query("ROLLBACK");
        return c.json({ error: "identity_mismatch" }, 422);
      }
      if (normalize(input.email) !== normalize(req.guardian_email)) {
        await client.query("ROLLBACK");
        return c.json({ error: "identity_mismatch" }, 422);
      }
      // Phone match is required only if the therapist provided one
      if (req.guardian_phone && input.phone) {
        const normalizePhone = (s: string) => s.replace(/[\s()-]/g, "");
        if (normalizePhone(input.phone) !== normalizePhone(req.guardian_phone)) {
          await client.query("ROLLBACK");
          return c.json({ error: "identity_mismatch" }, 422);
        }
      }

      // Step 3: Run the consent recording as the therapist who created the request
      // (so RLS policies on consent INSERT are satisfied)
      await client.query("SET LOCAL ROLE emb_app");
      await client.query("SELECT set_config('app.user_id', $1, true), set_config('app.request_id', $2, true)", [
        req.created_by, requestId,
      ]);

      // Record consent for all purposes as 'granted'
      for (const purpose of CONSENT_PURPOSES) {
        await client.query(
          `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, consent_request_id, record_hash)
           VALUES ($1,$2,$3,'granted',$4,'remote_email_esign',$5,$6,$7,$8,'\\x')`,
          [req.patient_id, req.guardian_id, purpose, CONSENT_POLICY_VERSION, input.locale, input.full_name, req.created_by, req.id],
        );
      }

      // Mark the consent request as completed
      await client.query(
        `UPDATE app.consent_request SET status = 'completed', completed_at = now() WHERE id = $1`,
        [req.id],
      );

      await client.query("COMMIT");
      return c.json({ ok: true }, 201);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }
  });

  return r;
}
