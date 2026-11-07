-- 0014: which spaces on a device were ended recently (offline devices spec §7.3, ADR 0019).
-- A therapist sees only their own spaces through RLS, but every space owner on a shared device must learn that
-- another space there was ended (by its owner or a manager), so the device can remove it. Ids only, and only for a
-- device the caller holds an active space on.
CREATE OR REPLACE FUNCTION app.ended_spaces_on_device(p_device uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT s.id FROM app.device_space s
   WHERE s.device_id = p_device AND s.ended_at IS NOT NULL AND s.ended_at > now() - interval '30 days'
     AND EXISTS (SELECT 1 FROM app.device_space m
                  WHERE m.device_id = p_device AND m.user_id = app.current_user_id() AND m.ended_at IS NULL)
$$;
GRANT SELECT ON app.device_space TO emb_rls_helper;
ALTER FUNCTION app.ended_spaces_on_device(uuid) OWNER TO emb_rls_helper;
REVOKE EXECUTE ON FUNCTION app.ended_spaces_on_device(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.ended_spaces_on_device(uuid) TO emb_app;
