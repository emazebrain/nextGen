-- Fix infinite recursion in guardian/guardian_patient RLS policies on Supabase.
--
-- Root cause: all SECURITY DEFINER helper functions (can_see_patient, can_see_guardian,
-- has_clinic_role) are owned by postgres. On Supabase, postgres does NOT have BYPASSRLS.
-- When these functions query RLS-protected tables, they hit the same policies that called
-- them → infinite recursion. ALTER FUNCTION OWNER is blocked by Supabase's permission model.
--
-- Fix: replace guardian_patient policies with fully inlined checks that query only
-- membership (whose RLS uses user_id = current_user_id(), no function calls, no recursion).
-- Also rewrite can_see_guardian to avoid calling can_see_patient (which would recurse
-- through the patient table's RLS).

-- 1. Drop the recursive policies on guardian_patient
DROP POLICY IF EXISTS guardian_patient_read ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_manage ON app.guardian_patient;

-- 2. New non-recursive policies for guardian_patient.
-- These inline the membership check instead of calling has_clinic_role/can_see_patient.

-- Staff can read guardian_patient rows for patients in their clinic (manager/org_admin)
-- or on their care team (therapist/assistant). No SECURITY DEFINER functions called.
CREATE POLICY guardian_patient_staff_read ON app.guardian_patient FOR SELECT
  USING (
    EXISTS (
      -- Manager / org admin: can see all patients in their clinic
      SELECT 1 FROM app.patient p
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
        LEFT JOIN app.clinic c ON c.id = p.clinic_id
       WHERE p.id = patient_id
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
    )
    OR EXISTS (
      -- Therapist / assistant: can see patients on their care team
      SELECT 1 FROM app.patient p
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
        JOIN app.patient_care_team t ON t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        LEFT JOIN app.clinic c ON c.id = p.clinic_id
       WHERE p.id = patient_id AND p.deleted_at IS NULL
         AND m.role IN ('therapist', 'assistant')
         AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
    )
    OR EXISTS (
      -- Platform admin
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
    OR EXISTS (
      -- Guardian can see their own links
      SELECT 1 FROM app.guardian g
       WHERE g.id = guardian_id AND g.user_id = app.current_user_id() AND g.deleted_at IS NULL
    )
  );

-- Staff can write guardian_patient rows (insert/update/delete) for patients they can treat.
CREATE POLICY guardian_patient_staff_write ON app.guardian_patient FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM app.patient p
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
        LEFT JOIN app.clinic c ON c.id = p.clinic_id
       WHERE p.id = patient_id
         AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
    )
    OR EXISTS (
      SELECT 1 FROM app.patient p
        JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
        JOIN app.patient_care_team t ON t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
        LEFT JOIN app.clinic c ON c.id = p.clinic_id
       WHERE p.id = patient_id AND p.deleted_at IS NULL
         AND m.role IN ('therapist', 'assistant')
         AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
    )
    OR EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM app.guardian g JOIN app.patient p ON p.id = patient_id
       WHERE g.id = guardian_id AND g.clinic_id = p.clinic_id
    )
    AND (
      EXISTS (
        SELECT 1 FROM app.patient p
          JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
          LEFT JOIN app.clinic c ON c.id = p.clinic_id
         WHERE p.id = patient_id
           AND m.role IN ('clinic_manager', 'org_admin')
           AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
      )
      OR EXISTS (
        SELECT 1 FROM app.patient p
          JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
          JOIN app.patient_care_team t ON t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
          LEFT JOIN app.clinic c ON c.id = p.clinic_id
         WHERE p.id = patient_id AND p.deleted_at IS NULL
           AND m.role IN ('therapist', 'assistant')
           AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
      )
      OR EXISTS (
        SELECT 1 FROM app.membership m
         WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
      )
    )
  );

-- 3. Rewrite can_see_guardian to avoid calling can_see_patient (which recurses through patient RLS).
-- Inline the same membership checks directly.
CREATE OR REPLACE FUNCTION app.can_see_guardian(p_guardian uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.guardian g
     WHERE g.id = p_guardian AND g.deleted_at IS NULL
       AND (
         -- The guardian themselves (parent portal)
         g.user_id = app.current_user_id()
         -- The person who created this guardian record
         OR g.created_by = app.current_user_id()
         -- Clinic manager / org admin for this guardian's clinic
         OR EXISTS (
           SELECT 1 FROM app.membership m
             LEFT JOIN app.clinic c ON c.id = g.clinic_id
            WHERE m.user_id = app.current_user_id() AND m.status = 'active'
              AND m.role IN ('clinic_manager', 'org_admin')
              AND (m.clinic_id = g.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
         )
         -- Therapist/assistant on the care team of one of the guardian's patients
         OR EXISTS (
           SELECT 1 FROM app.guardian_patient gp
             JOIN app.patient p ON p.id = gp.patient_id AND p.deleted_at IS NULL
             JOIN app.patient_care_team t ON t.patient_id = p.id AND t.user_id = app.current_user_id() AND t.ended_at IS NULL
             JOIN app.membership m ON m.user_id = app.current_user_id() AND m.status = 'active'
             LEFT JOIN app.clinic c ON c.id = p.clinic_id
            WHERE gp.guardian_id = g.id
              AND m.role IN ('therapist', 'assistant')
              AND (m.clinic_id = p.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
         )
         -- Platform admin
         OR EXISTS (
           SELECT 1 FROM app.membership m
            WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin'
         )
       )
  )
$$;

INSERT INTO public.schema_migrations (name) VALUES ('0033_fix_guardian_rls_recursion.sql') ON CONFLICT (name) DO NOTHING;
