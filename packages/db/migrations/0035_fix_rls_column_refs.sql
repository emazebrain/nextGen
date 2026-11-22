-- Fix column reference bugs in inlined RLS policies and remaining recursion.
--
-- The migrations 0033/0034 had unqualified column names (clinic_id, id) that
-- PostgreSQL resolved to the subquery's own tables instead of the outer policy
-- table. All references now use explicit table-name prefixes.
-- Also simplifies guardian_patient_read to avoid guardian→guardian_patient recursion.

-- ============= CLINIC =============
DROP POLICY IF EXISTS clinic_member_read ON app.clinic;
CREATE POLICY clinic_member_read ON app.clinic FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND (m.clinic_id = clinic.id OR (m.clinic_id IS NULL AND m.organization_id = clinic.organization_id))
    )
  );

-- ============= PATIENT_CARE_TEAM =============
DROP POLICY IF EXISTS care_team_read ON app.patient_care_team;
CREATE POLICY care_team_read ON app.patient_care_team FOR SELECT
  USING (
    patient_care_team.user_id = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
    )
  );

-- ============= PATIENT =============
DROP POLICY IF EXISTS patient_read ON app.patient;
CREATE POLICY patient_read ON app.patient FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = patient.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = patient.clinic_id)))
    )
    OR (
      patient.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM app.membership m
          JOIN app.patient_care_team t ON t.patient_id = patient.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
         WHERE m.user_id = app.current_user_id() AND m.status = 'active'
           AND m.role IN ('therapist', 'assistant')
           AND (m.clinic_id = patient.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = patient.clinic_id)))
      )
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
    OR EXISTS (
      SELECT 1 FROM app.guardian g
        JOIN app.guardian_patient gp ON gp.guardian_id = g.id AND gp.patient_id = patient.id
       WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL
    )
  );

DROP POLICY IF EXISTS patient_admin_read ON app.patient;
DROP POLICY IF EXISTS patient_guardian ON app.patient;

DROP POLICY IF EXISTS patient_update ON app.patient;
CREATE POLICY patient_update ON app.patient FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = patient.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = patient.clinic_id)))
    )
    OR (
      patient.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM app.membership m
          JOIN app.patient_care_team t ON t.patient_id = patient.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
         WHERE m.user_id = app.current_user_id() AND m.status = 'active'
           AND m.role IN ('therapist', 'assistant')
           AND (m.clinic_id = patient.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = patient.clinic_id)))
      )
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

DROP POLICY IF EXISTS patient_admin_update ON app.patient;

-- ============= GUARDIAN =============
DROP POLICY IF EXISTS guardian_read ON app.guardian;
CREATE POLICY guardian_read ON app.guardian FOR SELECT
  USING (
    guardian.user_id = app.current_user_id()
    OR guardian.created_by = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = guardian.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = guardian.clinic_id)))
    )
    OR EXISTS (
      SELECT 1 FROM app.guardian_patient gp
        JOIN app.patient_care_team t ON t.patient_id = gp.patient_id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
       WHERE gp.guardian_id = guardian.id AND m.role IN ('therapist', 'assistant')
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

DROP POLICY IF EXISTS guardian_update ON app.guardian;
CREATE POLICY guardian_update ON app.guardian FOR UPDATE
  USING (
    guardian.user_id = app.current_user_id()
    OR guardian.created_by = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = guardian.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = guardian.clinic_id)))
    )
    OR EXISTS (
      SELECT 1 FROM app.guardian_patient gp
        JOIN app.patient_care_team t ON t.patient_id = gp.patient_id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
       WHERE gp.guardian_id = guardian.id AND m.role IN ('therapist', 'assistant')
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin', 'therapist')
         AND (m.clinic_id = guardian.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = guardian.clinic_id)))
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

-- ============= GUARDIAN_PATIENT =============
DROP POLICY IF EXISTS guardian_patient_read ON app.guardian_patient;
CREATE POLICY guardian_patient_read ON app.guardian_patient FOR SELECT
  USING (app.current_user_id() IS NOT NULL);

INSERT INTO public.schema_migrations (name) VALUES ('0035_fix_rls_column_refs.sql') ON CONFLICT (name) DO NOTHING;
