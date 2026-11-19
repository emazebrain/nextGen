-- 0026: Messaging (design doc §5.11).
-- One secure thread per patient × therapist, with attachments.
-- Push/SMS/email never include child name or diagnosis (CLAUDE.md rule 7).

-- A thread links one patient to one therapist (or the patient's guardian).
-- The guardian_id is set when the participant is a guardian user.
CREATE TABLE app.message_thread (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  patient_id       uuid NOT NULL REFERENCES app.patient(id),
  therapist_id     uuid NOT NULL REFERENCES app.app_user(id),
  guardian_id       uuid REFERENCES app.guardian(id),
  status           text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_message_at  timestamptz
);
CREATE UNIQUE INDEX message_thread_uq ON app.message_thread (patient_id, therapist_id, guardian_id) WHERE status = 'active';
CREATE INDEX message_thread_clinic_ix ON app.message_thread (clinic_id);
CREATE INDEX message_thread_patient_ix ON app.message_thread (patient_id);
CREATE INDEX message_thread_therapist_ix ON app.message_thread (therapist_id);

ALTER TABLE app.message_thread ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message_thread FORCE ROW LEVEL SECURITY;

-- Staff can see threads in clinics they belong to.
CREATE POLICY thread_staff_read ON app.message_thread FOR SELECT
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));

-- Guardian can see threads where they are the participant.
CREATE POLICY thread_guardian_read ON app.message_thread FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM app.guardian g
     WHERE g.id = message_thread.guardian_id
       AND g.user_id = app.current_user_id()
       AND g.deleted_at IS NULL
  ));

-- Staff can create threads.
CREATE POLICY thread_staff_insert ON app.message_thread FOR INSERT
  WITH CHECK (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));

-- Both staff and guardian can update (for last_message_at).
CREATE POLICY thread_staff_update ON app.message_thread FOR UPDATE
  USING (app.has_clinic_role(clinic_id, ARRAY['therapist','clinic_manager','org_admin']::app.member_role[]));
CREATE POLICY thread_guardian_update ON app.message_thread FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM app.guardian g
     WHERE g.id = message_thread.guardian_id
       AND g.user_id = app.current_user_id()
       AND g.deleted_at IS NULL
  ));

GRANT SELECT, INSERT, UPDATE ON app.message_thread TO emb_app;

-- Individual messages within a thread.
CREATE TABLE app.message (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  thread_id        uuid NOT NULL REFERENCES app.message_thread(id),
  sender_id        uuid NOT NULL REFERENCES app.app_user(id),
  sender_role      text NOT NULL CHECK (sender_role IN ('staff', 'guardian', 'system')),
  body             text NOT NULL CHECK (btrim(body) <> '' OR attachment_url IS NOT NULL),
  attachment_url   text,
  attachment_name  text,
  attachment_type  text CHECK (attachment_type IS NULL OR attachment_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  attachment_size  int CHECK (attachment_size IS NULL OR attachment_size <= 10485760), -- 10 MB
  read_at          timestamptz, -- set when the recipient reads the message
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX message_thread_ix ON app.message (thread_id, created_at);

ALTER TABLE app.message ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.message FORCE ROW LEVEL SECURITY;

-- Messages are visible to anyone who can see the thread.
CREATE POLICY message_read ON app.message FOR SELECT
  USING (EXISTS (SELECT 1 FROM app.message_thread t WHERE t.id = message.thread_id));

-- Both staff and guardian can send messages (insert).
CREATE POLICY message_insert ON app.message FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM app.message_thread t WHERE t.id = message.thread_id));

-- Only the recipient can mark messages as read (update read_at).
CREATE POLICY message_update ON app.message FOR UPDATE
  USING (EXISTS (SELECT 1 FROM app.message_thread t WHERE t.id = message.thread_id));

GRANT SELECT, INSERT, UPDATE ON app.message TO emb_app;

-- Trigger to update thread.last_message_at when a new message is inserted.
CREATE OR REPLACE FUNCTION app.message_touch_thread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  UPDATE app.message_thread SET last_message_at = NEW.created_at WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER message_touch_thread
  AFTER INSERT ON app.message
  FOR EACH ROW EXECUTE FUNCTION app.message_touch_thread();

-- Audit triggers.
CREATE TRIGGER audit_message_thread AFTER INSERT OR UPDATE OR DELETE ON app.message_thread FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_message AFTER INSERT OR UPDATE OR DELETE ON app.message FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
