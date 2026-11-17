-- 0022: email-based parental consent flow (design doc: 2026-11-17-email-consent-design.md).
-- Adds a consent_request table for tracking email-based consent invitations,
-- expands the method CHECK on consent to allow 'remote_email_esign', and updates
-- consent_apply() to check that all pending requests are completed before activating.

-- ---------------------------------------------------------------- consent_request
CREATE TABLE app.consent_request (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  patient_id       uuid NOT NULL REFERENCES app.patient(id),
  guardian_id       uuid NOT NULL REFERENCES app.guardian(id),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  token            uuid NOT NULL UNIQUE DEFAULT app.uuidv7(),
  status           text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'completed', 'cancelled')),
  guardian_email    text NOT NULL,
  guardian_name     text NOT NULL,
  guardian_phone    text,
  sent_at          timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  created_by       uuid NOT NULL REFERENCES app.app_user(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE app.consent_request ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.consent_request FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE ON app.consent_request TO emb_app;

-- Clinic staff can see requests for patients in their clinic; platform admins can see all.
CREATE POLICY cr_select ON app.consent_request FOR SELECT
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist', 'assistant', 'clinic_manager', 'org_admin']::app.member_role[])
         OR app.is_platform_admin());

-- Clinic staff can create requests for patients in their clinic.
CREATE POLICY cr_insert ON app.consent_request FOR INSERT
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['therapist', 'assistant', 'clinic_manager', 'org_admin']::app.member_role[])
              AND created_by = app.current_user_id());

-- Clinic staff can update (cancel / resend) requests in their clinic; platform admins can update all.
CREATE POLICY cr_update ON app.consent_request FOR UPDATE
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist', 'assistant', 'clinic_manager', 'org_admin']::app.member_role[])
         OR app.is_platform_admin());

-- Audit trigger.
CREATE TRIGGER consent_request_audit AFTER INSERT OR UPDATE OR DELETE ON app.consent_request
  FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- Index for quick token lookup (public endpoint).
CREATE INDEX consent_request_token_ix ON app.consent_request (token) WHERE status = 'pending';

-- Index for per-patient request listing.
CREATE INDEX consent_request_patient_ix ON app.consent_request (patient_id);

-- ---------------------------------------------------------------- expand consent method
-- Expand/contract: add new method value, keeping the old ones.
-- The unnamed CHECK constraint on consent.method must be dropped and recreated.
-- Find it by column:
DO $$
DECLARE
  cname text;
BEGIN
  SELECT con.conname INTO cname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY(con.conkey)
   WHERE con.conrelid = 'app.consent'::regclass
     AND con.contype = 'c'
     AND att.attname = 'method'
   LIMIT 1;
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE app.consent DROP CONSTRAINT %I', cname);
  END IF;
END $$;

ALTER TABLE app.consent ADD CONSTRAINT consent_method_check
  CHECK (method IN ('in_clinic_esign', 'remote_signed_form', 'remote_card', 'remote_id_check', 'remote_email_esign'));

-- ---------------------------------------------------------------- consent_request_id on consent
ALTER TABLE app.consent ADD COLUMN consent_request_id uuid REFERENCES app.consent_request(id);

-- ---------------------------------------------------------------- update consent_apply
-- Now checks: only activate when no pending consent_requests remain for this patient.
CREATE OR REPLACE FUNCTION app.consent_apply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NEW.purpose = 'treatment' THEN
    IF NEW.decision = 'granted' THEN
      -- Only activate if ALL required guardians have completed their consent requests.
      IF NOT EXISTS (
        SELECT 1 FROM app.consent_request cr
         WHERE cr.patient_id = NEW.patient_id
           AND cr.status = 'pending'
      ) THEN
        UPDATE app.patient SET status = 'active'
         WHERE id = NEW.patient_id AND status IN ('pending_consent', 'consent_legacy');
      END IF;
    ELSE
      UPDATE app.patient SET status = 'pending_consent'
       WHERE id = NEW.patient_id AND status = 'active';
    END IF;
  END IF;
  RETURN NULL;
END $$;
