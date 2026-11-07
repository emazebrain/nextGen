-- 0010: video library (design doc §7 brain_region, video, video_i18n, file_object, video_view; protocol step
-- step_type game/video; ADR 0018). Expand-only: new tables; template_step and assignment_step gain step_type
-- (default 'game') and video_id, and game_id / session_mode become nullable. Every existing row is a game step
-- and passes the new checks; older app versions, which never send step_type, keep writing valid game steps.
-- The design doc's ltree path is a plain text path here (no extension, so the local version needs nothing extra).

-- ---------------------------------------------------------------- who is a platform admin
CREATE OR REPLACE FUNCTION app.is_platform_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.membership m WHERE m.user_id = app.current_user_id() AND m.status = 'active' AND m.role = 'platform_admin')
$$;
GRANT SELECT ON app.membership TO emb_rls_helper;
ALTER FUNCTION app.is_platform_admin() OWNER TO emb_rls_helper;

-- ---------------------------------------------------------------- brain regions: hemisphere → lobe → area
CREATE TABLE app.brain_region (
  id        uuid PRIMARY KEY DEFAULT app.uuidv7(),
  parent_id uuid REFERENCES app.brain_region(id),
  kind      text NOT NULL CHECK (kind IN ('hemisphere', 'lobe', 'area')),
  code      text NOT NULL CHECK (code ~ '^[a-z0-9_]+$'),
  path      text NOT NULL UNIQUE CHECK (path ~ '^[a-z0-9_]+(\.[a-z0-9_]+){0,2}$'),
  labels    jsonb NOT NULL CHECK (jsonb_typeof(labels) = 'object' AND labels ? 'en'),
  sort      smallint NOT NULL DEFAULT 0,
  CONSTRAINT region_parent CHECK ((kind = 'hemisphere') = (parent_id IS NULL))
);
CREATE INDEX brain_region_path_ix ON app.brain_region (path text_pattern_ops);
CREATE INDEX brain_region_code_ix ON app.brain_region (code);

-- ---------------------------------------------------------------- files and videos
CREATE TABLE app.file_object (
  id          uuid PRIMARY KEY DEFAULT app.uuidv7(),
  storage_key text NOT NULL UNIQUE,
  sha256      bytea NOT NULL CHECK (octet_length(sha256) = 32),
  bytes       bigint NOT NULL CHECK (bytes > 0),
  mime        text NOT NULL,
  created_by  uuid REFERENCES app.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE app.video (
  id          uuid PRIMARY KEY DEFAULT app.uuidv7(),
  source      text NOT NULL CHECK (source IN ('upload', 'youtube')),
  youtube_id  text CHECK (youtube_id ~ '^[A-Za-z0-9_-]{11}$'),
  file_id     uuid REFERENCES app.file_object(id),
  duration_s  integer CHECK (duration_s BETWEEN 1 AND 7200),
  age_min     smallint CHECK (age_min BETWEEN 3 AND 18),
  age_max     smallint CHECK (age_max BETWEEN 3 AND 18),
  status      text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  version     integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_by  uuid REFERENCES app.app_user(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT video_source_fields CHECK ((source = 'youtube') = (youtube_id IS NOT NULL) AND (source = 'upload' OR file_id IS NULL)),
  CONSTRAINT video_ages CHECK (age_min IS NULL OR age_max IS NULL OR age_min <= age_max)
);
CREATE INDEX video_status_ix ON app.video (status);

CREATE TABLE app.video_i18n (
  video_id    uuid NOT NULL REFERENCES app.video(id) ON DELETE CASCADE,
  locale      text NOT NULL CHECK (locale IN ('en', 'he', 'ar', 'ru', 'fr', 'es', 'zh')),
  title       text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 160),
  description text CHECK (char_length(description) <= 2000),
  PRIMARY KEY (video_id, locale)
);

CREATE TABLE app.video_region (
  video_id  uuid NOT NULL REFERENCES app.video(id) ON DELETE CASCADE,
  region_id uuid NOT NULL REFERENCES app.brain_region(id),
  PRIMARY KEY (video_id, region_id)
);
CREATE INDEX video_region_region_ix ON app.video_region (region_id);

-- ---------------------------------------------------------------- steps: a game or a video
ALTER TABLE app.template_step
  ADD COLUMN step_type text NOT NULL DEFAULT 'game' CHECK (step_type IN ('game', 'video')),
  ADD COLUMN video_id uuid REFERENCES app.video(id),
  ALTER COLUMN game_id DROP NOT NULL,
  ALTER COLUMN session_mode DROP NOT NULL,
  DROP CONSTRAINT step_mode_fields,
  ADD CONSTRAINT step_mode_fields CHECK (
    (step_type = 'video' AND video_id IS NOT NULL AND game_id IS NULL AND session_mode IS NULL AND duration_s IS NULL AND lives IS NULL AND NOT lives_auto) OR
    (step_type = 'game' AND game_id IS NOT NULL AND video_id IS NULL AND (
      (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL AND NOT lives_auto) OR
      (session_mode = 'lives'       AND duration_s IS NULL     AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))) OR
      (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))))));

ALTER TABLE app.assignment_step
  ADD COLUMN step_type text NOT NULL DEFAULT 'game' CHECK (step_type IN ('game', 'video')),
  ADD COLUMN video_id uuid REFERENCES app.video(id),
  ALTER COLUMN game_id DROP NOT NULL,
  ALTER COLUMN session_mode DROP NOT NULL,
  DROP CONSTRAINT astep_mode_fields,
  ADD CONSTRAINT astep_mode_fields CHECK (
    (step_type = 'video' AND video_id IS NOT NULL AND game_id IS NULL AND session_mode IS NULL AND duration_s IS NULL AND lives IS NULL AND NOT lives_auto) OR
    (step_type = 'game' AND game_id IS NOT NULL AND video_id IS NULL AND (
      (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL AND NOT lives_auto) OR
      (session_mode = 'lives'       AND duration_s IS NULL     AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))) OR
      (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))))));

-- A video stays readable to whoever can see a protocol that uses it, even after it is archived.
CREATE OR REPLACE FUNCTION app.video_in_use_by_me(p_video uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = app, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM app.assignment_step s WHERE s.video_id = p_video AND app.can_see_patient(s.patient_id))
      OR EXISTS (SELECT 1 FROM app.template_step t WHERE t.video_id = p_video AND (app.can_see_template(t.template_id) OR app.can_edit_template(t.template_id)))
$$;
GRANT SELECT ON app.assignment_step, app.template_step TO emb_rls_helper;
ALTER FUNCTION app.video_in_use_by_me(uuid) OWNER TO emb_rls_helper;

-- ---------------------------------------------------------------- video views (patient data, append-only)
CREATE TABLE app.video_view (
  id                 uuid PRIMARY KEY DEFAULT app.uuidv7(),
  client_view_id     uuid NOT NULL UNIQUE,
  planned_session_id uuid NOT NULL REFERENCES app.planned_session(id),
  assignment_step_id uuid NOT NULL REFERENCES app.assignment_step(id),
  patient_id         uuid NOT NULL REFERENCES app.patient(id),
  clinic_id          uuid NOT NULL REFERENCES app.clinic(id),
  video_id           uuid NOT NULL REFERENCES app.video(id),
  video_version      integer NOT NULL CHECK (video_version >= 1),
  started_at         timestamptz NOT NULL,
  ended_at           timestamptz NOT NULL,
  watched_s          integer NOT NULL CHECK (watched_s BETWEEN 0 AND 7200),
  completed          boolean NOT NULL,
  recorded_by        uuid NOT NULL REFERENCES app.app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT view_times CHECK (ended_at >= started_at)
);
CREATE INDEX video_view_session_ix ON app.video_view (planned_session_id, assignment_step_id);
CREATE INDEX video_view_patient_ix ON app.video_view (patient_id, created_at);
CREATE TRIGGER video_view_append_only BEFORE UPDATE OR DELETE ON app.video_view FOR EACH ROW EXECUTE FUNCTION app.reject_mutation();
CREATE TRIGGER audit_video_view AFTER INSERT ON app.video_view FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER audit_video AFTER INSERT OR UPDATE OR DELETE ON app.video FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();
CREATE TRIGGER video_touch BEFORE UPDATE ON app.video FOR EACH ROW EXECUTE FUNCTION app.touch_updated_at();

-- ---------------------------------------------------------------- row-level security
ALTER TABLE app.brain_region ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.brain_region FORCE ROW LEVEL SECURITY;
ALTER TABLE app.file_object  ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.file_object  FORCE ROW LEVEL SECURITY;
ALTER TABLE app.video        ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video        FORCE ROW LEVEL SECURITY;
ALTER TABLE app.video_i18n   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_i18n   FORCE ROW LEVEL SECURITY;
ALTER TABLE app.video_region ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_region FORCE ROW LEVEL SECURITY;
ALTER TABLE app.video_view   ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.video_view   FORCE ROW LEVEL SECURITY;

-- Content: any signed-in user reads; only platform admins write.
CREATE POLICY region_read  ON app.brain_region FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY region_write ON app.brain_region FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
CREATE POLICY file_read    ON app.file_object FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY file_write   ON app.file_object FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
CREATE POLICY video_read   ON app.video FOR SELECT
  USING (app.current_user_id() IS NOT NULL AND (status = 'published' OR app.is_platform_admin() OR app.video_in_use_by_me(id)));
CREATE POLICY video_write  ON app.video FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
CREATE POLICY vi18n_read   ON app.video_i18n FOR SELECT USING (EXISTS (SELECT 1 FROM app.video v WHERE v.id = video_id));
CREATE POLICY vi18n_write  ON app.video_i18n FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
CREATE POLICY vregion_read ON app.video_region FOR SELECT USING (EXISTS (SELECT 1 FROM app.video v WHERE v.id = video_id));
CREATE POLICY vregion_write ON app.video_region FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());

-- Views follow the patient; they are recorded by the person running the session, for that session's patient.
CREATE POLICY vview_read ON app.video_view FOR SELECT USING (app.can_see_patient(patient_id));
CREATE POLICY vview_insert ON app.video_view FOR INSERT
  WITH CHECK (app.can_treat_patient(patient_id) AND recorded_by = app.current_user_id()
              AND EXISTS (SELECT 1 FROM app.planned_session ps WHERE ps.id = planned_session_id AND ps.patient_id = video_view.patient_id AND ps.clinic_id = video_view.clinic_id));

GRANT SELECT ON app.brain_region, app.file_object, app.video, app.video_i18n, app.video_region, app.video_view TO emb_app;
GRANT INSERT, UPDATE, DELETE ON app.brain_region, app.file_object, app.video, app.video_i18n, app.video_region TO emb_app;
GRANT INSERT ON app.video_view TO emb_app;

-- ---------------------------------------------------------------- seed: the Brodmann tree (packages/db/src/brain-regions.ts)
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) VALUES ('hemisphere', 'left', 'left', NULL, jsonb_build_object('en', 'Left hemisphere', 'he', 'ההמיספרה השמאלית'), 1);
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'frontal', 'left.frontal', id, jsonb_build_object('en', 'Frontal lobe', 'he', 'האונה המצחית'), 1 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba4', 'left.frontal.ba4', id, jsonb_build_object('en', 'Brodmann area 4 (BA4)', 'he', 'אזור ברודמן 4 (BA4)'), 1 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba6', 'left.frontal.ba6', id, jsonb_build_object('en', 'Brodmann area 6 (BA6)', 'he', 'אזור ברודמן 6 (BA6)'), 2 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba8', 'left.frontal.ba8', id, jsonb_build_object('en', 'Brodmann area 8 (BA8)', 'he', 'אזור ברודמן 8 (BA8)'), 3 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba9', 'left.frontal.ba9', id, jsonb_build_object('en', 'Brodmann area 9 (BA9)', 'he', 'אזור ברודמן 9 (BA9)'), 4 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba10', 'left.frontal.ba10', id, jsonb_build_object('en', 'Brodmann area 10 (BA10)', 'he', 'אזור ברודמן 10 (BA10)'), 5 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba11', 'left.frontal.ba11', id, jsonb_build_object('en', 'Brodmann area 11 (BA11)', 'he', 'אזור ברודמן 11 (BA11)'), 6 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba12', 'left.frontal.ba12', id, jsonb_build_object('en', 'Brodmann area 12 (BA12)', 'he', 'אזור ברודמן 12 (BA12)'), 7 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba44', 'left.frontal.ba44', id, jsonb_build_object('en', 'Brodmann area 44 (BA44)', 'he', 'אזור ברודמן 44 (BA44)'), 8 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba45', 'left.frontal.ba45', id, jsonb_build_object('en', 'Brodmann area 45 (BA45)', 'he', 'אזור ברודמן 45 (BA45)'), 9 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba46', 'left.frontal.ba46', id, jsonb_build_object('en', 'Brodmann area 46 (BA46)', 'he', 'אזור ברודמן 46 (BA46)'), 10 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba47', 'left.frontal.ba47', id, jsonb_build_object('en', 'Brodmann area 47 (BA47)', 'he', 'אזור ברודמן 47 (BA47)'), 11 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'parietal', 'left.parietal', id, jsonb_build_object('en', 'Parietal lobe', 'he', 'האונה הקודקודית'), 2 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba1', 'left.parietal.ba1', id, jsonb_build_object('en', 'Brodmann area 1 (BA1)', 'he', 'אזור ברודמן 1 (BA1)'), 1 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba2', 'left.parietal.ba2', id, jsonb_build_object('en', 'Brodmann area 2 (BA2)', 'he', 'אזור ברודמן 2 (BA2)'), 2 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba3', 'left.parietal.ba3', id, jsonb_build_object('en', 'Brodmann area 3 (BA3)', 'he', 'אזור ברודמן 3 (BA3)'), 3 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba5', 'left.parietal.ba5', id, jsonb_build_object('en', 'Brodmann area 5 (BA5)', 'he', 'אזור ברודמן 5 (BA5)'), 4 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba7', 'left.parietal.ba7', id, jsonb_build_object('en', 'Brodmann area 7 (BA7)', 'he', 'אזור ברודמן 7 (BA7)'), 5 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba39', 'left.parietal.ba39', id, jsonb_build_object('en', 'Brodmann area 39 (BA39)', 'he', 'אזור ברודמן 39 (BA39)'), 6 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba40', 'left.parietal.ba40', id, jsonb_build_object('en', 'Brodmann area 40 (BA40)', 'he', 'אזור ברודמן 40 (BA40)'), 7 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba43', 'left.parietal.ba43', id, jsonb_build_object('en', 'Brodmann area 43 (BA43)', 'he', 'אזור ברודמן 43 (BA43)'), 8 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'temporal', 'left.temporal', id, jsonb_build_object('en', 'Temporal lobe', 'he', 'האונה הרקתית'), 3 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba20', 'left.temporal.ba20', id, jsonb_build_object('en', 'Brodmann area 20 (BA20)', 'he', 'אזור ברודמן 20 (BA20)'), 1 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba21', 'left.temporal.ba21', id, jsonb_build_object('en', 'Brodmann area 21 (BA21)', 'he', 'אזור ברודמן 21 (BA21)'), 2 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba22', 'left.temporal.ba22', id, jsonb_build_object('en', 'Brodmann area 22 (BA22)', 'he', 'אזור ברודמן 22 (BA22)'), 3 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba37', 'left.temporal.ba37', id, jsonb_build_object('en', 'Brodmann area 37 (BA37)', 'he', 'אזור ברודמן 37 (BA37)'), 4 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba38', 'left.temporal.ba38', id, jsonb_build_object('en', 'Brodmann area 38 (BA38)', 'he', 'אזור ברודמן 38 (BA38)'), 5 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba41', 'left.temporal.ba41', id, jsonb_build_object('en', 'Brodmann area 41 (BA41)', 'he', 'אזור ברודמן 41 (BA41)'), 6 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba42', 'left.temporal.ba42', id, jsonb_build_object('en', 'Brodmann area 42 (BA42)', 'he', 'אזור ברודמן 42 (BA42)'), 7 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'occipital', 'left.occipital', id, jsonb_build_object('en', 'Occipital lobe', 'he', 'האונה העורפית'), 4 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba17', 'left.occipital.ba17', id, jsonb_build_object('en', 'Brodmann area 17 (BA17)', 'he', 'אזור ברודמן 17 (BA17)'), 1 FROM app.brain_region WHERE path = 'left.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba18', 'left.occipital.ba18', id, jsonb_build_object('en', 'Brodmann area 18 (BA18)', 'he', 'אזור ברודמן 18 (BA18)'), 2 FROM app.brain_region WHERE path = 'left.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba19', 'left.occipital.ba19', id, jsonb_build_object('en', 'Brodmann area 19 (BA19)', 'he', 'אזור ברודמן 19 (BA19)'), 3 FROM app.brain_region WHERE path = 'left.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'limbic', 'left.limbic', id, jsonb_build_object('en', 'Limbic lobe', 'he', 'האונה הלימבית'), 5 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba23', 'left.limbic.ba23', id, jsonb_build_object('en', 'Brodmann area 23 (BA23)', 'he', 'אזור ברודמן 23 (BA23)'), 1 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba24', 'left.limbic.ba24', id, jsonb_build_object('en', 'Brodmann area 24 (BA24)', 'he', 'אזור ברודמן 24 (BA24)'), 2 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba25', 'left.limbic.ba25', id, jsonb_build_object('en', 'Brodmann area 25 (BA25)', 'he', 'אזור ברודמן 25 (BA25)'), 3 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba26', 'left.limbic.ba26', id, jsonb_build_object('en', 'Brodmann area 26 (BA26)', 'he', 'אזור ברודמן 26 (BA26)'), 4 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba27', 'left.limbic.ba27', id, jsonb_build_object('en', 'Brodmann area 27 (BA27)', 'he', 'אזור ברודמן 27 (BA27)'), 5 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba28', 'left.limbic.ba28', id, jsonb_build_object('en', 'Brodmann area 28 (BA28)', 'he', 'אזור ברודמן 28 (BA28)'), 6 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba29', 'left.limbic.ba29', id, jsonb_build_object('en', 'Brodmann area 29 (BA29)', 'he', 'אזור ברודמן 29 (BA29)'), 7 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba30', 'left.limbic.ba30', id, jsonb_build_object('en', 'Brodmann area 30 (BA30)', 'he', 'אזור ברודמן 30 (BA30)'), 8 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba31', 'left.limbic.ba31', id, jsonb_build_object('en', 'Brodmann area 31 (BA31)', 'he', 'אזור ברודמן 31 (BA31)'), 9 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba32', 'left.limbic.ba32', id, jsonb_build_object('en', 'Brodmann area 32 (BA32)', 'he', 'אזור ברודמן 32 (BA32)'), 10 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba33', 'left.limbic.ba33', id, jsonb_build_object('en', 'Brodmann area 33 (BA33)', 'he', 'אזור ברודמן 33 (BA33)'), 11 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba34', 'left.limbic.ba34', id, jsonb_build_object('en', 'Brodmann area 34 (BA34)', 'he', 'אזור ברודמן 34 (BA34)'), 12 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba35', 'left.limbic.ba35', id, jsonb_build_object('en', 'Brodmann area 35 (BA35)', 'he', 'אזור ברודמן 35 (BA35)'), 13 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba36', 'left.limbic.ba36', id, jsonb_build_object('en', 'Brodmann area 36 (BA36)', 'he', 'אזור ברודמן 36 (BA36)'), 14 FROM app.brain_region WHERE path = 'left.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'insula', 'left.insula', id, jsonb_build_object('en', 'Insula', 'he', 'האינסולה'), 6 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba13', 'left.insula.ba13', id, jsonb_build_object('en', 'Brodmann area 13 (BA13)', 'he', 'אזור ברודמן 13 (BA13)'), 1 FROM app.brain_region WHERE path = 'left.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba14', 'left.insula.ba14', id, jsonb_build_object('en', 'Brodmann area 14 (BA14)', 'he', 'אזור ברודמן 14 (BA14)'), 2 FROM app.brain_region WHERE path = 'left.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba15', 'left.insula.ba15', id, jsonb_build_object('en', 'Brodmann area 15 (BA15)', 'he', 'אזור ברודמן 15 (BA15)'), 3 FROM app.brain_region WHERE path = 'left.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba16', 'left.insula.ba16', id, jsonb_build_object('en', 'Brodmann area 16 (BA16)', 'he', 'אזור ברודמן 16 (BA16)'), 4 FROM app.brain_region WHERE path = 'left.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'cerebellum', 'left.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 7 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'cerebellum', 'left.cerebellum.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 1 FROM app.brain_region WHERE path = 'left.cerebellum';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) VALUES ('hemisphere', 'right', 'right', NULL, jsonb_build_object('en', 'Right hemisphere', 'he', 'ההמיספרה הימנית'), 2);
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'frontal', 'right.frontal', id, jsonb_build_object('en', 'Frontal lobe', 'he', 'האונה המצחית'), 1 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba4', 'right.frontal.ba4', id, jsonb_build_object('en', 'Brodmann area 4 (BA4)', 'he', 'אזור ברודמן 4 (BA4)'), 1 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba6', 'right.frontal.ba6', id, jsonb_build_object('en', 'Brodmann area 6 (BA6)', 'he', 'אזור ברודמן 6 (BA6)'), 2 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba8', 'right.frontal.ba8', id, jsonb_build_object('en', 'Brodmann area 8 (BA8)', 'he', 'אזור ברודמן 8 (BA8)'), 3 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba9', 'right.frontal.ba9', id, jsonb_build_object('en', 'Brodmann area 9 (BA9)', 'he', 'אזור ברודמן 9 (BA9)'), 4 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba10', 'right.frontal.ba10', id, jsonb_build_object('en', 'Brodmann area 10 (BA10)', 'he', 'אזור ברודמן 10 (BA10)'), 5 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba11', 'right.frontal.ba11', id, jsonb_build_object('en', 'Brodmann area 11 (BA11)', 'he', 'אזור ברודמן 11 (BA11)'), 6 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba12', 'right.frontal.ba12', id, jsonb_build_object('en', 'Brodmann area 12 (BA12)', 'he', 'אזור ברודמן 12 (BA12)'), 7 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba44', 'right.frontal.ba44', id, jsonb_build_object('en', 'Brodmann area 44 (BA44)', 'he', 'אזור ברודמן 44 (BA44)'), 8 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba45', 'right.frontal.ba45', id, jsonb_build_object('en', 'Brodmann area 45 (BA45)', 'he', 'אזור ברודמן 45 (BA45)'), 9 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba46', 'right.frontal.ba46', id, jsonb_build_object('en', 'Brodmann area 46 (BA46)', 'he', 'אזור ברודמן 46 (BA46)'), 10 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba47', 'right.frontal.ba47', id, jsonb_build_object('en', 'Brodmann area 47 (BA47)', 'he', 'אזור ברודמן 47 (BA47)'), 11 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'parietal', 'right.parietal', id, jsonb_build_object('en', 'Parietal lobe', 'he', 'האונה הקודקודית'), 2 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba1', 'right.parietal.ba1', id, jsonb_build_object('en', 'Brodmann area 1 (BA1)', 'he', 'אזור ברודמן 1 (BA1)'), 1 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba2', 'right.parietal.ba2', id, jsonb_build_object('en', 'Brodmann area 2 (BA2)', 'he', 'אזור ברודמן 2 (BA2)'), 2 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba3', 'right.parietal.ba3', id, jsonb_build_object('en', 'Brodmann area 3 (BA3)', 'he', 'אזור ברודמן 3 (BA3)'), 3 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba5', 'right.parietal.ba5', id, jsonb_build_object('en', 'Brodmann area 5 (BA5)', 'he', 'אזור ברודמן 5 (BA5)'), 4 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba7', 'right.parietal.ba7', id, jsonb_build_object('en', 'Brodmann area 7 (BA7)', 'he', 'אזור ברודמן 7 (BA7)'), 5 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba39', 'right.parietal.ba39', id, jsonb_build_object('en', 'Brodmann area 39 (BA39)', 'he', 'אזור ברודמן 39 (BA39)'), 6 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba40', 'right.parietal.ba40', id, jsonb_build_object('en', 'Brodmann area 40 (BA40)', 'he', 'אזור ברודמן 40 (BA40)'), 7 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba43', 'right.parietal.ba43', id, jsonb_build_object('en', 'Brodmann area 43 (BA43)', 'he', 'אזור ברודמן 43 (BA43)'), 8 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'temporal', 'right.temporal', id, jsonb_build_object('en', 'Temporal lobe', 'he', 'האונה הרקתית'), 3 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba20', 'right.temporal.ba20', id, jsonb_build_object('en', 'Brodmann area 20 (BA20)', 'he', 'אזור ברודמן 20 (BA20)'), 1 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba21', 'right.temporal.ba21', id, jsonb_build_object('en', 'Brodmann area 21 (BA21)', 'he', 'אזור ברודמן 21 (BA21)'), 2 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba22', 'right.temporal.ba22', id, jsonb_build_object('en', 'Brodmann area 22 (BA22)', 'he', 'אזור ברודמן 22 (BA22)'), 3 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba37', 'right.temporal.ba37', id, jsonb_build_object('en', 'Brodmann area 37 (BA37)', 'he', 'אזור ברודמן 37 (BA37)'), 4 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba38', 'right.temporal.ba38', id, jsonb_build_object('en', 'Brodmann area 38 (BA38)', 'he', 'אזור ברודמן 38 (BA38)'), 5 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba41', 'right.temporal.ba41', id, jsonb_build_object('en', 'Brodmann area 41 (BA41)', 'he', 'אזור ברודמן 41 (BA41)'), 6 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba42', 'right.temporal.ba42', id, jsonb_build_object('en', 'Brodmann area 42 (BA42)', 'he', 'אזור ברודמן 42 (BA42)'), 7 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'occipital', 'right.occipital', id, jsonb_build_object('en', 'Occipital lobe', 'he', 'האונה העורפית'), 4 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba17', 'right.occipital.ba17', id, jsonb_build_object('en', 'Brodmann area 17 (BA17)', 'he', 'אזור ברודמן 17 (BA17)'), 1 FROM app.brain_region WHERE path = 'right.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba18', 'right.occipital.ba18', id, jsonb_build_object('en', 'Brodmann area 18 (BA18)', 'he', 'אזור ברודמן 18 (BA18)'), 2 FROM app.brain_region WHERE path = 'right.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba19', 'right.occipital.ba19', id, jsonb_build_object('en', 'Brodmann area 19 (BA19)', 'he', 'אזור ברודמן 19 (BA19)'), 3 FROM app.brain_region WHERE path = 'right.occipital';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'limbic', 'right.limbic', id, jsonb_build_object('en', 'Limbic lobe', 'he', 'האונה הלימבית'), 5 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba23', 'right.limbic.ba23', id, jsonb_build_object('en', 'Brodmann area 23 (BA23)', 'he', 'אזור ברודמן 23 (BA23)'), 1 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba24', 'right.limbic.ba24', id, jsonb_build_object('en', 'Brodmann area 24 (BA24)', 'he', 'אזור ברודמן 24 (BA24)'), 2 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba25', 'right.limbic.ba25', id, jsonb_build_object('en', 'Brodmann area 25 (BA25)', 'he', 'אזור ברודמן 25 (BA25)'), 3 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba26', 'right.limbic.ba26', id, jsonb_build_object('en', 'Brodmann area 26 (BA26)', 'he', 'אזור ברודמן 26 (BA26)'), 4 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba27', 'right.limbic.ba27', id, jsonb_build_object('en', 'Brodmann area 27 (BA27)', 'he', 'אזור ברודמן 27 (BA27)'), 5 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba28', 'right.limbic.ba28', id, jsonb_build_object('en', 'Brodmann area 28 (BA28)', 'he', 'אזור ברודמן 28 (BA28)'), 6 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba29', 'right.limbic.ba29', id, jsonb_build_object('en', 'Brodmann area 29 (BA29)', 'he', 'אזור ברודמן 29 (BA29)'), 7 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba30', 'right.limbic.ba30', id, jsonb_build_object('en', 'Brodmann area 30 (BA30)', 'he', 'אזור ברודמן 30 (BA30)'), 8 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba31', 'right.limbic.ba31', id, jsonb_build_object('en', 'Brodmann area 31 (BA31)', 'he', 'אזור ברודמן 31 (BA31)'), 9 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba32', 'right.limbic.ba32', id, jsonb_build_object('en', 'Brodmann area 32 (BA32)', 'he', 'אזור ברודמן 32 (BA32)'), 10 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba33', 'right.limbic.ba33', id, jsonb_build_object('en', 'Brodmann area 33 (BA33)', 'he', 'אזור ברודמן 33 (BA33)'), 11 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba34', 'right.limbic.ba34', id, jsonb_build_object('en', 'Brodmann area 34 (BA34)', 'he', 'אזור ברודמן 34 (BA34)'), 12 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba35', 'right.limbic.ba35', id, jsonb_build_object('en', 'Brodmann area 35 (BA35)', 'he', 'אזור ברודמן 35 (BA35)'), 13 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba36', 'right.limbic.ba36', id, jsonb_build_object('en', 'Brodmann area 36 (BA36)', 'he', 'אזור ברודמן 36 (BA36)'), 14 FROM app.brain_region WHERE path = 'right.limbic';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'insula', 'right.insula', id, jsonb_build_object('en', 'Insula', 'he', 'האינסולה'), 6 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba13', 'right.insula.ba13', id, jsonb_build_object('en', 'Brodmann area 13 (BA13)', 'he', 'אזור ברודמן 13 (BA13)'), 1 FROM app.brain_region WHERE path = 'right.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba14', 'right.insula.ba14', id, jsonb_build_object('en', 'Brodmann area 14 (BA14)', 'he', 'אזור ברודמן 14 (BA14)'), 2 FROM app.brain_region WHERE path = 'right.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba15', 'right.insula.ba15', id, jsonb_build_object('en', 'Brodmann area 15 (BA15)', 'he', 'אזור ברודמן 15 (BA15)'), 3 FROM app.brain_region WHERE path = 'right.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'ba16', 'right.insula.ba16', id, jsonb_build_object('en', 'Brodmann area 16 (BA16)', 'he', 'אזור ברודמן 16 (BA16)'), 4 FROM app.brain_region WHERE path = 'right.insula';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'cerebellum', 'right.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 7 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', 'cerebellum', 'right.cerebellum.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 1 FROM app.brain_region WHERE path = 'right.cerebellum';
