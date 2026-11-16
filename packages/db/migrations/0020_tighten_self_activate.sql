-- 0020: tighten the self-activate mechanism (review findings I1, I2).
--
-- The 0019 user_self_activate UPDATE policy was too broad: it allowed any
-- column to be changed as long as the final status = 'active', and it let
-- disabled → active through. Replace it with a SECURITY DEFINER function
-- that permits only the invited → active status transition on the caller's
-- own row, and a narrow RLS policy that forbids any other self-UPDATE.

-- Drop the over-permissive policy.
DROP POLICY IF EXISTS user_self_activate ON app.app_user;

-- A self-read policy so users can SELECT their own row (needed for
-- /v1/me and status checks). Some deployments may already have one; guard
-- with IF NOT EXISTS via DO block.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'app' AND tablename = 'app_user' AND policyname = 'user_read_self'
  ) THEN
    EXECUTE $p$
      CREATE POLICY user_read_self ON app.app_user FOR SELECT
        USING (id = app.current_user_id())
    $p$;
  END IF;
END $$;

-- SECURITY DEFINER function owned by the privileged helper role.
-- It runs outside RLS; only the caller's own row (invited → active).
CREATE OR REPLACE FUNCTION app.self_activate()
  RETURNS void
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = app, pg_temp
AS $$
DECLARE
  _uid uuid := app.current_user_id();
  _status text;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'no authenticated user';
  END IF;

  SELECT status INTO _status FROM app.app_user WHERE id = _uid FOR UPDATE;

  IF _status IS NULL THEN
    RAISE EXCEPTION 'user not found';
  END IF;

  IF _status <> 'invited' THEN
    RAISE EXCEPTION 'only invited users may self-activate (current: %)', _status;
  END IF;

  UPDATE app.app_user SET status = 'active' WHERE id = _uid;
END;
$$;

-- The helper role needs SELECT + UPDATE on app_user for this function.
GRANT SELECT, UPDATE ON app.app_user TO emb_rls_helper;

-- Owned by the helper role (same pattern as is_platform_admin).
ALTER FUNCTION app.self_activate() OWNER TO emb_rls_helper;

-- Grant execute to the app role so API calls can invoke it.
GRANT EXECUTE ON FUNCTION app.self_activate() TO emb_app;

-- I7: audit triggers on app_user and organization (were missing).
CREATE TRIGGER audit_app_user     AFTER INSERT OR UPDATE OR DELETE ON app.app_user     FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_organization AFTER INSERT OR UPDATE OR DELETE ON app.organization FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
