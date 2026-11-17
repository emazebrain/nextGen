-- 0021: platform-admin template scoping.
-- Platform admins can create templates at three scopes:
--   clinic_id IS NULL AND organization_id IS NULL → platform-wide (visibility = 'platform')
--   clinic_id IS NULL AND organization_id IS NOT NULL → org-wide (visibility = 'platform')
--   clinic_id IS NOT NULL → clinic-scoped (existing behaviour, visibility = 'private'|'clinic')
-- Admin-created templates are only editable by other admins.
-- Non-admins can duplicate them (parent_template_id) and edit the copy.

-- 1. Relax the scope constraint: platform visibility no longer requires clinic_id IS NULL.
--    The new rule: if clinic_id is set, visibility must be 'private' or 'clinic';
--    if clinic_id is NULL, visibility must be 'platform'.
ALTER TABLE app.protocol_template DROP CONSTRAINT template_scope;
ALTER TABLE app.protocol_template ADD CONSTRAINT template_scope CHECK (
  (clinic_id IS NOT NULL AND visibility IN ('private', 'clinic'))
  OR (clinic_id IS NULL AND visibility = 'platform')
);

-- 2. Update can_edit_template: platform admins can edit any non-deleted template.
CREATE OR REPLACE FUNCTION app.can_edit_template(p_template uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.protocol_template t
     WHERE t.id = p_template AND t.deleted_at IS NULL
       AND (
         -- Platform admin can edit anything
         app.is_platform_admin()
         -- Clinic staff edit clinic-scoped templates they own or manage
         OR (t.clinic_id IS NOT NULL AND (
           (t.owner_user_id = app.current_user_id() AND app.has_clinic_role(t.clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
           OR app.has_clinic_role(t.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         ))
       ))
$$;

-- 3. Update can_see_template: also let platform admins see everything.
CREATE OR REPLACE FUNCTION app.can_see_template(p_template uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.protocol_template t
     WHERE t.id = p_template AND t.deleted_at IS NULL
       AND (
         app.is_platform_admin()
         OR (t.visibility = 'platform' AND EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active'))
         OR (t.visibility = 'clinic' AND app.has_clinic_role(t.clinic_id, enum_range(NULL::app.member_role)))
         OR (t.owner_user_id = app.current_user_id() AND app.has_clinic_role(t.clinic_id, enum_range(NULL::app.member_role)))
         OR app.has_clinic_role(t.clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
       ))
$$;

-- 4. Expand the INSERT policy: platform admins can insert at any scope.
DROP POLICY template_insert ON app.protocol_template;
CREATE POLICY template_insert ON app.protocol_template FOR INSERT
  WITH CHECK (
    -- Platform admin: any scope
    (app.is_platform_admin() AND owner_user_id = app.current_user_id())
    -- Non-admin: clinic-scoped only (existing behaviour)
    OR (clinic_id IS NOT NULL AND owner_user_id = app.current_user_id() AND visibility IN ('private', 'clinic')
        AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
  );

-- 5. Expand the UPDATE policy: platform admins can update any template.
DROP POLICY template_update ON app.protocol_template;
CREATE POLICY template_update ON app.protocol_template FOR UPDATE
  USING (app.can_edit_template(id))
  WITH CHECK (
    app.is_platform_admin()
    OR (clinic_id IS NOT NULL AND visibility IN ('private', 'clinic')
        AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
  );

-- 6. Admin delete policy (soft-delete via UPDATE is covered by template_update above;
--    add an explicit DELETE policy for admins if hard-delete were ever needed).
-- Not adding a DELETE policy since we soft-delete.

-- 7. Add index for org-scoped template lookup.
CREATE INDEX template_org_ix ON app.protocol_template (organization_id) WHERE deleted_at IS NULL AND clinic_id IS NULL;
