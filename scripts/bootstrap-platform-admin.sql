-- Bootstrap the first platform admin.
-- Run once against the production database after deploying the system-admin branch.
--
-- Usage:
--   psql "$DATABASE_URL" -f scripts/bootstrap-platform-admin.sql
--
-- Prerequisites:
--   The emazebrain@gmail.com user must have signed up via Better Auth first
--   (the sign-up page or API), so that emb_auth."user" and app.app_user rows exist.

BEGIN;

DO $$
DECLARE
  _uid  uuid;
  _oid  uuid;
BEGIN
  -- 1. Find the auth user
  SELECT id INTO _uid
    FROM emb_auth."user"
   WHERE email = 'emazebrain@gmail.com';

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'User emazebrain@gmail.com not found in emb_auth."user". '
                    'Sign up first at the app, then re-run this script.';
  END IF;

  RAISE NOTICE 'Found auth user: %', _uid;

  -- 2. Ensure app_user row exists and is active
  INSERT INTO app.app_user (id, email, full_name, kind, status)
  VALUES (_uid, 'emazebrain@gmail.com', 'eMazeBrain Admin', 'staff', 'active')
  ON CONFLICT (id) DO UPDATE SET status = 'active';

  RAISE NOTICE 'app_user active';

  -- 3. Ensure a default organization exists
  SELECT id INTO _oid FROM app.organization WHERE status = 'active' LIMIT 1;

  IF _oid IS NULL THEN
    INSERT INTO app.organization (name, region, default_locale, status)
    VALUES ('eMazeBrain', 'il', 'he', 'active')
    RETURNING id INTO _oid;
    RAISE NOTICE 'Created organization: %', _oid;
  ELSE
    RAISE NOTICE 'Using existing organization: %', _oid;
  END IF;

  -- 4. Create platform_admin membership (org-wide, no clinic)
  INSERT INTO app.membership (user_id, organization_id, clinic_id, role, status)
  VALUES (_uid, _oid, NULL, 'platform_admin', 'active')
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'platform_admin membership created for emazebrain@gmail.com';
END $$;

COMMIT;
