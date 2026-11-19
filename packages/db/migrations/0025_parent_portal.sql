-- 0025: Parent portal support (design doc §5.10).
-- Guardians can create a portal account (kind='guardian' in app_user)
-- linked by guardian.user_id. The kid-mode PIN lives on the guardian row.

-- Index for auth lookups: "which guardian rows belong to this user?"
CREATE INDEX IF NOT EXISTS guardian_user_ix ON app.guardian (user_id) WHERE user_id IS NOT NULL AND deleted_at IS NULL;

-- Kid-mode PIN: a 4-digit PIN hashed with pgcrypto; set during parent onboarding.
-- NULL means not yet configured.
ALTER TABLE app.guardian ADD COLUMN IF NOT EXISTS kid_mode_pin_hash text;

-- Portal invitation: a token-based invite for the guardian to create a portal account.
-- Separate from consent_request (consent may already be done in-clinic on paper).
CREATE TABLE IF NOT EXISTS app.portal_invite (
  id           uuid PRIMARY KEY DEFAULT app.uuidv7(),
  guardian_id  uuid NOT NULL REFERENCES app.guardian(id),
  clinic_id    uuid NOT NULL REFERENCES app.clinic(id),
  token        uuid NOT NULL DEFAULT app.uuidv7(),
  status       text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'cancelled')),
  created_by   uuid NOT NULL REFERENCES app.app_user(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  accepted_at  timestamptz
);
CREATE UNIQUE INDEX portal_invite_token_uq ON app.portal_invite (token) WHERE status = 'pending';
CREATE INDEX portal_invite_guardian_ix ON app.portal_invite (guardian_id) WHERE status = 'pending';

ALTER TABLE app.portal_invite ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.portal_invite FORCE ROW LEVEL SECURITY;

-- Staff who can see the guardian can see/manage invites.
CREATE POLICY portal_invite_read ON app.portal_invite FOR SELECT
  USING (app.can_see_guardian(guardian_id));
CREATE POLICY portal_invite_insert ON app.portal_invite FOR INSERT
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));
CREATE POLICY portal_invite_update ON app.portal_invite FOR UPDATE
  USING (app.can_see_guardian(guardian_id))
  WITH CHECK (app.can_see_guardian(guardian_id));

GRANT SELECT, INSERT, UPDATE ON app.portal_invite TO emb_app;

-- RLS for guardian users: a guardian user can see their own app_user row.
-- The existing user_self policy covers this. We add a policy so guardian users
-- can read their own guardian rows and their children's patient records.
CREATE POLICY guardian_self ON app.guardian FOR SELECT
  USING (user_id = app.current_user_id());

-- Guardian can see their own children via guardian_patient.
CREATE POLICY patient_guardian ON app.patient FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM app.guardian_patient gp
    JOIN app.guardian g ON g.id = gp.guardian_id
    WHERE gp.patient_id = patient.id
      AND g.user_id = app.current_user_id()
      AND g.deleted_at IS NULL
  ));
