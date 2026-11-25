-- 0043: results of sessions played at home (parent portal).
--
-- A guardian can start their child's next home session from the parent portal (the launch route checks the link in
-- code). Until now nothing could be saved from it: every write path for results and video views required an active
-- staff membership, so the upload was refused. This migration adds one narrow way in:
--
--   * app.may_play_at_home(session): the signed-in user is a guardian linked to the session's patient, and the
--     session can be done at home (planned for home, or its protocol is set to "both").
--   * app.act_for_home_session(session): for such a session only, the upload is stored on behalf of a member of the
--     child's care team (the primary therapist first; the therapist who assigned the protocol if nobody else), with
--     the guardian kept as the uploader. The usual checks (consent, the therapist's membership and care-team place,
--     the protocol being active, the session being open) then run against that therapist, and a result that fails
--     one is kept for review, never dropped. The row itself is marked location = 'home'.
--   * The raw upload log accepts a guardian's own attempts, as it does a staff member's (never drop silently, §9.8).
--
-- A guardian gains no read access and no other write access. Expand-only: no table or column changes.
--
-- As in 0041, the helpers are SECURITY DEFINER with a pinned search_path and stay owned by the role running the
-- migration, which bypasses RLS wherever this runs; policies call helpers and never query another RLS table.

-- The signed-in user is a guardian with at least one linked child.
CREATE OR REPLACE FUNCTION app.is_guardian_user()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.guardian g
      JOIN app.guardian_patient gp ON gp.guardian_id = g.id
     WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION app.may_play_at_home(p_session uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.planned_session ps
      JOIN app.protocol_assignment a ON a.id = ps.assignment_id
      JOIN app.guardian_patient gp ON gp.patient_id = ps.patient_id
      JOIN app.guardian g ON g.id = gp.guardian_id
     WHERE ps.id = p_session
       AND (ps.location = 'home' OR a.setting = 'mixed')
       AND g.user_id = app.current_user_id() AND g.deleted_at IS NULL)
$$;

CREATE OR REPLACE FUNCTION app.act_for_home_session(p_session uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
DECLARE
  uploader uuid := app.current_user_id();
  actor uuid;
BEGIN
  IF uploader IS NULL OR NOT app.may_play_at_home(p_session) THEN
    RAISE EXCEPTION 'home_ingest_forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(
           (SELECT t.user_id
              FROM app.patient_care_team t
              JOIN app.patient pt ON pt.id = t.patient_id
              LEFT JOIN app.clinic c ON c.id = pt.clinic_id
              JOIN app.membership m ON m.user_id = t.user_id AND m.status = 'active'
                   AND (m.clinic_id = pt.clinic_id OR (m.clinic_id IS NULL AND m.organization_id = c.organization_id))
             WHERE t.patient_id = ps.patient_id AND t.ended_at IS NULL
             ORDER BY (t.role = 'primary') DESC, t.assigned_at, t.user_id
             LIMIT 1),
           a.assigned_by)
    INTO actor
    FROM app.planned_session ps JOIN app.protocol_assignment a ON a.id = ps.assignment_id
   WHERE ps.id = p_session;
  PERFORM set_config('app.uploader_id', uploader::text, true);
  PERFORM set_config('app.ticket_actor', actor::text, true);
  PERFORM set_config('app.user_id', actor::text, true);
  RETURN actor;
END $$;

REVOKE EXECUTE ON FUNCTION app.is_guardian_user(), app.may_play_at_home(uuid), app.act_for_home_session(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.is_guardian_user(), app.may_play_at_home(uuid), app.act_for_home_session(uuid) TO emb_app;

DROP POLICY IF EXISTS raw_insert_guardian ON app.session_result_raw;
CREATE POLICY raw_insert_guardian ON app.session_result_raw FOR INSERT
  WITH CHECK (recorded_by = app.current_user_id() AND app.is_guardian_user());
