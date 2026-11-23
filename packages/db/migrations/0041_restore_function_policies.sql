-- 0041: one loop-free set of access rules for patients, guardians, their links, care teams and memberships.
--
-- What went wrong. Migration 0025 (parent portal) added patient_guardian, a policy on patient that queried
-- guardian_patient directly. guardian_patient's own policy checked patient directly. Each table's rule led to the
-- other, and Postgres refuses such a loop ("infinite recursion detected in policy") whatever the data.
-- Migrations 0033–0039 then assumed the helper functions could not bypass RLS on the host and replaced them with
-- queries written into the policies. That was the wrong diagnosis: the helpers are SECURITY DEFINER and owned by
-- roles that do bypass RLS (emb_rls_helper, or the migration role), locally and on the host alike. The inlined
-- rules were loop-prone, and three were wrong: any signed-in user could read every guardian link, any staff member
-- could read every care-team row and link any guardian to any patient, and the membership rules depended on
-- settings the API never sets, so admins and managers could not manage memberships.
--
-- The rule this migration restores: a policy never queries another RLS table directly. It calls a SECURITY DEFINER
-- helper, which reads past RLS and so cannot loop. packages/db/test/rls.test.ts plans every statement on every
-- table to keep it that way.
--
-- The live database also carries hand-applied policy names that no migration created; every name from either
-- history is dropped here, so both end up identical.

-- ---------------------------------------------------------------- helpers
-- New helpers stay owned by the role running the migration, which bypasses RLS wherever this runs (a superuser
-- locally, a BYPASSRLS role on the host). They are SECURITY DEFINER with a pinned search_path, like the others.

-- The signed-in user is a guardian linked to this patient (parent portal).
CREATE OR REPLACE FUNCTION app.is_guardian_of(p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.guardian_patient gp
      JOIN app.guardian g ON g.id = gp.guardian_id
     WHERE gp.patient_id = p_patient AND g.user_id = app.current_user_id() AND g.deleted_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION app.is_guardian_of(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_guardian_of(uuid) TO emb_app;

-- A guardian may only be linked to a patient of the same clinic.
CREATE OR REPLACE FUNCTION app.guardian_in_patient_clinic(p_guardian uuid, p_patient uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.guardian g
      JOIN app.patient p ON p.id = p_patient
     WHERE g.id = p_guardian AND g.clinic_id = p.clinic_id
  );
$$;
REVOKE ALL ON FUNCTION app.guardian_in_patient_clinic(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.guardian_in_patient_clinic(uuid, uuid) TO emb_app;

-- ---------------------------------------------------------------- membership
DROP POLICY IF EXISTS membership_own              ON app.membership;
DROP POLICY IF EXISTS membership_admin_all        ON app.membership;
DROP POLICY IF EXISTS membership_manager          ON app.membership;
DROP POLICY IF EXISTS membership_org_admin_read   ON app.membership;
DROP POLICY IF EXISTS membership_org_admin_insert ON app.membership;
DROP POLICY IF EXISTS membership_org_admin_update ON app.membership;

CREATE POLICY membership_own ON app.membership FOR SELECT USING (user_id = app.current_user_id());
CREATE POLICY membership_admin_all ON app.membership FOR ALL
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
CREATE POLICY membership_manager ON app.membership FOR ALL
  USING (clinic_id IS NOT NULL AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]))
  WITH CHECK (
    clinic_id IS NOT NULL
    AND app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
    AND role NOT IN ('platform_admin', 'org_admin', 'clinic_manager')
  );
CREATE POLICY membership_org_admin_read ON app.membership FOR SELECT USING (app.is_org_admin_of(organization_id));
CREATE POLICY membership_org_admin_insert ON app.membership FOR INSERT
  WITH CHECK (app.is_org_admin_of(organization_id) AND role IN ('therapist', 'assistant', 'clinic_manager'));
CREATE POLICY membership_org_admin_update ON app.membership FOR UPDATE
  USING (app.is_org_admin_of(organization_id))
  WITH CHECK (app.is_org_admin_of(organization_id) AND role IN ('therapist', 'assistant', 'clinic_manager'));

-- ---------------------------------------------------------------- patient
DROP POLICY IF EXISTS patient_read         ON app.patient;
DROP POLICY IF EXISTS patient_update       ON app.patient;
DROP POLICY IF EXISTS patient_guardian     ON app.patient;
DROP POLICY IF EXISTS patient_admin_read   ON app.patient;
DROP POLICY IF EXISTS patient_admin_update ON app.patient;

CREATE POLICY patient_read ON app.patient FOR SELECT USING (app.can_see_patient(id));
CREATE POLICY patient_update ON app.patient FOR UPDATE
  USING (app.can_see_patient(id))
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));
CREATE POLICY patient_guardian ON app.patient FOR SELECT USING (app.is_guardian_of(id));
CREATE POLICY patient_admin_read ON app.patient FOR SELECT USING (app.is_platform_admin());
CREATE POLICY patient_admin_update ON app.patient FOR UPDATE
  USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- ---------------------------------------------------------------- guardian
DROP POLICY IF EXISTS guardian_read   ON app.guardian;
DROP POLICY IF EXISTS guardian_update ON app.guardian;

CREATE POLICY guardian_read ON app.guardian FOR SELECT USING (app.can_see_guardian(id));
CREATE POLICY guardian_update ON app.guardian FOR UPDATE
  USING (app.can_see_guardian(id))
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin', 'therapist']::app.member_role[]));

-- ---------------------------------------------------------------- guardian_patient
DROP POLICY IF EXISTS guardian_patient_read        ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_manage      ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_staff_read  ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_staff_write ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_write       ON app.guardian_patient;
DROP POLICY IF EXISTS guardian_patient_delete      ON app.guardian_patient;

-- Links are seen and changed by whoever may see the patient; a guardian sees their own links.
CREATE POLICY guardian_patient_read ON app.guardian_patient FOR SELECT
  USING (app.can_see_patient(patient_id) OR app.is_guardian_of(patient_id));
CREATE POLICY guardian_patient_manage ON app.guardian_patient FOR ALL
  USING (app.can_see_patient(patient_id))
  WITH CHECK (app.can_see_patient(patient_id) AND app.guardian_in_patient_clinic(guardian_id, patient_id));

-- ---------------------------------------------------------------- patient_care_team
DROP POLICY IF EXISTS care_team_read ON app.patient_care_team;
CREATE POLICY care_team_read ON app.patient_care_team FOR SELECT USING (app.can_see_patient(patient_id));
