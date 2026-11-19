-- 0028: Appointments — ad-hoc calendar entries not tied to a protocol (§5.13).

CREATE TABLE IF NOT EXISTS app.appointment (
  id            uuid PRIMARY KEY DEFAULT app.uuidv7(),
  clinic_id     uuid NOT NULL REFERENCES app.clinic(id),
  patient_id    uuid NOT NULL REFERENCES app.patient(id),
  created_by    uuid NOT NULL REFERENCES app.app_user(id),
  title         text NOT NULL DEFAULT '' CHECK (length(title) <= 255),
  notes         text NOT NULL DEFAULT '' CHECK (length(notes) <= 2000),
  date          date NOT NULL,
  start_time    time NOT NULL,
  end_time      time NOT NULL,
  status        text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'completed', 'cancelled', 'no_show')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_time_order CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS appointment_clinic_date_ix ON app.appointment (clinic_id, date, start_time) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS appointment_patient_ix ON app.appointment (patient_id, date);
CREATE INDEX IF NOT EXISTS appointment_creator_ix ON app.appointment (created_by, date);

ALTER TABLE app.appointment ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.appointment FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointment_read ON app.appointment;
CREATE POLICY appointment_read ON app.appointment FOR SELECT
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));
DROP POLICY IF EXISTS appointment_insert ON app.appointment;
CREATE POLICY appointment_insert ON app.appointment FOR INSERT
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));
DROP POLICY IF EXISTS appointment_update ON app.appointment;
CREATE POLICY appointment_update ON app.appointment FOR UPDATE
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));

GRANT SELECT, INSERT, UPDATE ON app.appointment TO emb_app;

DROP TRIGGER IF EXISTS appointment_touch ON app.appointment;
CREATE TRIGGER appointment_touch BEFORE UPDATE ON app.appointment FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();
DROP TRIGGER IF EXISTS audit_appointment ON app.appointment;
CREATE TRIGGER audit_appointment AFTER INSERT OR UPDATE OR DELETE ON app.appointment FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
