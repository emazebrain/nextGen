-- 0012: whether a device id is registered, without revealing anything else about it (device rows are only readable
-- by their creator and the people with a space on them). Used by registration and space creation (ADR 0019).
CREATE OR REPLACE FUNCTION app.device_exists(p_device uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.current_user_id() IS NOT NULL AND EXISTS (SELECT 1 FROM app.device WHERE id = p_device)
$$;
GRANT SELECT ON app.device TO emb_rls_helper;
ALTER FUNCTION app.device_exists(uuid) OWNER TO emb_rls_helper;
