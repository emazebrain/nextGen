-- Allow guardians to see clinics where their children are patients.
-- Without this, the JOIN on clinic in /v1/parent/me returns no rows
-- because guardians have no membership → clinic_member_read blocks them.

DROP POLICY IF EXISTS clinic_member_read ON app.clinic;
CREATE POLICY clinic_member_read ON app.clinic FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM app.membership m
       WHERE m.user_id = app.current_user_id() AND m.status = 'active'
         AND (m.clinic_id = clinic.id OR (m.clinic_id IS NULL AND m.organization_id = clinic.organization_id))
    )
    OR EXISTS (
      SELECT 1 FROM app.guardian g
        JOIN app.guardian_patient gp ON gp.guardian_id = g.id
        JOIN app.patient p ON p.id = gp.patient_id AND p.clinic_id = clinic.id
       WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL
    )
  );

INSERT INTO public.schema_migrations (name) VALUES ('0038_clinic_guardian_access.sql') ON CONFLICT (name) DO NOTHING;
