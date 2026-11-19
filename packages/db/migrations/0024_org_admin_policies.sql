-- 0024: org-admin management policies.
-- Org admins can manage clinics, users and memberships within their own
-- organization. They cannot create org_admins or platform_admins, and they
-- cannot touch other organizations.

-- ---------------------------------------------------------------- helper
-- Returns TRUE when the current user is an active org_admin of the given org.
CREATE OR REPLACE FUNCTION app.is_org_admin_of(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.user_id = app.current_user_id()
      AND m.organization_id = p_org
      AND m.role = 'org_admin'
      AND m.status = 'active'
  )
$$;
ALTER FUNCTION app.is_org_admin_of(uuid) OWNER TO emb_rls_helper;

-- ---------------------------------------------------------------- organization
DROP POLICY IF EXISTS org_admin_read ON app.organization;
CREATE POLICY org_admin_read ON app.organization FOR SELECT
  USING (app.is_org_admin_of(id));

-- ---------------------------------------------------------------- clinic
DROP POLICY IF EXISTS clinic_org_admin_read ON app.clinic;
CREATE POLICY clinic_org_admin_read ON app.clinic FOR SELECT
  USING (app.is_org_admin_of(organization_id));

DROP POLICY IF EXISTS clinic_org_admin_insert ON app.clinic;
CREATE POLICY clinic_org_admin_insert ON app.clinic FOR INSERT
  WITH CHECK (app.is_org_admin_of(organization_id));

DROP POLICY IF EXISTS clinic_org_admin_update ON app.clinic;
CREATE POLICY clinic_org_admin_update ON app.clinic FOR UPDATE
  USING (app.is_org_admin_of(organization_id));

-- ---------------------------------------------------------------- app_user
DROP POLICY IF EXISTS user_org_admin_read ON app.app_user;
CREATE POLICY user_org_admin_read ON app.app_user FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.user_id = app_user.id
      AND m.status <> 'revoked'
      AND app.is_org_admin_of(m.organization_id)
  ));

DROP POLICY IF EXISTS user_org_admin_insert ON app.app_user;
CREATE POLICY user_org_admin_insert ON app.app_user FOR INSERT
  WITH CHECK (TRUE);

DROP POLICY IF EXISTS user_org_admin_update ON app.app_user;
CREATE POLICY user_org_admin_update ON app.app_user FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.user_id = app_user.id
      AND m.status <> 'revoked'
      AND app.is_org_admin_of(m.organization_id)
  ));

-- ---------------------------------------------------------------- membership
DROP POLICY IF EXISTS membership_org_admin_read ON app.membership;
CREATE POLICY membership_org_admin_read ON app.membership FOR SELECT
  USING (app.is_org_admin_of(organization_id));

DROP POLICY IF EXISTS membership_org_admin_insert ON app.membership;
CREATE POLICY membership_org_admin_insert ON app.membership FOR INSERT
  WITH CHECK (
    app.is_org_admin_of(organization_id)
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );

DROP POLICY IF EXISTS membership_org_admin_update ON app.membership;
CREATE POLICY membership_org_admin_update ON app.membership FOR UPDATE
  USING (app.is_org_admin_of(organization_id))
  WITH CHECK (
    app.is_org_admin_of(organization_id)
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );
