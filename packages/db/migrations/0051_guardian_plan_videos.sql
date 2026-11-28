-- A video that is part of a child's protocol plays for the child's guardian too.
--
-- Until now a video taken out of the library (archived or back to draft) after it was assigned stayed readable to
-- the staff who can see the protocol, but not to the guardian playing the same session at home: the therapist could
-- play it and the parent got "this video can't be played". The rule now treats the guardian of the child the same
-- way. Nothing else changes: a guardian still sees no video outside their own child's protocols unless it is
-- published, and never sees templates.
CREATE OR REPLACE FUNCTION app.video_in_use_by_me(p_video uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.assignment_step s WHERE s.video_id = p_video AND (app.can_see_patient(s.patient_id) OR app.is_guardian_of(s.patient_id)))
      OR EXISTS (SELECT 1 FROM app.template_step t WHERE t.video_id = p_video AND (app.can_see_template(t.template_id) OR app.can_edit_template(t.template_id)))
$$;
GRANT EXECUTE ON FUNCTION app.is_guardian_of(uuid) TO emb_rls_helper;
ALTER FUNCTION app.video_in_use_by_me(uuid) OWNER TO emb_rls_helper;
