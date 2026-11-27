-- 0050: uploaded session music (product owner, 2026-11-27).
--
-- Staff upload recorded tracks and say which hemisphere each is for. A track has a scope, and it is available to
-- everyone at that level and below:
--   platform      uploaded by a platform admin       -> every clinic
--   organization  uploaded by an organization admin  -> every clinic of that organization
--   clinic        uploaded by a clinic manager       -> that clinic
--   personal      uploaded by a therapist            -> that therapist's own patients in that clinic
-- A higher role can see and remove what a lower one uploaded inside its own area. In a session, the most specific
-- level that has a track for the game's hemisphere is used; with none, the generated tunes play.
--
-- No patient data: a track is a title, a hemisphere and an audio file. Whoever uploads confirms they hold the rights
-- to use the music (rights_confirmed_at); the API refuses an upload without it.
--
-- As in 0041, policies call SECURITY DEFINER helpers and never another RLS table; the helpers have a pinned
-- search_path and stay owned by the role running the migration.

CREATE TABLE app.music_track (
  id                  uuid PRIMARY KEY DEFAULT app.uuidv7(),
  scope               text NOT NULL CHECK (scope IN ('platform', 'organization', 'clinic', 'personal')),
  organization_id     uuid REFERENCES app.organization(id),
  clinic_id           uuid REFERENCES app.clinic(id),
  owner_user_id       uuid NOT NULL REFERENCES app.app_user(id),
  hemisphere          text NOT NULL CHECK (hemisphere IN ('left', 'right')),
  title               text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  storage_key         text NOT NULL UNIQUE,
  sha256              bytea NOT NULL CHECK (octet_length(sha256) = 32),
  bytes               bigint NOT NULL CHECK (bytes > 0),
  mime                text NOT NULL,
  rights_confirmed_at timestamptz NOT NULL DEFAULT now(),
  created_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT music_scope_fields CHECK (
    (scope = 'platform' AND organization_id IS NULL AND clinic_id IS NULL)
    OR (scope = 'organization' AND organization_id IS NOT NULL AND clinic_id IS NULL)
    OR (scope IN ('clinic', 'personal') AND organization_id IS NOT NULL AND clinic_id IS NOT NULL))
);
CREATE INDEX music_track_clinic_ix ON app.music_track (clinic_id, hemisphere);
CREATE INDEX music_track_org_ix ON app.music_track (organization_id, hemisphere);

-- The signed-in user is an active member (any role) of the organization, in any of its clinics or organization-wide.
CREATE OR REPLACE FUNCTION app.is_member_of_org(p_org uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.organization_id = p_org)
$$;

-- The organization a clinic belongs to (a helper, so the insert policy does not read another RLS table itself).
CREATE OR REPLACE FUNCTION app.clinic_org(p_clinic uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT c.organization_id FROM app.clinic c WHERE c.id = p_clinic
$$;

-- Who may list and play a track: everyone at its level and below, and the roles above it inside their own area.
CREATE OR REPLACE FUNCTION app.can_see_music(p_scope text, p_org uuid, p_clinic uuid, p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.current_user_id() IS NOT NULL AND (
    app.is_platform_admin()
    OR CASE p_scope
         WHEN 'platform'     THEN EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active')
         WHEN 'organization' THEN app.is_member_of_org(p_org)
         WHEN 'clinic'       THEN app.has_clinic_role(p_clinic, enum_range(NULL::app.member_role))
         WHEN 'personal'     THEN (p_owner = app.current_user_id() AND app.has_clinic_role(p_clinic, enum_range(NULL::app.member_role)))
                                  OR app.has_clinic_role(p_clinic, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         ELSE false
       END)
$$;

-- Who may add, rename or remove a track at a level: the role that owns the level, and the roles above it.
CREATE OR REPLACE FUNCTION app.can_manage_music(p_scope text, p_org uuid, p_clinic uuid, p_owner uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT app.current_user_id() IS NOT NULL AND (
    app.is_platform_admin()
    OR CASE p_scope
         WHEN 'organization' THEN app.is_org_admin_of(p_org)
         WHEN 'clinic'       THEN app.has_clinic_role(p_clinic, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         WHEN 'personal'     THEN (p_owner = app.current_user_id() AND app.has_clinic_role(p_clinic, ARRAY['therapist', 'clinic_manager', 'org_admin']::app.member_role[]))
                                  OR app.has_clinic_role(p_clinic, ARRAY['clinic_manager', 'org_admin']::app.member_role[])
         ELSE false -- 'platform': platform admins only, handled above
       END)
$$;

ALTER TABLE app.music_track ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.music_track FORCE ROW LEVEL SECURITY;
CREATE POLICY music_read   ON app.music_track FOR SELECT USING (app.can_see_music(scope, organization_id, clinic_id, owner_user_id));
CREATE POLICY music_insert ON app.music_track FOR INSERT
  WITH CHECK (owner_user_id = app.current_user_id() AND app.can_manage_music(scope, organization_id, clinic_id, owner_user_id)
              -- a clinic's or therapist's track carries the organization its clinic belongs to
              AND (clinic_id IS NULL OR organization_id = app.clinic_org(clinic_id)));
CREATE POLICY music_update ON app.music_track FOR UPDATE
  USING (app.can_manage_music(scope, organization_id, clinic_id, owner_user_id))
  WITH CHECK (app.can_manage_music(scope, organization_id, clinic_id, owner_user_id));
CREATE POLICY music_delete ON app.music_track FOR DELETE USING (app.can_manage_music(scope, organization_id, clinic_id, owner_user_id));
GRANT SELECT, INSERT, DELETE ON app.music_track TO emb_app;
GRANT UPDATE (title, hemisphere) ON app.music_track TO emb_app; -- where a track lives and who owns it never change

-- The tracks a patient's sessions may play: the platform's, their organization's, their clinic's, and the personal
-- tracks of the therapists on their care team. Callable by staff who can see the patient and by the child's guardian
-- (who starts sessions at home); anyone else gets nothing. Returns no file locations.
CREATE OR REPLACE FUNCTION app.session_music(p_patient uuid)
RETURNS TABLE (id uuid, scope text, hemisphere text, title text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT t.id, t.scope, t.hemisphere, t.title
    FROM app.patient p
    JOIN app.clinic c ON c.id = p.clinic_id
    JOIN app.music_track t ON
         t.scope = 'platform'
      OR (t.scope = 'organization' AND t.organization_id = c.organization_id)
      OR (t.scope = 'clinic' AND t.clinic_id = p.clinic_id)
      OR (t.scope = 'personal' AND t.clinic_id = p.clinic_id
          AND EXISTS (SELECT 1 FROM app.patient_care_team ct WHERE ct.patient_id = p.id AND ct.user_id = t.owner_user_id AND ct.ended_at IS NULL))
   WHERE p.id = p_patient AND (app.can_see_patient(p.id) OR app.is_guardian_of(p.id))
   ORDER BY t.created_at, t.id
$$;

-- Where a track's file is, for someone allowed to play it: staff who can see the track, or a guardian of a child
-- whose sessions may play it.
CREATE OR REPLACE FUNCTION app.music_file(p_track uuid)
RETURNS TABLE (storage_key text, mime text, bytes bigint)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT t.storage_key, t.mime, t.bytes
    FROM app.music_track t
   WHERE t.id = p_track
     AND (app.can_see_music(t.scope, t.organization_id, t.clinic_id, t.owner_user_id)
          OR EXISTS (SELECT 1 FROM app.guardian g JOIN app.guardian_patient gp ON gp.guardian_id = g.id
                      WHERE g.user_id = app.current_user_id() AND g.deleted_at IS NULL
                        AND p_track IN (SELECT s.id FROM app.session_music(gp.patient_id) s)))
$$;

REVOKE EXECUTE ON FUNCTION app.clinic_org(uuid), app.is_member_of_org(uuid), app.can_see_music(text, uuid, uuid, uuid), app.can_manage_music(text, uuid, uuid, uuid), app.session_music(uuid), app.music_file(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION app.clinic_org(uuid), app.is_member_of_org(uuid), app.can_see_music(text, uuid, uuid, uuid), app.can_manage_music(text, uuid, uuid, uuid), app.session_music(uuid), app.music_file(uuid) TO emb_app;
