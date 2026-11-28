/**
 * Patients, guardians and consent (design doc §5.3, §6, §11.3).
 * Everything runs under RLS through withUser(); the database decides who may
 * see or change what, and every read of a patient is written to the audit log.
 */
import { Hono, type Context } from "hono";
import type pg from "pg";
import {
  CONSENT_POLICY_VERSION,
  CONSENT_PURPOSES,
  createPatient,
  guardianFields,
  recordConsent,
  updatePatient,
  type PatientDetail,
} from "../../../../../packages/contracts/src/index.ts";
import { withUser, type Env } from "../../context.ts";
import { uuidv7 } from "../../ids.ts";
import { parseBody } from "../../validate.ts";
import type { Mailer } from "../../email.ts";
import { registerConsentRequestRoutes } from "./consent-requests.ts";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MANAGERS = `ARRAY['clinic_manager','org_admin']::app.member_role[]`;

const notFound = (c: Context) => c.json({ error: "not_found" }, 404);

/** Loads everything the patient page shows. Returns null when the user can't see the patient. */
export async function loadPatient(db: pg.PoolClient, id: string): Promise<PatientDetail | null> {
  const { rows } = await db.query(
    `SELECT id, clinic_id, given_name, family_name, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            preferred_locale, status, sex, handedness, alert, colour_vision_deficiency,
            tones_enabled, tone_age_group, music_enabled,
            deleted_at IS NOT NULL AS archived, app.patient_can_play(id) AS can_play
       FROM app.patient WHERE id = $1`,
    [id],
  );
  const p = rows[0];
  if (!p) return null;
  const [team, guardians, consents, consentReqs] = await Promise.all([
    db.query(
      `SELECT t.user_id, u.full_name, t.role
         FROM app.patient_care_team t LEFT JOIN app.app_user u ON u.id = t.user_id
        WHERE t.patient_id = $1 AND t.ended_at IS NULL
        ORDER BY t.role, u.full_name`,
      [id],
    ),
    db.query(
      `SELECT g.id, g.full_name, gp.relationship, gp.is_legal_guardian, g.email, g.phone, g.address, g.preferred_locale,
              g.user_id IS NOT NULL AS has_portal_account
         FROM app.guardian_patient gp JOIN app.guardian g ON g.id = gp.guardian_id
        WHERE gp.patient_id = $1 AND g.deleted_at IS NULL
        ORDER BY gp.created_at`,
      [id],
    ),
    db.query(
      `SELECT c.purpose, c.decision, c.signed_at, c.signer_name, g.full_name AS guardian_name, u.full_name AS captured_by_name
         FROM app.consent_current c
         LEFT JOIN app.guardian g ON g.id = c.guardian_id
         LEFT JOIN app.app_user u ON u.id = c.captured_by
        WHERE c.patient_id = $1`,
      [id],
    ),
    db.query(
      `SELECT cr.id, cr.guardian_id, cr.guardian_name, cr.guardian_email, cr.status, cr.sent_at, cr.completed_at
         FROM app.consent_request cr
        WHERE cr.patient_id = $1
        ORDER BY cr.created_at DESC`,
      [id],
    ),
  ]);
  return {
    ...p,
    care_team: team.rows.map((r) => ({ ...r, full_name: r.full_name ?? "" })),
    guardians: guardians.rows,
    consents: consents.rows.map((r) => ({ ...r, signed_at: (r.signed_at as Date).toISOString() })),
    consent_requests: consentReqs.rows.map((r) => ({
      ...r,
      sent_at: (r.sent_at as Date).toISOString(),
      completed_at: r.completed_at ? (r.completed_at as Date).toISOString() : null,
    })),
  };
}

export function patientRoutes(pool: pg.Pool, mailer?: Mailer, publicAppUrl?: string) {
  const r = new Hono<Env>();
  const run = <T>(c: Context<Env>, fn: (db: pg.PoolClient) => Promise<T>) => withUser(pool, c.get("user").id, c.get("requestId"), fn);

  // ?clinic=<id> narrows the list to the clinic the user is working in
  // (design doc §4.2). It is a filter only: RLS still decides what is visible,
  // so naming a clinic the user doesn't belong to returns an empty list.
  // ?archived=1 lists archived patients (only managers can see any).
  r.get("/", async (c) => {
    const clinic = c.req.query("clinic");
    if (clinic !== undefined && !UUID.test(clinic)) return c.json({ error: "invalid_clinic" }, 400);
    const archived = c.req.query("archived") === "1";
    // Optional: only the patients on one therapist's care team (a clinic manager looking at one therapist's list).
    const therapist = c.req.query("therapist");
    if (therapist !== undefined && !UUID.test(therapist)) return c.json({ error: "invalid_therapist" }, 400);
    const patients = await run(c, async (db) => {
      const { rows } = await db.query(
        `SELECT p.id, p.clinic_id, p.given_name, p.family_name, to_char(p.date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
                p.status, p.alert IS NOT NULL AND p.alert <> '' AS has_alert, p.deleted_at IS NOT NULL AS archived,
                -- Who the patient is assigned to: the current care team, the primary therapist first.
                COALESCE((SELECT array_agg(u.full_name ORDER BY t.role, u.full_name)
                            FROM app.patient_care_team t JOIN app.app_user u ON u.id = t.user_id
                           WHERE t.patient_id = p.id AND t.ended_at IS NULL), '{}') AS therapists
           FROM app.patient p
          WHERE (p.deleted_at IS NOT NULL) = $2 AND ($1::uuid IS NULL OR p.clinic_id = $1::uuid)
            AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM app.patient_care_team t WHERE t.patient_id = p.id AND t.user_id = $3::uuid AND t.ended_at IS NULL))
          ORDER BY p.family_name, p.given_name
          LIMIT 1000`,
        [clinic ?? null, archived, therapist ?? null],
      );
      // The clinic is recorded only if the user belongs to it, so a made-up id can't write into another clinic's log.
      await db.query(
        `SELECT app.record_audit('list', 'patient', NULL, NULL,
                CASE WHEN app.has_clinic_role($1::uuid, enum_range(NULL::app.member_role)) THEN $1::uuid END)`,
        [clinic ?? null],
      );
      return rows;
    });
    return c.json({ patients });
  });

  r.post("/", async (c) => {
    const body = await parseBody(c, createPatient);
    if (!body.ok) return body.response;
    const input = body.data;
    const me = c.get("user").id;
    const result = await run(c, async (db) => {
      const { rows: roles } = await db.query<{ staff: boolean; manager: boolean }>(
        `SELECT app.has_clinic_role($1, ARRAY['clinic_manager','org_admin','therapist']::app.member_role[]) AS staff,
                app.has_clinic_role($1, ${MANAGERS}) AS manager`,
        [input.clinic_id],
      );
      if (!roles[0]?.staff) return { error: "forbidden" as const };
      const therapist = input.therapist_id ?? me;
      if (therapist !== me && !roles[0].manager) return { error: "forbidden" as const };
      if (!input.allow_duplicate) {
        const dup = await db.query<{ d: boolean }>(`SELECT app.patient_duplicate_exists($1,$2,$3,$4) AS d`, [
          input.clinic_id, input.given_name, input.family_name, input.date_of_birth,
        ]);
        if (dup.rows[0]?.d) return { error: "possible_duplicate" as const };
      }
      const id = uuidv7();
      // No RETURNING: the creator can't see the row until the care team exists.
      await db.query(
        `INSERT INTO app.patient (id, clinic_id, given_name, family_name, date_of_birth, preferred_locale, sex, handedness, alert, colour_vision_deficiency, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [id, input.clinic_id, input.given_name, input.family_name, input.date_of_birth, input.preferred_locale,
         input.sex ?? null, input.handedness ?? null, input.alert || null, input.colour_vision_deficiency ?? false, me],
      );
      await db.query(`INSERT INTO app.patient_care_team (patient_id, user_id, role) VALUES ($1,$2,'primary')`, [id, therapist]);
      return { id };
    });
    if ("error" in result) return c.json({ error: result.error }, result.error === "forbidden" ? 403 : 409);
    return c.json(result, 201);
  });

  r.get("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const patient = await run(c, async (db) => {
      const p = await loadPatient(db, id);
      if (p) await db.query(`SELECT app.record_audit('view', 'patient', $1, $1)`, [id]);
      return p;
    });
    // Same answer for "doesn't exist" and "not yours", so ids can't be probed.
    return patient ? c.json({ patient }) : notFound(c);
  });

  r.patch("/:id", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, updatePatient);
    if (!body.ok) return body.response;
    const patch: Record<string, unknown> = { ...body.data };
    const patient = await run(c, async (db) => {
      if (patch.status === "active") {
        // "Active" only sticks with consent for clinic sessions; otherwise it waits for consent.
        const { rows } = await db.query(`SELECT EXISTS (SELECT 1 FROM app.consent_current WHERE patient_id = $1 AND purpose = 'treatment' AND decision = 'granted') AS ok`, [id]);
        patch.status = rows[0]?.ok ? "active" : "pending_consent";
      }
      if ("alert" in patch && !patch.alert) patch.alert = null;
      const cols = Object.keys(patch);
      if (cols.length) {
        const sets = cols.map((k, i) => `${k} = $${i + 2}`).join(", ");
        const res = await db.query(`UPDATE app.patient SET ${sets} WHERE id = $1 AND deleted_at IS NULL`, [id, ...cols.map((k) => patch[k])]);
        if (res.rowCount === 0) return null;
      }
      return loadPatient(db, id);
    });
    return patient ? c.json({ patient }) : notFound(c);
  });

  // Archive / restore: clinic managers only (enforced by a database trigger).
  for (const [path, archived] of [["/:id/archive", true], ["/:id/restore", false]] as const) {
    r.post(path, async (c) => {
      const id = c.req.param("id");
      if (!UUID.test(id)) return notFound(c);
      const ok = await run(c, async (db) => {
        const res = await db.query(
          `UPDATE app.patient SET deleted_at = ${archived ? "now()" : "NULL"} WHERE id = $1 AND (deleted_at IS NULL) = $2`,
          [id, archived],
        );
        return res.rowCount === 1;
      });
      return ok ? c.json({ ok: true }) : notFound(c);
    });
  }

  // ---- Guardians

  r.post("/:id/guardians", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, guardianFields);
    if (!body.ok) return body.response;
    const g = body.data;
    const guardianId = await run(c, async (db) => {
      const { rows } = await db.query(`SELECT clinic_id FROM app.patient WHERE id = $1 AND deleted_at IS NULL`, [id]);
      if (!rows[0]) return null;
      const gid = uuidv7();
      await db.query(
        `INSERT INTO app.guardian (id, clinic_id, full_name, email, phone, address, preferred_locale, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [gid, rows[0].clinic_id, g.full_name, g.email || null, g.phone || null, g.address || null, g.preferred_locale, c.get("user").id],
      );
      await db.query(
        `INSERT INTO app.guardian_patient (guardian_id, patient_id, relationship, is_legal_guardian) VALUES ($1,$2,$3,$4)`,
        [gid, id, g.relationship, g.is_legal_guardian],
      );
      return gid;
    });
    return guardianId ? c.json({ id: guardianId }, 201) : notFound(c);
  });

  r.patch("/:id/guardians/:gid", async (c) => {
    const { id, gid } = c.req.param();
    if (!UUID.test(id) || !UUID.test(gid)) return notFound(c);
    const body = await parseBody(c, guardianFields);
    if (!body.ok) return body.response;
    const g = body.data;
    const ok = await run(c, async (db) => {
      const link = await db.query(
        `UPDATE app.guardian_patient SET relationship = $3, is_legal_guardian = $4 WHERE guardian_id = $1 AND patient_id = $2`,
        [gid, id, g.relationship, g.is_legal_guardian],
      );
      if (link.rowCount === 0) return false;
      await db.query(`UPDATE app.guardian SET full_name = $2, email = $3, phone = $4, address = $5, preferred_locale = $6 WHERE id = $1`, [
        gid, g.full_name, g.email || null, g.phone || null, g.address || null, g.preferred_locale,
      ]);
      return true;
    });
    return ok ? c.json({ ok: true }) : notFound(c);
  });

  r.delete("/:id/guardians/:gid", async (c) => {
    const { id, gid } = c.req.param();
    if (!UUID.test(id) || !UUID.test(gid)) return notFound(c);
    const ok = await run(c, async (db) => (await db.query(`DELETE FROM app.guardian_patient WHERE guardian_id = $1 AND patient_id = $2`, [gid, id])).rowCount === 1);
    return ok ? c.json({ ok: true }) : notFound(c);
  });

  // ---- Portal invites (send a guardian a link to create a parent portal account)

  r.post("/:id/guardians/:gid/portal-invite", async (c) => {
    const { id, gid } = c.req.param();
    if (!UUID.test(id) || !UUID.test(gid)) return notFound(c);
    const result = await run(c, async (db) => {
      // Verify the guardian is linked to this patient and has an email
      const { rows } = await db.query(
        `SELECT g.id, g.email, g.full_name, g.user_id, g.clinic_id, g.preferred_locale,
                cl.name AS clinic_name
           FROM app.guardian g
           JOIN app.guardian_patient gp ON gp.guardian_id = g.id AND gp.patient_id = $1
           JOIN app.clinic cl ON cl.id = g.clinic_id
          WHERE g.id = $2 AND g.deleted_at IS NULL`,
        [id, gid],
      );
      if (!rows[0]) return { error: "not_found" as const };
      const guardian = rows[0];
      if (guardian.user_id) return { error: "already_registered" as const };
      if (!guardian.email) return { error: "no_email" as const };

      // Check if a user with this email already exists on the platform.
      // If so, link the guardian to the existing account immediately — no invite needed.
      const { rows: existing } = await db.query(
        `SELECT id FROM app.app_user WHERE email = $1`,
        [guardian.email],
      );
      if (existing[0]) {
        await db.query(`UPDATE app.guardian SET user_id = $1 WHERE id = $2`, [existing[0].id, gid]);
        return { linked: true as const, guardian_email: guardian.email, guardian_name: guardian.full_name };
      }

      // No existing account — create an invite for the guardian to register
      await db.query(
        `UPDATE app.portal_invite SET status = 'cancelled' WHERE guardian_id = $1 AND status = 'pending'`,
        [gid],
      );

      const inviteId = uuidv7();
      const { rows: invites } = await db.query(
        `INSERT INTO app.portal_invite (id, guardian_id, clinic_id, created_by)
         VALUES ($1, $2, $3, app.current_user_id())
         RETURNING token`,
        [inviteId, gid, guardian.clinic_id],
      );

      return {
        invite_id: inviteId,
        token: invites[0].token,
        guardian_email: guardian.email,
        guardian_name: guardian.full_name,
        clinic_name: guardian.clinic_name,
      };
    });

    if ("error" in result) {
      if (result.error === "not_found") return notFound(c);
      if (result.error === "already_registered") return c.json({ error: "already_registered" }, 409);
      if (result.error === "no_email") return c.json({ error: "no_email", message: "Guardian needs an email address for a portal invite" }, 422);
    }

    // Auto-linked to existing account — no email needed
    if ("linked" in result) {
      return c.json({ ok: true, linked: true, message: "Guardian already has an account and has been linked automatically." }, 200);
    }

    // New account needed — send the portal invite email
    if (mailer && "token" in result) {
      const portalUrl = `${publicAppUrl ?? "https://next-gen-cyan.vercel.app"}/parent/register/${result.token}`;
      void mailer.sendPortalInvite(result.guardian_email, result.clinic_name, portalUrl, "he");
    }

    return c.json(result, 201);
  });

  // ---- Consent (append-only; the latest row per purpose is current)

  r.get("/:id/consents", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const history = await run(c, async (db) => {
      const seen = await db.query(`SELECT 1 FROM app.patient WHERE id = $1`, [id]);
      if (!seen.rowCount) return null;
      const { rows } = await db.query(
        `SELECT c.id, c.purpose, c.decision, c.signed_at, c.signer_name, c.locale, c.method, c.policy_version,
                g.full_name AS guardian_name, u.full_name AS captured_by_name
           FROM app.consent c
           LEFT JOIN app.guardian g ON g.id = c.guardian_id
           LEFT JOIN app.app_user u ON u.id = c.captured_by
          WHERE c.patient_id = $1 ORDER BY c.signed_at DESC, c.id DESC`,
        [id],
      );
      return rows;
    });
    return history ? c.json({ consents: history }) : notFound(c);
  });

  r.post("/:id/consents", async (c) => {
    const id = c.req.param("id");
    if (!UUID.test(id)) return notFound(c);
    const body = await parseBody(c, recordConsent);
    if (!body.ok) return body.response;
    const input = body.data;
    const result = await run(c, async (db) => {
      const link = await db.query(
        `SELECT gp.is_legal_guardian FROM app.guardian_patient gp JOIN app.patient p ON p.id = gp.patient_id
          WHERE gp.patient_id = $1 AND gp.guardian_id = $2 AND p.deleted_at IS NULL`,
        [id, input.guardian_id],
      );
      if (!link.rows[0]) return "not_found" as const;
      if (!link.rows[0].is_legal_guardian) return "not_legal_guardian" as const;
      for (const purpose of CONSENT_PURPOSES) {
        const decision = input.decisions[purpose];
        if (!decision) continue;
        await db.query(
          `INSERT INTO app.consent (patient_id, guardian_id, purpose, decision, policy_version, method, locale, signer_name, captured_by, record_hash)
           VALUES ($1,$2,$3,$4,$5,'in_clinic_esign',$6,$7,app.current_user_id(),'\\x')`,
          [id, input.guardian_id, purpose, decision, CONSENT_POLICY_VERSION, input.locale, input.signer_name],
        );
      }
      return loadPatient(db, id);
    });
    if (result === "not_found" || result === null) return notFound(c);
    if (result === "not_legal_guardian") return c.json({ error: "not_legal_guardian" }, 422);
    return c.json({ patient: result }, 201);
  });

  // ---- Consent requests (email-based consent flow)
  if (mailer) {
    registerConsentRequestRoutes(r, pool, mailer, publicAppUrl);
  }

  return r;
}
