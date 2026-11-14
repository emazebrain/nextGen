-- eMazeBrain v2 on Supabase: the database roles and the sign-in tables.
--
-- Run once, in the Supabase SQL Editor, on a database that was set up with the
-- Supabase-adapted copy of migrations 0001-0018. That copy left out everything
-- Supabase's SQL Editor refused at the time:
--   * roles emb_app and emb_rls_helper with all their grants (the API runs every
--     request as emb_app; without it nothing under /v1 works and row-level
--     security would not apply to the API's connection);
--   * the Better Auth tables, because Supabase reserves schema `auth`. Here they
--     live in schema `emb_auth`; the API finds them through AUTH_SCHEMA=emb_auth.
--
-- The statements in part 1 are the ones the migrations run, in the same order.
-- The two blanket grants of migration 0001 are written out by name, so they
-- cover what existed at 0001 and nothing created later.
-- If the editor offers to "enable RLS" on the new tables, choose to run the
-- script as written: it already enables it.

BEGIN;

-- ------------------------------------------------------------------ roles
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emb_app') THEN
    CREATE ROLE emb_app NOLOGIN NOBYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'emb_rls_helper') THEN
    CREATE ROLE emb_rls_helper NOLOGIN BYPASSRLS;
  END IF;
END $$;

-- The API's login may SET ROLE emb_app; later migrations may replace the
-- helper-owned functions.
GRANT emb_app TO CURRENT_USER;
GRANT emb_rls_helper TO CURRENT_USER;

-- Handing a function to another owner needs that owner to hold CREATE on the
-- schema while it happens. Taken away again at the end of this script.
GRANT CREATE ON SCHEMA app TO emb_rls_helper;

-- ------------------------------------------------- part 1: grants and owners
-- 0001_core_tenancy.sql
GRANT USAGE ON SCHEMA app TO emb_rls_helper;
GRANT SELECT ON app.membership, app.clinic, app.patient, app.patient_care_team TO emb_rls_helper;
ALTER FUNCTION app.has_clinic_role(uuid, app.member_role[]) OWNER TO emb_rls_helper;
ALTER FUNCTION app.can_see_patient(uuid) OWNER TO emb_rls_helper;
GRANT USAGE ON SCHEMA app TO emb_app;
GRANT SELECT, INSERT, UPDATE ON app.app_user, app.clinic, app.consent, app.membership, app.organization, app.patient, app.patient_care_team TO emb_app;
REVOKE UPDATE ON app.consent FROM emb_app;
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.uuidv7(), app.reject_mutation(), app.has_clinic_role(uuid, app.member_role[]), app.can_see_patient(uuid) TO emb_app;

-- 0002_audit_log.sql
GRANT SELECT ON app.audit_event TO emb_app;
REVOKE INSERT, UPDATE, DELETE ON app.audit_event, app.audit_chain_head FROM emb_app;
REVOKE ALL ON app.audit_chain_head FROM emb_app;
GRANT EXECUTE ON FUNCTION app.record_audit(text, text, uuid, uuid, uuid, text[], text) TO emb_app;
REVOKE EXECUTE ON FUNCTION app.verify_audit_chain() FROM PUBLIC, emb_app;

-- 0005_patients_guardians_consent.sql
ALTER FUNCTION app.can_manage_care_team(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.is_clinic_staff(uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.patient_duplicate_exists(uuid, text, text, date) OWNER TO emb_rls_helper;
GRANT SELECT ON app.guardian, app.guardian_patient TO emb_rls_helper;
ALTER FUNCTION app.can_see_guardian(uuid) OWNER TO emb_rls_helper;
GRANT SELECT, INSERT, UPDATE ON app.guardian TO emb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.guardian_patient TO emb_app;
GRANT SELECT ON app.consent_current TO emb_app;

-- 0006_protocols.sql
GRANT SELECT ON app.protocol_template TO emb_rls_helper;
ALTER FUNCTION app.can_see_template(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.can_edit_template(uuid) OWNER TO emb_rls_helper;
GRANT SELECT, INSERT, UPDATE ON app.protocol_template TO emb_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON app.template_step TO emb_app;
ALTER FUNCTION app.can_treat_patient(uuid) OWNER TO emb_rls_helper;
GRANT SELECT, INSERT, UPDATE ON app.protocol_assignment, app.assignment_step, app.planned_session TO emb_app;
ALTER FUNCTION app.shares_clinic_with(uuid) OWNER TO emb_rls_helper;

-- 0007_sessions.sql
GRANT INSERT ON app.session_result_raw TO emb_app;
REVOKE SELECT, UPDATE ON app.session_result_raw FROM emb_app;
GRANT SELECT, INSERT ON app.game_session, app.progression_decision TO emb_app;
REVOKE UPDATE ON app.game_session, app.progression_decision FROM emb_app;

-- 0010_video_library.sql
GRANT SELECT ON app.membership TO emb_rls_helper;
ALTER FUNCTION app.is_platform_admin() OWNER TO emb_rls_helper;
GRANT SELECT ON app.assignment_step, app.template_step TO emb_rls_helper;
ALTER FUNCTION app.video_in_use_by_me(uuid) OWNER TO emb_rls_helper;
GRANT SELECT ON app.brain_region, app.file_object, app.video, app.video_i18n, app.video_region, app.video_view TO emb_app;
GRANT INSERT, UPDATE, DELETE ON app.brain_region, app.file_object, app.video, app.video_i18n, app.video_region TO emb_app;
GRANT INSERT ON app.video_view TO emb_app;

-- 0011_offline_devices.sql
GRANT SELECT, INSERT ON app.device, app.device_space TO emb_app;
GRANT UPDATE (last_seen_at) ON app.device TO emb_app;
GRANT UPDATE (last_online_at, ended_at, ended_by) ON app.device_space TO emb_app;
GRANT SELECT ON app.device_space TO emb_rls_helper;
ALTER FUNCTION app.has_space_on(uuid, uuid) OWNER TO emb_rls_helper;
GRANT SELECT ON app.consent, app.protocol_assignment, app.assignment_step, app.planned_session TO emb_rls_helper;
GRANT SELECT ON app.consent_current TO emb_rls_helper;
GRANT SELECT, INSERT ON app.game_session, app.video_view TO emb_rls_helper;
ALTER FUNCTION app.act_for_ticket(uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ingest_game_session(jsonb) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ingest_video_view(jsonb) OWNER TO emb_rls_helper;
ALTER FUNCTION app.review_reason_for(uuid, uuid, uuid, uuid) OWNER TO emb_rls_helper;
GRANT EXECUTE ON FUNCTION app.act_for_ticket(uuid, uuid), app.ingest_game_session(jsonb), app.ingest_video_view(jsonb), app.review_reason_for(uuid, uuid, uuid, uuid) TO emb_app;
ALTER FUNCTION app.review_target_patient(uuid, uuid) OWNER TO emb_rls_helper;
GRANT SELECT, INSERT ON app.result_review TO emb_app;

-- 0012_device_exists.sql
GRANT SELECT ON app.device TO emb_rls_helper;
ALTER FUNCTION app.device_exists(uuid) OWNER TO emb_rls_helper;

-- 0013_ticketed_lookups.sql
GRANT SELECT ON app.patient TO emb_rls_helper;
ALTER FUNCTION app.ticket_session(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_stored_step(text, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_step_played(text, uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.ticket_step(uuid) OWNER TO emb_rls_helper;
GRANT EXECUTE ON FUNCTION app.ticket_session(uuid), app.ticket_stored_step(text, uuid), app.ticket_step_played(text, uuid, uuid), app.ticket_step(uuid) TO emb_app;

-- 0014_ended_spaces.sql
GRANT SELECT ON app.device_space TO emb_rls_helper;
ALTER FUNCTION app.ended_spaces_on_device(uuid) OWNER TO emb_rls_helper;
GRANT EXECUTE ON FUNCTION app.ended_spaces_on_device(uuid) TO emb_app;

-- 0015_review_state.sql
GRANT SELECT ON app.game_session_review, app.video_view_review TO emb_app;

-- 0017_device_organisation.sql
GRANT SELECT ON app.device, app.device_space, app.membership, app.clinic TO emb_rls_helper;
ALTER FUNCTION app.device_org(uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.may_use_device(uuid, uuid) OWNER TO emb_rls_helper;
ALTER FUNCTION app.held_space_on(uuid, uuid) OWNER TO emb_rls_helper;
GRANT EXECUTE ON FUNCTION app.device_org(uuid), app.may_use_device(uuid, uuid), app.held_space_on(uuid, uuid), app.has_space_on(uuid, uuid), app.device_exists(uuid) TO emb_app;

-- 0018_brain_region_filters.sql
GRANT SELECT, INSERT, UPDATE, DELETE ON app.region_setting TO emb_app;

REVOKE CREATE ON SCHEMA app FROM emb_rls_helper;

-- ------------------------------------------- part 2: sign-in tables (0003, 0004)
CREATE SCHEMA emb_auth;
REVOKE ALL ON SCHEMA emb_auth FROM PUBLIC;

CREATE TABLE emb_auth."user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" boolean not null, "image" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null, "twoFactorEnabled" boolean);

CREATE TABLE emb_auth."session" ("id" text not null primary key, "expiresAt" timestamptz not null, "token" text not null unique, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null, "ipAddress" text, "userAgent" text, "userId" text not null references emb_auth."user" ("id") on delete cascade);

CREATE TABLE emb_auth."account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references emb_auth."user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" timestamptz, "refreshTokenExpiresAt" timestamptz, "scope" text, "password" text, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz not null);

CREATE TABLE emb_auth."verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" timestamptz not null, "createdAt" timestamptz default CURRENT_TIMESTAMP not null, "updatedAt" timestamptz default CURRENT_TIMESTAMP not null);

CREATE TABLE emb_auth."twoFactor" ("id" text not null primary key, "secret" text not null, "backupCodes" text not null, "userId" text not null references emb_auth."user" ("id") on delete cascade, "verified" boolean, "failedVerificationCount" integer, "lockedUntil" timestamptz);

CREATE INDEX "session_userId_idx" ON emb_auth."session" ("userId");
CREATE INDEX "account_userId_idx" ON emb_auth."account" ("userId");
CREATE INDEX "verification_identifier_idx" ON emb_auth."verification" ("identifier");
CREATE INDEX "twoFactor_secret_idx" ON emb_auth."twoFactor" ("secret");
CREATE INDEX "twoFactor_userId_idx" ON emb_auth."twoFactor" ("userId");

CREATE TABLE emb_auth.totp_claim (
  user_id    text        NOT NULL,
  code       text        NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, code)
);
CREATE INDEX totp_claim_claimed_at_ix ON emb_auth.totp_claim (claimed_at);

CREATE FUNCTION emb_auth.claim_totp(p_user text, p_code text) RETURNS boolean
LANGUAGE sql VOLATILE AS $$
  WITH claimed AS (
    INSERT INTO emb_auth.totp_claim AS t (user_id, code) VALUES (p_user, p_code)
    ON CONFLICT (user_id, code) DO UPDATE SET claimed_at = now()
      WHERE t.claimed_at < now() - interval '120 seconds'
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM claimed);
$$;
REVOKE ALL ON FUNCTION emb_auth.claim_totp(text, text) FROM PUBLIC;

-- No policies: only the table owner (the API's auth connection) reads these.
ALTER TABLE emb_auth."user" ENABLE ROW LEVEL SECURITY;
ALTER TABLE emb_auth."session" ENABLE ROW LEVEL SECURITY;
ALTER TABLE emb_auth."account" ENABLE ROW LEVEL SECURITY;
ALTER TABLE emb_auth."verification" ENABLE ROW LEVEL SECURITY;
ALTER TABLE emb_auth."twoFactor" ENABLE ROW LEVEL SECURITY;
ALTER TABLE emb_auth."totp_claim" ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------- part 3: Supabase Data API
-- Supabase serves schema `public` over its REST API. The migration ledger is
-- the only table there; keep it closed to the anon and authenticated keys.
ALTER TABLE public.schema_migrations ENABLE ROW LEVEL SECURITY;

COMMIT;
