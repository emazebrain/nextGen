-- 0019: platform-admin policies for system administration (spec 2026-11-16).
-- Platform admins get full access to organization, clinic, app_user, and
-- membership rows. A self-activate policy lets invited users flip their own
-- status to 'active' after changing their password.

-- organization: platform admins can CRUD all rows.
CREATE POLICY org_admin_all ON app.organization FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- clinic: platform admins can CRUD all rows.
CREATE POLICY clinic_admin_all ON app.clinic FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- app_user: platform admins can see and create any user.
CREATE POLICY user_admin_all ON app.app_user FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- membership: platform admins can manage any membership.
CREATE POLICY membership_admin_all ON app.membership FOR ALL
  USING (app.is_platform_admin())
  WITH CHECK (app.is_platform_admin());

-- Self-activate: an invited user can flip their own status to 'active'.
-- The USING constrains which row (only the user's own row).
-- The WITH CHECK constrains the new value (status must be 'active').
CREATE POLICY user_self_activate ON app.app_user FOR UPDATE
  USING (id = app.current_user_id())
  WITH CHECK (id = app.current_user_id() AND status = 'active');
