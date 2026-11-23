-- Replace membership policies with GUC-based checks to break self-recursion.
--
-- Problem: membership policies that call is_platform_admin(), has_clinic_role(),
-- or is_org_admin_of() query the membership table from within its own policies.
-- For users with zero membership rows (guardians), PostgreSQL evaluates every
-- branch and hits infinite recursion.
--
-- Fix: withUser now caches roles in transaction-local GUC variables:
--   app.is_admin        = 'true' | 'false'
--   app.manager_clinics = comma-separated clinic UUIDs (clinic_manager role)
--   app.admin_orgs      = comma-separated org UUIDs (org_admin role)
-- These are set BEFORE SET LOCAL ROLE, using only membership_own (safe).
-- Membership policies then check GUCs instead of querying themselves.

-- ===== membership_admin_all: platform admin sees/manages all =====
DROP POLICY IF EXISTS membership_admin_all ON app.membership;
CREATE POLICY membership_admin_all ON app.membership FOR ALL
  USING (current_setting('app.is_admin', true) = 'true')
  WITH CHECK (current_setting('app.is_admin', true) = 'true');

-- ===== membership_manager: clinic managers manage their clinic's memberships =====
DROP POLICY IF EXISTS membership_manager ON app.membership;
CREATE POLICY membership_manager ON app.membership FOR ALL
  USING (
    clinic_id IS NOT NULL
    AND (
      clinic_id::text = ANY(string_to_array(current_setting('app.manager_clinics', true), ','))
      OR EXISTS (
        SELECT 1 FROM app.clinic c
         WHERE c.id = membership.clinic_id
           AND c.organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
      )
    )
  )
  WITH CHECK (
    clinic_id IS NOT NULL
    AND (
      clinic_id::text = ANY(string_to_array(current_setting('app.manager_clinics', true), ','))
      OR EXISTS (
        SELECT 1 FROM app.clinic c
         WHERE c.id = membership.clinic_id
           AND c.organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
      )
    )
    AND role NOT IN ('platform_admin', 'org_admin', 'clinic_manager')
  );

-- ===== membership_org_admin_*: org admins see/manage their org's memberships =====
DROP POLICY IF EXISTS membership_org_admin_read ON app.membership;
CREATE POLICY membership_org_admin_read ON app.membership FOR SELECT
  USING (
    organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
  );

DROP POLICY IF EXISTS membership_org_admin_insert ON app.membership;
CREATE POLICY membership_org_admin_insert ON app.membership FOR INSERT
  WITH CHECK (
    organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );

DROP POLICY IF EXISTS membership_org_admin_update ON app.membership;
CREATE POLICY membership_org_admin_update ON app.membership FOR UPDATE
  USING (
    organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
  )
  WITH CHECK (
    organization_id::text = ANY(string_to_array(current_setting('app.admin_orgs', true), ','))
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );

INSERT INTO public.schema_migrations (name) VALUES ('0037_membership_guc_policies.sql') ON CONFLICT (name) DO NOTHING;
