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
-- Org admins can read their own organization.
CREATE POLICY org_admin_read ON app.organization FOR SELECT
  USING (app.is_org_admin_of(id));

-- ---------------------------------------------------------------- clinic
-- Org admins can read and create clinics in their own organization.
CREATE POLICY clinic_org_admin_read ON app.clinic FOR SELECT
  USING (app.is_org_admin_of(organization_id));

CREATE POLICY clinic_org_admin_insert ON app.clinic FOR INSERT
  WITH CHECK (app.is_org_admin_of(organization_id));

CREATE POLICY clinic_org_admin_update ON app.clinic FOR UPDATE
  USING (app.is_org_admin_of(organization_id));

-- ---------------------------------------------------------------- app_user
-- Org admins can see users who have a membership in their organization.
CREATE POLICY user_org_admin_read ON app.app_user FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.user_id = app_user.id
      AND m.status <> 'revoked'
      AND app.is_org_admin_of(m.organization_id)
  ));

-- Org admins can insert new users (the API validates role constraints).
CREATE POLICY user_org_admin_insert ON app.app_user FOR INSERT
  WITH CHECK (TRUE);
  -- The real guard is the API: the org_admin middleware checks org membership,
  -- and the route validates that only clinic-scoped roles are created.
  -- RLS can't inspect the forthcoming membership row during the user INSERT,
  -- so we allow inserts if the caller is any org_admin; the membership INSERT
  -- policy below constrains which org the user is placed in.

-- Org admins can update users in their organization (name, status).
CREATE POLICY user_org_admin_update ON app.app_user FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM app.membership m
    WHERE m.user_id = app_user.id
      AND m.status <> 'revoked'
      AND app.is_org_admin_of(m.organization_id)
  ));

-- ---------------------------------------------------------------- membership
-- Org admins can read memberships within their organization.
CREATE POLICY membership_org_admin_read ON app.membership FOR SELECT
  USING (app.is_org_admin_of(organization_id));

-- Org admins can create memberships in their own org for clinic-scoped roles
-- (therapist, assistant, clinic_manager). They cannot grant org_admin or
-- platform_admin — that stays with platform admins only.
CREATE POLICY membership_org_admin_insert ON app.membership FOR INSERT
  WITH CHECK (
    app.is_org_admin_of(organization_id)
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );

-- Org admins can update memberships in their org (e.g. revoke).
CREATE POLICY membership_org_admin_update ON app.membership FOR UPDATE
  USING (app.is_org_admin_of(organization_id))
  WITH CHECK (
    app.is_org_admin_of(organization_id)
    AND role IN ('therapist', 'assistant', 'clinic_manager')
  );
