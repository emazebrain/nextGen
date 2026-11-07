-- 0013: what ticketed ingest needs to answer correctly even when the credited therapist has lost access (ADR 0019).
-- Expand-only: the raw log may also record 'kept_for_review'; lookups run only inside act_for_ticket.

ALTER TABLE app.session_result_raw DROP CONSTRAINT IF EXISTS session_result_raw_outcome_check;
ALTER TABLE app.session_result_raw ADD CONSTRAINT session_result_raw_outcome_check
  CHECK (outcome IN ('accepted', 'duplicate', 'conflict', 'rejected', 'kept_for_review'));

-- The planned session a ticket points at, read past RLS (the therapist may no longer see the patient).
CREATE OR REPLACE FUNCTION app.ticket_session(p_session uuid)
RETURNS TABLE (status text, assignment_id uuid, patient_id uuid, clinic_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT ps.status, ps.assignment_id, ps.patient_id, ps.clinic_id FROM app.planned_session ps WHERE ps.id = p_session;
END $$;

-- Which step an already-stored result or view belongs to (to tell a retry from a reused id), and whether the same
-- step of the same planned session already has one (played on two devices).
CREATE OR REPLACE FUNCTION app.ticket_stored_step(p_kind text, p_id uuid)
RETURNS uuid LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'game' THEN RETURN (SELECT assignment_step_id FROM app.game_session WHERE id = p_id); END IF;
  RETURN (SELECT assignment_step_id FROM app.video_view WHERE client_view_id = p_id);
END $$;

CREATE OR REPLACE FUNCTION app.ticket_step_played(p_kind text, p_session uuid, p_step uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  IF p_kind = 'game' THEN
    RETURN EXISTS (SELECT 1 FROM app.game_session WHERE planned_session_id = p_session AND assignment_step_id = p_step);
  END IF;
  RETURN EXISTS (SELECT 1 FROM app.video_view WHERE planned_session_id = p_session AND assignment_step_id = p_step);
END $$;

-- The step as it is now (to tell whether it changed since the ticket was issued).
CREATE OR REPLACE FUNCTION app.ticket_step(p_step uuid)
RETURNS SETOF app.assignment_step LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  IF NOT app.ticket_actor_ok() THEN RAISE EXCEPTION 'ticketed_ingest_forbidden' USING ERRCODE = '42501'; END IF;
  RETURN QUERY SELECT * FROM app.assignment_step WHERE id = p_step;
END $$;

GRANT SELECT ON app.patient TO emb_rls_helper;
ALTER FUNCTION app.ticket_session(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_stored_step(text, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_step_played(text, uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_step(uuid) OWNER TO emb_rls_helper;
REVOKE EXECUTE ON FUNCTION app.ticket_session(uuid), app.ticket_stored_step(text, uuid), app.ticket_step_played(text, uuid, uuid), app.ticket_step(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ticket_session(uuid), app.ticket_stored_step(text, uuid), app.ticket_step_played(text, uuid, uuid), app.ticket_step(uuid) TO emb_app;

-- Ticketed inserts run with search_path = app, pg_temp; uuidv7() (column defaults) must still find pgcrypto's
-- gen_random_bytes, which lives where 0001 created the extension (public).
ALTER FUNCTION app.uuidv7() SET search_path = app, public, pg_temp;
