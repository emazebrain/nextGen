-- Replace all is_platform_admin() calls in RLS policies with inlined membership checks.
--
-- is_platform_admin() is SECURITY DEFINER owned by postgres (no BYPASSRLS on Supabase).
-- It queries membership → membership_admin_all calls is_platform_admin() → recursion.
-- This only manifests for users with zero membership rows (guardians/parents), because
-- PostgreSQL can't short-circuit through membership_own for them.
--
-- Fix: replace every *_admin_all policy (and others calling is_platform_admin) with a
-- direct membership check: EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id =
-- app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin').
-- This hits membership_own (user_id = current_user_id()) which never recurses.

-- Helper: the inlined check we use everywhere
-- (can't use a function because SECURITY DEFINER + no BYPASSRLS = same problem)

-- ===== membership =====
DROP POLICY IF EXISTS membership_admin_all ON app.membership;
CREATE POLICY membership_admin_all ON app.membership FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m2 WHERE m2.user_id = app.current_user_id() AND m2.status = 'active' AND m2.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m2 WHERE m2.user_id = app.current_user_id() AND m2.status = 'active' AND m2.role = 'platform_admin')
  );

-- ===== app_user =====
DROP POLICY IF EXISTS user_admin_all ON app.app_user;
CREATE POLICY user_admin_all ON app.app_user FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== clinic =====
DROP POLICY IF EXISTS clinic_admin_all ON app.clinic;
CREATE POLICY clinic_admin_all ON app.clinic FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== organization =====
DROP POLICY IF EXISTS org_admin_all ON app.organization;
CREATE POLICY org_admin_all ON app.organization FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== patient_care_team =====
DROP POLICY IF EXISTS care_team_admin_all ON app.patient_care_team;
CREATE POLICY care_team_admin_all ON app.patient_care_team FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== guardian =====
DROP POLICY IF EXISTS guardian_admin_all ON app.guardian;
CREATE POLICY guardian_admin_all ON app.guardian FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== guardian_patient =====
DROP POLICY IF EXISTS guardian_patient_admin_all ON app.guardian_patient;
CREATE POLICY guardian_patient_admin_all ON app.guardian_patient FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== consent =====
DROP POLICY IF EXISTS consent_admin_read ON app.consent;
CREATE POLICY consent_admin_read ON app.consent FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== brain_region =====
DROP POLICY IF EXISTS region_write ON app.brain_region;
CREATE POLICY region_write ON app.brain_region FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== region_setting =====
DROP POLICY IF EXISTS rsetting_write ON app.region_setting;
CREATE POLICY rsetting_write ON app.region_setting FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== file_object =====
DROP POLICY IF EXISTS file_write ON app.file_object;
CREATE POLICY file_write ON app.file_object FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== video =====
DROP POLICY IF EXISTS video_write ON app.video;
CREATE POLICY video_write ON app.video FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== video_i18n =====
DROP POLICY IF EXISTS vi18n_write ON app.video_i18n;
CREATE POLICY vi18n_write ON app.video_i18n FOR ALL
  USING (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

-- ===== patient_admin_insert =====
DROP POLICY IF EXISTS patient_admin_insert ON app.patient;
CREATE POLICY patient_admin_insert ON app.patient FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
  );

INSERT INTO public.schema_migrations (name) VALUES ('0036_inline_is_platform_admin.sql') ON CONFLICT (name) DO NOTHING;
