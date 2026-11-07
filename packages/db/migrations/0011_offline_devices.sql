-- 0011: offline therapist devices (spec docs/superpowers/specs/2026-11-07-offline-device-design.md, ADR 0019).
-- Expand-only. A device holds one encrypted space per therapist per clinic; results recorded offline are sent by
-- whoever next signs in online on that device and are credited to the therapist the launch ticket names. Results
-- that arrive after something changed are always stored, with a review reason, and reviewed in append-only records.

-- ---------------------------------------------------------------- devices and spaces
CREATE TABLE app.device (
  id                uuid PRIMARY KEY,                       -- generated on the device
  outbox_public_key text NOT NULL CHECK (length(outbox_public_key) <= 200),
  outbox_secret_enc bytea NOT NULL,                         -- sealed with the server's DEVICE_SECRET_KEY
  created_by        uuid NOT NULL REFERENCES app.app_user(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_seen_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.device_space (
  id               uuid PRIMARY KEY DEFAULT app.uuidv7(),
  device_id        uuid NOT NULL REFERENCES app.device(id),
  user_id          uuid NOT NULL REFERENCES app.app_user(id),
  clinic_id        uuid NOT NULL REFERENCES app.clinic(id),
  space_secret_enc bytea NOT NULL,                          -- sealed with the server's DEVICE_SECRET_KEY
  created_at       timestamptz NOT NULL DEFAULT now(),
  last_online_at   timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  ended_by         uuid REFERENCES app.app_user(id)
);
CREATE UNIQUE INDEX device_space_active_uq ON app.device_space (device_id, user_id, clinic_id) WHERE ended_at IS NULL;
CREATE INDEX device_space_clinic_ix ON app.device_space (clinic_id);

-- Does someone hold an active space on this device? (definer: the space rows are RLS-limited to their owner)
CREATE OR REPLACE FUNCTION app.has_space_on(p_device uuid, p_user uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.device_space s WHERE s.device_id = p_device AND s.user_id = p_user AND s.ended_at IS NULL)
$$;

ALTER TABLE app.device       ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.device       FORCE ROW LEVEL SECURITY;
ALTER TABLE app.device_space ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.device_space FORCE ROW LEVEL SECURITY;

CREATE POLICY device_read ON app.device FOR SELECT
  USING (created_by = app.current_user_id() OR app.has_space_on(id, app.current_user_id()));
CREATE POLICY device_insert ON app.device FOR INSERT
  WITH CHECK (created_by = app.current_user_id()
              AND EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active'));
CREATE POLICY device_touch ON app.device FOR UPDATE
  USING (created_by = app.current_user_id() OR app.has_space_on(id, app.current_user_id()));

CREATE POLICY space_read ON app.device_space FOR SELECT
  USING (user_id = app.current_user_id() OR app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]));
CREATE POLICY space_insert ON app.device_space FOR INSERT
  WITH CHECK (user_id = app.current_user_id()
              AND app.has_clinic_role(clinic_id, ARRAY['therapist', 'assistant', 'clinic_manager', 'org_admin']::app.member_role[]));
CREATE POLICY space_update ON app.device_space FOR UPDATE
  USING (user_id = app.current_user_id() OR app.has_clinic_role(clinic_id, ARRAY['clinic_manager', 'org_admin']::app.member_role[]));

GRANT SELECT, INSERT ON app.device, app.device_space TO emb_app;
GRANT UPDATE (last_seen_at) ON app.device TO emb_app;
GRANT UPDATE (last_online_at, ended_at, ended_by) ON app.device_space TO emb_app;
GRANT SELECT ON app.device_space TO emb_rls_helper;
ALTER FUNCTION app.has_space_on(uuid, uuid) OWNER TO emb_rls_helper;
CREATE TRIGGER audit_device_space AFTER INSERT OR UPDATE ON app.device_space FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

-- ---------------------------------------------------------------- who sent it, and whether it needs review
ALTER TABLE app.game_session ADD COLUMN uploaded_by uuid REFERENCES app.app_user(id);
ALTER TABLE app.game_session ADD COLUMN review_reason text;
ALTER TABLE app.video_view   ADD COLUMN uploaded_by uuid REFERENCES app.app_user(id);
ALTER TABLE app.video_view   ADD COLUMN review_reason text;
ALTER TABLE app.game_session ADD CONSTRAINT game_session_review_reason CHECK (review_reason IN
  ('consent_withdrawn', 'not_on_care_team', 'membership_ended', 'assignment_not_active', 'step_changed', 'session_closed', 'played_twice', 'params_outside_ticket'));
ALTER TABLE app.video_view ADD CONSTRAINT video_view_review_reason CHECK (review_reason IN
  ('consent_withdrawn', 'not_on_care_team', 'membership_ended', 'assignment_not_active', 'step_changed', 'session_closed', 'played_twice', 'params_outside_ticket'));
CREATE INDEX game_session_review_ix ON app.game_session (patient_id) WHERE review_reason IS NOT NULL;
CREATE INDEX video_view_review_ix ON app.video_view (patient_id) WHERE review_reason IS NOT NULL;

-- A difficulty the therapist set by hand: a late offline result must not overwrite it.
ALTER TABLE app.assignment_step ADD COLUMN difficulty_set_at timestamptz;

-- ---------------------------------------------------------------- ticketed ingest
-- The launch ticket is verified by the API (Ed25519, server-signed). act_for_ticket then lets the request act for
-- the therapist the ticket names: the uploader must be that therapist, or hold an active space on the device the
-- ticket was issued to. app.user_id becomes the therapist for the rest of the transaction (RLS then reflects the
-- therapist's rights, e.g. for progression), and app.uploader_id keeps who actually sent it.
CREATE OR REPLACE FUNCTION app.act_for_ticket(p_therapist uuid, p_device uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  uploader uuid := app.current_user_id();
BEGIN
  IF uploader IS NULL
     OR NOT EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = uploader AND m.status = 'active')
     OR NOT (uploader = p_therapist OR (p_device IS NOT NULL AND app.has_space_on(p_device, uploader))) THEN
    RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501';
  END IF;
  PERFORM set_config('app.uploader_id', uploader::text, true);
  PERFORM set_config('app.ticket_actor', p_therapist::text, true);
  PERFORM set_config('app.user_id', p_therapist::text, true);
END $$;

CREATE OR REPLACE FUNCTION app.ticket_actor_ok() RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT nullif(current_setting('app.ticket_actor', true), '') IS NOT NULL
     AND current_setting('app.ticket_actor', true) = current_setting('app.user_id', true)
$$;

-- Stores a result even when the therapist no longer has access (it is then flagged): never dropped (invariant 8).
-- Returns the id, or NULL when that id is already stored.
CREATE OR REPLACE FUNCTION app.ingest_game_session(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  out_id uuid;
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.game_session (id, patient_id, clinic_id, assignment_step_id, planned_session_id, recorded_by, uploaded_by, review_reason,
      game_id, game_version, location, status, end_reason, session_mode, difficulty, hemisphere, started_at, ended_at, active_ms, paused_ms,
      lives_start, lives_lost, lives_remaining, trials_total, correct, errors, timeouts, accuracy, rt_median_ms, rt_mean_ms,
      left_accuracy, right_accuracy, highest_level, levels_completed, metrics, std, levels, config_echo)
  SELECT (p->>'id')::uuid, pt.id, pt.clinic_id, (p->>'assignment_step_id')::uuid, (p->>'planned_session_id')::uuid,
         app.current_user_id(), nullif(current_setting('app.uploader_id', true), '')::uuid, p->>'review_reason',
         p->>'game_id', p->>'game_version', COALESCE(p->>'location', 'clinic'), p->>'status', p->>'end_reason',
         (p->>'session_mode')::app.session_mode, (p->>'difficulty')::smallint, p->>'hemisphere',
         (p->>'started_at')::timestamptz, (p->>'ended_at')::timestamptz, (p->>'active_ms')::integer, COALESCE((p->>'paused_ms')::integer, 0),
         (p->>'lives_start')::smallint, COALESCE((p->>'lives_lost')::smallint, 0), (p->>'lives_remaining')::smallint,
         COALESCE((p->>'trials_total')::integer, 0), COALESCE((p->>'correct')::integer, 0), COALESCE((p->>'errors')::integer, 0),
         COALESCE((p->>'timeouts')::integer, 0), (p->>'accuracy')::numeric, (p->>'rt_median_ms')::integer, (p->>'rt_mean_ms')::integer,
         (p->>'left_accuracy')::numeric, (p->>'right_accuracy')::numeric, (p->>'highest_level')::integer, (p->>'levels_completed')::integer,
         COALESCE(p->'metrics', '{}'), COALESCE(p->'std', '{}'), COALESCE(p->'levels', '[]'), COALESCE(p->'config_echo', '{}')
    FROM app.patient pt WHERE pt.id = (p->>'patient_id')::uuid
  ON CONFLICT (id) DO NOTHING
  RETURNING id INTO out_id;
  RETURN out_id;
END $$;

CREATE OR REPLACE FUNCTION app.ingest_video_view(p jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  out_id uuid;
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  INSERT INTO app.video_view (client_view_id, planned_session_id, assignment_step_id, patient_id, clinic_id, video_id, video_version,
      started_at, ended_at, watched_s, completed, recorded_by, uploaded_by, review_reason)
  SELECT (p->>'client_view_id')::uuid, (p->>'planned_session_id')::uuid, (p->>'assignment_step_id')::uuid, pt.id, pt.clinic_id,
         (p->>'video_id')::uuid, (p->>'video_version')::integer, (p->>'started_at')::timestamptz, (p->>'ended_at')::timestamptz,
         (p->>'watched_s')::integer, (p->>'completed')::boolean, app.current_user_id(),
         nullif(current_setting('app.uploader_id', true), '')::uuid, p->>'review_reason'
    FROM app.patient pt WHERE pt.id = (p->>'patient_id')::uuid
  ON CONFLICT (client_view_id) DO NOTHING
  RETURNING id INTO out_id;
  RETURN out_id;
END $$;

-- Why a result arriving now needs review, if it does. Order matters: the first reason found wins.
CREATE OR REPLACE FUNCTION app.review_reason_for(p_patient uuid, p_therapist uuid, p_step uuid, p_session uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM app.consent_current c WHERE c.patient_id = p_patient AND c.purpose = 'treatment' AND c.decision = 'granted')
      THEN 'consent_withdrawn'
    WHEN NOT EXISTS (
      SELECT 1 FROM app.membership m JOIN app.patient pt ON pt.id = p_patient LEFT JOIN app.clinic c ON c.id = pt.clinic_id
       WHERE m.user_id = p_therapist AND m.status = 'active'
         AND (m.clinic_id = pt.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id)))
      THEN 'membership_ended'
    WHEN NOT EXISTS (SELECT 1 FROM app.patient_care_team t WHERE t.patient_id = p_patient AND t.user_id = p_therapist AND t.ended_at IS NULL)
     AND NOT EXISTS (
      SELECT 1 FROM app.membership m JOIN app.patient pt ON pt.id = p_patient
       WHERE m.user_id = p_therapist AND m.status = 'active' AND m.role IN ('clinic_manager', 'org_admin')
         AND (m.clinic_id = pt.clinic_id OR m.clinic_id IS NULL))
      THEN 'not_on_care_team'
    WHEN NOT EXISTS (
      SELECT 1 FROM app.assignment_step s JOIN app.protocol_assignment a ON a.id = s.assignment_id
       WHERE s.id = p_step AND a.status = 'active')
      THEN 'assignment_not_active'
    WHEN EXISTS (SELECT 1 FROM app.planned_session ps WHERE ps.id = p_session AND ps.status IN ('done', 'missed', 'skipped', 'cancelled'))
      THEN 'session_closed'
  END
$$;

GRANT SELECT ON app.consent, app.protocol_assignment, app.assignment_step, app.planned_session TO emb_rls_helper;
GRANT SELECT ON app.consent_current TO emb_rls_helper;
GRANT SELECT, INSERT ON app.game_session, app.video_view TO emb_rls_helper;
ALTER FUNCTION app.act_for_ticket(uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ingest_game_session(jsonb) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ingest_video_view(jsonb) OWNER TO emb_rls_helper;
ALTER FUNCTION app.review_reason_for(uuid, uuid, uuid, uuid) OWNER TO emb_rls_helper;
REVOKE EXECUTE ON FUNCTION app.act_for_ticket(uuid, uuid), app.ingest_game_session(jsonb), app.ingest_video_view(jsonb), app.review_reason_for(uuid, uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.act_for_ticket(uuid, uuid), app.ingest_game_session(jsonb), app.ingest_video_view(jsonb), app.review_reason_for(uuid, uuid, uuid, uuid) TO emb_app;

-- ---------------------------------------------------------------- reviews of flagged results (append-only)
CREATE TABLE app.result_review (
  id              uuid PRIMARY KEY DEFAULT app.uuidv7(),
  game_session_id uuid REFERENCES app.game_session(id),
  video_view_id   uuid REFERENCES app.video_view(id),
  decision        text NOT NULL CHECK (decision IN ('accept', 'exclude')),
  decided_by      uuid NOT NULL REFERENCES app.app_user(id),
  decided_at      timestamptz NOT NULL DEFAULT now(),
  note            text CHECK (length(note) <= 1000),
  CONSTRAINT review_one_target CHECK ((game_session_id IS NULL) <> (video_view_id IS NULL))
);
CREATE INDEX result_review_game_ix ON app.result_review (game_session_id, decided_at);
CREATE INDEX result_review_view_ix ON app.result_review (video_view_id, decided_at);

CREATE OR REPLACE FUNCTION app.review_target_patient(p_game uuid, p_view uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT COALESCE((SELECT patient_id FROM app.game_session WHERE id = p_game), (SELECT patient_id FROM app.video_view WHERE id = p_view))
$$;
ALTER FUNCTION app.review_target_patient(uuid, uuid) OWNER TO emb_rls_helper;

ALTER TABLE app.result_review ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.result_review FORCE ROW LEVEL SECURITY;
CREATE POLICY review_read ON app.result_review FOR SELECT USING (app.can_see_patient(app.review_target_patient(game_session_id, video_view_id)));
CREATE POLICY review_insert ON app.result_review FOR INSERT
  WITH CHECK (decided_by = app.current_user_id() AND app.can_treat_patient(app.review_target_patient(game_session_id, video_view_id)));
GRANT SELECT, INSERT ON app.result_review TO emb_app;
CREATE TRIGGER result_review_append_only BEFORE UPDATE OR DELETE ON app.result_review FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER audit_result_review AFTER INSERT ON app.result_review FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
