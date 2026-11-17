-- 0023: platform-admin policies for patient, guardian, guardian_patient,
-- and consent_request tables.
-- Migration 0019 added admin policies for org/clinic/app_user/membership
-- but missed these tables, so platform admins could not see or manage
-- patients unless they also held a clinic-level role.

-- patient: platform admins can read and update all patients.
CREATE POLICY patient_admin_read ON app.patient FOR SELECT
  USING (app.is_platform_admin());
CREATE POLICY patient_admin_update ON app.patient FOR UPDATE
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());
CREATE POLICY patient_admin_insert ON app.patient FOR INSERT
  WITH CHECK (app.is_platform_admin());

-- guardian: platform admins can read and manage all guardians.
CREATE POLICY guardian_admin_all ON app.guardian FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- guardian_patient: platform admins can manage all links.
CREATE POLICY guardian_patient_admin_all ON app.guardian_patient FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- consent_request: cr_insert currently lacks is_platform_admin();
-- add an admin insert policy so platform admins can create requests.
CREATE POLICY cr_admin_insert ON app.consent_request FOR INSERT
  WITH CHECK (app.is_platform_admin() AND created_by = app.current_user_id());

-- consent: platform admins can read all consent records (append-only,
-- so no UPDATE/DELETE policy needed — triggers enforce immutability).
CREATE POLICY consent_admin_read ON app.consent FOR SELECT
  USING (app.is_platform_admin());

-- patient_care_team: platform admins can read and manage care teams.
CREATE POLICY care_team_admin_all ON app.patient_care_team FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());
