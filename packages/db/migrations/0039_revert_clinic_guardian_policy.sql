-- Revert clinic_member_read to staff-only (no guardian branch).
-- Parent routes now use a service-level pool (no RLS), so guardian
-- branches in RLS policies are unnecessary and cause recursion.

DROP POLICY IF EXISTS clinic_member_read ON app.clinic;
CREATE POLICY clinic_member_read ON app.clinic FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND (m.clinic_id = clinic.id OR (m.clinic_id IS NULL AND m.organization_id = clinic.organization_id))
    )
  );

INSERT INTO public.schema_migrations (name) VALUES ('0039_revert_clinic_guardian_policy.sql') ON CONFLICT (name) DO NOTHING;
