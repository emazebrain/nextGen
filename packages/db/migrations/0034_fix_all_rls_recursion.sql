-- Comprehensive RLS fix for Supabase where postgres has no BYPASSRLS.
--
-- All SECURITY DEFINER helper functions (has_clinic_role, can_see_patient, etc.)
-- recurse because they query RLS-protected tables as postgres (no BYPASSRLS).
-- Fix: replace key SELECT policies with inlined membership checks.
-- The only table whose RLS never recurses is `membership` (uses user_id = current_user_id()).
--
-- Fix order matters: clinic first (others reference it), then patient_care_team,
-- then patient, then guardian. guardian_patient was already fixed in 0033.

-- ============================================================ 1. CLINIC
-- Old policy: clinic_member_read calls has_clinic_role(id, ...) which queries
-- clinic itself → recursion. Replace with direct membership check.
DROP POLICY IF EXISTS clinic_member_read ON app.clinic;
CREATE POLICY clinic_member_read ON app.clinic FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND (m.clinic_id = id OR (m.clinic_id IS NULL AND m.organization_id = organization_id))
    )
  );

-- ============================================================ 2. PATIENT_CARE_TEAM
-- Old policy: care_team_read calls can_see_patient(patient_id) → recursion.
DROP POLICY IF EXISTS care_team_read ON app.patient_care_team;
CREATE POLICY care_team_read ON app.patient_care_team FOR SELECT
  USING (
    -- The user themselves is on this care team row
    user_id = app.current_user_id()
    -- Or they are a manager/org_admin for this patient's clinic
    OR EXISTS (
      SELECT 1 FROM app.patient p
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
       WHERE p.id = patient_id
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = p.clinic_id)))
    )
    -- Platform admin
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

-- ============================================================ 3. PATIENT
-- Old policy: patient_read calls can_see_patient(id) → queries patient → recursion.
-- Note: patient_care_team is now safe (fixed above) and clinic is safe (fixed above).
DROP POLICY IF EXISTS patient_read ON app.patient;
CREATE POLICY patient_read ON app.patient FOR SELECT
  USING (
    -- Manager / org admin for this clinic
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = clinic_id)))
    )
    -- Therapist / assistant on the care team
    OR (
      deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM app.membership m
          JOIN app.patient_care_team t ON t.patient_id = id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
         WHERE m.user_id = app.current_user_id() AND m.status = 'active'
           AND m.role IN ('therapist', 'assistant')
           AND (m.clinic_id = clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = clinic_id)))
      )
    )
    -- Platform admin
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
    -- Guardian (parent portal): can see their own children
    OR EXISTS (
      SELECT 1 FROM app.guardian g
        JOIN app.guardian_patient gp ON gp.guardian_id = g.id AND gp.patient_id = id
       WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL
    )
  );

-- ============================================================ 4. GUARDIAN
-- Old policies: guardian_read and guardian_update call can_see_guardian(id)
-- which queries guardian itself → recursion.
DROP POLICY IF EXISTS guardian_read ON app.guardian;
CREATE POLICY guardian_read ON app.guardian FOR SELECT
  USING (
    -- The guardian themselves (parent portal)
    user_id = app.current_user_id()
    -- The person who created this guardian record
    OR created_by = app.current_user_id()
    -- Manager / org admin for this guardian's clinic
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = clinic_id)))
    )
    -- Therapist/assistant on the care team of one of the guardian's patients
    OR EXISTS (
      SELECT 1 FROM app.guardian_patient gp
        JOIN app.patient_care_team t ON t.patient_id = gp.patient_id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
       WHERE gp.guardian_id = id
         AND m.role IN ('therapist', 'assistant')
    )
    -- Platform admin
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

DROP POLICY IF EXISTS guardian_update ON app.guardian;
CREATE POLICY guardian_update ON app.guardian FOR UPDATE
  USING (
    user_id = app.current_user_id()
    OR created_by = app.current_user_id()
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = clinic_id)))
    )
    OR EXISTS (
      SELECT 1 FROM app.guardian_patient gp
        JOIN app.patient_care_team t ON t.patient_id = gp.patient_id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
       WHERE gp.guardian_id = id AND m.role IN ('therapist', 'assistant')
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
         AND (m.clinic_id = clinic_id OR (m.clinic_id IS NULL AND m.organization_id = (SELECT c.organization_id FROM app.clinic c WHERE c.id = clinic_id)))
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  );

INSERT INTO public.schema_migrations (name) VALUES ('0034_fix_all_rls_recursion.sql') ON CONFLICT (name) DO NOTHING;
