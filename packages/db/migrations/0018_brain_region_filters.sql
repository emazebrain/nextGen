-- 0018: brain-region filters (spec 2026-11-09-brain-region-filters-design.md, ADR 0020).
-- Expand-only. The region tree gains a 'subcortical' lobe, 'sublobe' nodes from the product owner's table and Brodmann
-- -> sub-lobe links; the table's rows go into app.region_setting; game steps may carry one region filter.
-- The old 'cerebellum' lobe and its leaf are retired (not deleted): their video tags move to subcortical.cerebellum.
-- A later contract migration deletes the retired nodes once no app version reads them.
-- AI-written: needs a human-reviewed diff before deploy (CLAUDE.md).

-- ---------------------------------------------------------------- the tree
ALTER TABLE app.brain_region DROP CONSTRAINT IF EXISTS brain_region_kind_check;
ALTER TABLE app.brain_region ADD CONSTRAINT brain_region_kind_check CHECK (kind IN ('hemisphere', 'lobe', 'sublobe', 'area'));
ALTER TABLE app.brain_region ADD COLUMN sublobe_id uuid REFERENCES app.brain_region(id);
ALTER TABLE app.brain_region ADD COLUMN retired_at timestamptz;

-- Only an area links to a sub-lobe, and only to one in the same hemisphere and lobe.
CREATE OR REPLACE FUNCTION app.check_region_sublobe() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s app.brain_region;
BEGIN
  IF NEW.sublobe_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO s FROM app.brain_region WHERE id = NEW.sublobe_id;
  IF NEW.kind <> 'area' OR s.kind IS DISTINCT FROM 'sublobe'
     OR split_part(s.path, '.', 1) <> split_part(NEW.path, '.', 1) OR split_part(s.path, '.', 2) <> split_part(NEW.path, '.', 2) THEN
    RAISE EXCEPTION 'region_sublobe_link' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER brain_region_sublobe_ck BEFORE INSERT OR UPDATE OF sublobe_id, kind, path ON app.brain_region
  FOR EACH ROW EXECUTE FUNCTION app.check_region_sublobe();

INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'subcortical', 'left.subcortical', id, jsonb_build_object('en', 'Subcortical', 'he', 'תת-קליפתי'), 8 FROM app.brain_region WHERE path = 'left';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'dlpfc', 'left.frontal.dlpfc', id, jsonb_build_object('en', 'DLPFC (dorsolateral prefrontal)', 'he', 'DLPFC (קדם-מצחי גבי-צדי)'), 100 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'orbitofrontal', 'left.frontal.orbitofrontal', id, jsonb_build_object('en', 'Orbitofrontal', 'he', 'אורביטו-פרונטלי'), 101 FROM app.brain_region WHERE path = 'left.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'parietal_main', 'left.parietal.parietal_main', id, jsonb_build_object('en', 'Parietal', 'he', 'קודקודי'), 102 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'superior_parietal', 'left.parietal.superior_parietal', id, jsonb_build_object('en', 'Superior parietal', 'he', 'קודקודי עליון'), 103 FROM app.brain_region WHERE path = 'left.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'superior_temporal', 'left.temporal.superior_temporal', id, jsonb_build_object('en', 'Superior temporal', 'he', 'רקתי עליון'), 104 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'middle_temporal', 'left.temporal.middle_temporal', id, jsonb_build_object('en', 'Middle temporal', 'he', 'רקתי אמצעי'), 105 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'inferior_temporal', 'left.temporal.inferior_temporal', id, jsonb_build_object('en', 'Inferior temporal', 'he', 'רקתי תחתון'), 106 FROM app.brain_region WHERE path = 'left.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'pons', 'left.subcortical.pons', id, jsonb_build_object('en', 'Pons', 'he', 'גשר המוח (פונס)'), 107 FROM app.brain_region WHERE path = 'left.subcortical';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'mesencephalon', 'left.subcortical.mesencephalon', id, jsonb_build_object('en', 'Mesencephalon (midbrain)', 'he', 'המוח התיכון'), 108 FROM app.brain_region WHERE path = 'left.subcortical';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'cerebellum', 'left.subcortical.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 109 FROM app.brain_region WHERE path = 'left.subcortical';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.frontal.ba9' AND s.path = 'left.frontal.dlpfc';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.frontal.ba46' AND s.path = 'left.frontal.dlpfc';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.frontal.ba11' AND s.path = 'left.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.frontal.ba12' AND s.path = 'left.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.frontal.ba47' AND s.path = 'left.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba1' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba2' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba3' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba39' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba40' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba43' AND s.path = 'left.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba5' AND s.path = 'left.parietal.superior_parietal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.parietal.ba7' AND s.path = 'left.parietal.superior_parietal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba22' AND s.path = 'left.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba41' AND s.path = 'left.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba42' AND s.path = 'left.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba21' AND s.path = 'left.temporal.middle_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba20' AND s.path = 'left.temporal.inferior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'left.temporal.ba37' AND s.path = 'left.temporal.inferior_temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'subcortical', 'right.subcortical', id, jsonb_build_object('en', 'Subcortical', 'he', 'תת-קליפתי'), 8 FROM app.brain_region WHERE path = 'right';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'dlpfc', 'right.frontal.dlpfc', id, jsonb_build_object('en', 'DLPFC (dorsolateral prefrontal)', 'he', 'DLPFC (קדם-מצחי גבי-צדי)'), 100 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'orbitofrontal', 'right.frontal.orbitofrontal', id, jsonb_build_object('en', 'Orbitofrontal', 'he', 'אורביטו-פרונטלי'), 101 FROM app.brain_region WHERE path = 'right.frontal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'parietal_main', 'right.parietal.parietal_main', id, jsonb_build_object('en', 'Parietal', 'he', 'קודקודי'), 102 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'superior_parietal', 'right.parietal.superior_parietal', id, jsonb_build_object('en', 'Superior parietal', 'he', 'קודקודי עליון'), 103 FROM app.brain_region WHERE path = 'right.parietal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'superior_temporal', 'right.temporal.superior_temporal', id, jsonb_build_object('en', 'Superior temporal', 'he', 'רקתי עליון'), 104 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'middle_temporal', 'right.temporal.middle_temporal', id, jsonb_build_object('en', 'Middle temporal', 'he', 'רקתי אמצעי'), 105 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'inferior_temporal', 'right.temporal.inferior_temporal', id, jsonb_build_object('en', 'Inferior temporal', 'he', 'רקתי תחתון'), 106 FROM app.brain_region WHERE path = 'right.temporal';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'pons', 'right.subcortical.pons', id, jsonb_build_object('en', 'Pons', 'he', 'גשר המוח (פונס)'), 107 FROM app.brain_region WHERE path = 'right.subcortical';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'mesencephalon', 'right.subcortical.mesencephalon', id, jsonb_build_object('en', 'Mesencephalon (midbrain)', 'he', 'המוח התיכון'), 108 FROM app.brain_region WHERE path = 'right.subcortical';
INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', 'cerebellum', 'right.subcortical.cerebellum', id, jsonb_build_object('en', 'Cerebellum', 'he', 'המוח הקטן'), 109 FROM app.brain_region WHERE path = 'right.subcortical';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.frontal.ba9' AND s.path = 'right.frontal.dlpfc';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.frontal.ba46' AND s.path = 'right.frontal.dlpfc';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.frontal.ba11' AND s.path = 'right.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.frontal.ba12' AND s.path = 'right.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.frontal.ba47' AND s.path = 'right.frontal.orbitofrontal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba1' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba2' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba3' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba39' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba40' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba43' AND s.path = 'right.parietal.parietal_main';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba5' AND s.path = 'right.parietal.superior_parietal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.parietal.ba7' AND s.path = 'right.parietal.superior_parietal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba22' AND s.path = 'right.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba41' AND s.path = 'right.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba42' AND s.path = 'right.temporal.superior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba21' AND s.path = 'right.temporal.middle_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba20' AND s.path = 'right.temporal.inferior_temporal';
UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = 'right.temporal.ba37' AND s.path = 'right.temporal.inferior_temporal';

-- ---------------------------------------------------------------- old cerebellum nodes: move tags, retire
INSERT INTO app.video_region (video_id, region_id)
  SELECT vr.video_id, n.id
    FROM app.video_region vr
    JOIN app.brain_region o ON o.id = vr.region_id
    JOIN app.brain_region n ON n.path = split_part(o.path, '.', 1) || '.subcortical.cerebellum'
   WHERE o.path IN ('left.cerebellum', 'left.cerebellum.cerebellum', 'right.cerebellum', 'right.cerebellum.cerebellum')
  ON CONFLICT DO NOTHING;
DELETE FROM app.video_region vr USING app.brain_region o
 WHERE o.id = vr.region_id AND o.path IN ('left.cerebellum', 'left.cerebellum.cerebellum', 'right.cerebellum', 'right.cerebellum.cerebellum');
UPDATE app.brain_region SET retired_at = now()
 WHERE path IN ('left.cerebellum', 'left.cerebellum.cerebellum', 'right.cerebellum', 'right.cerebellum.cerebellum');

-- ---------------------------------------------------------------- the product owner's table
CREATE TABLE app.region_setting (
  sublobe_id       uuid PRIMARY KEY REFERENCES app.brain_region(id),
  bg_temperature   text NOT NULL CHECK (bg_temperature IN ('warm', 'cold')),
  bg_types         text[] NOT NULL CHECK (cardinality(bg_types) >= 1 AND bg_types <@ ARRAY['solid', 'textured']::text[]),
  motion           jsonb NOT NULL CHECK (jsonb_typeof(motion) = 'array' AND jsonb_array_length(motion) >= 1),
  target_locations text[] NOT NULL CHECK (cardinality(target_locations) >= 1 AND target_locations <@ ARRAY['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']::text[]),
  rotation         text NOT NULL CHECK (rotation IN ('cw', 'ccw')),
  clinical_status  text NOT NULL DEFAULT 'draft' CHECK (clinical_status IN ('draft', 'approved')),
  revision         integer NOT NULL DEFAULT 1 CHECK (revision >= 1),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE app.region_setting ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.region_setting FORCE ROW LEVEL SECURITY;
CREATE POLICY rsetting_read  ON app.region_setting FOR SELECT USING (app.current_user_id() IS NOT NULL);
CREATE POLICY rsetting_write ON app.region_setting FOR ALL USING (app.is_platform_admin()) WITH CHECK (app.is_platform_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON app.region_setting TO emb_app;

INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,3],"directions":["tldbr"]},{"movement_types":[1],"directions":["brdtl"]}]'::jsonb, ARRAY['W', 'SW', 'NW', 'N', 'S']::text[], 'cw' FROM app.brain_region WHERE path = 'left.subcortical.cerebellum';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured']::text[], '[{"movement_types":[0,3],"directions":["ltr","tldbr"]},{"movement_types":[1],"directions":["rtl","brdtl"]}]'::jsonb, ARRAY['W', 'SW', 'S']::text[], 'cw' FROM app.brain_region WHERE path = 'right.frontal.dlpfc';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['solid']::text[], '[{"movement_types":[0,3],"directions":["ltr","ltr"]},{"movement_types":[1],"directions":["rtl","brdtl"]}]'::jsonb, ARRAY['W', 'NW', 'N']::text[], 'cw' FROM app.brain_region WHERE path = 'right.frontal.orbitofrontal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured']::text[], '[{"movement_types":[0],"directions":["ltr","tldbr"]}]'::jsonb, ARRAY['W', 'SW', 'S']::text[], 'cw' FROM app.brain_region WHERE path = 'right.parietal.parietal_main';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured']::text[], '[{"movement_types":[0],"directions":["ltr","tldbr"]}]'::jsonb, ARRAY['W', 'SW', 'S']::text[], 'cw' FROM app.brain_region WHERE path = 'right.parietal.superior_parietal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["ltr","tldbr"]}]'::jsonb, ARRAY['W', 'NW', 'N']::text[], 'cw' FROM app.brain_region WHERE path = 'right.temporal.superior_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["ltr","tldbr"]}]'::jsonb, ARRAY['W', 'NW', 'N']::text[], 'cw' FROM app.brain_region WHERE path = 'right.temporal.middle_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["ltr","tldbr"]}]'::jsonb, ARRAY['W', 'NW', 'N']::text[], 'cw' FROM app.brain_region WHERE path = 'right.temporal.inferior_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,3],"directions":["ltr"]},{"movement_types":[1],"directions":["rtl"]}]'::jsonb, ARRAY['W', 'SW', 'NW']::text[], 'cw' FROM app.brain_region WHERE path = 'right.subcortical.pons';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'cold', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,1],"directions":["ttb"]}]'::jsonb, ARRAY['W', 'N', 'S']::text[], 'cw' FROM app.brain_region WHERE path = 'right.subcortical.mesencephalon';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,3],"directions":["trdbl"]},{"movement_types":[1],"directions":["bldtr"]}]'::jsonb, ARRAY['E', 'SE', 'NE', 'N', 'S']::text[], 'ccw' FROM app.brain_region WHERE path = 'right.subcortical.cerebellum';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured']::text[], '[{"movement_types":[0,3],"directions":["rtl"]},{"movement_types":[1],"directions":["ltr"]}]'::jsonb, ARRAY['E', 'SE', 'S']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.frontal.dlpfc';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['solid']::text[], '[{"movement_types":[0,3],"directions":["rtl"]},{"movement_types":[1],"directions":["ltr"]}]'::jsonb, ARRAY['E', 'NE', 'N']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.frontal.orbitofrontal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured']::text[], '[{"movement_types":[0],"directions":["rtl","trdbl"]}]'::jsonb, ARRAY['E', 'SE', 'S']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.parietal.parietal_main';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured']::text[], '[{"movement_types":[0],"directions":["rtl","trdbl"]}]'::jsonb, ARRAY['E', 'SE', 'S']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.parietal.superior_parietal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["rtl","trdbl"]}]'::jsonb, ARRAY['E', 'NE', 'N']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.temporal.superior_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["rtl","trdbl"]}]'::jsonb, ARRAY['E', 'NE', 'N']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.temporal.middle_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['solid']::text[], '[{"movement_types":[0],"directions":["rtl","trdbl"]}]'::jsonb, ARRAY['E', 'NE', 'N']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.temporal.inferior_temporal';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,3],"directions":["rtl"]},{"movement_types":[1],"directions":["ltr"]}]'::jsonb, ARRAY['E', 'SE', 'NE']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.subcortical.pons';
INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, 'warm', ARRAY['textured', 'solid']::text[], '[{"movement_types":[0,1],"directions":["btt"]}]'::jsonb, ARRAY['E', 'N', 'S']::text[], 'ccw' FROM app.brain_region WHERE path = 'left.subcortical.mesencephalon';

-- ---------------------------------------------------------------- one filter per game step
ALTER TABLE app.template_step   ADD COLUMN region_id uuid REFERENCES app.brain_region(id);
ALTER TABLE app.assignment_step ADD COLUMN region_id uuid REFERENCES app.brain_region(id);

-- A game step's region is a sub-lobe with a row, an area linked to one, or a lobe with at least one; never retired;
-- and its side is the step's hemisphere column (the side chosen; what the game runs as is decided per launch).
CREATE OR REPLACE FUNCTION app.check_step_region() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r app.brain_region; ok boolean;
BEGIN
  IF NEW.region_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO r FROM app.brain_region WHERE id = NEW.region_id;
  ok := NEW.step_type = 'game' AND r.retired_at IS NULL AND CASE r.kind
    WHEN 'sublobe' THEN EXISTS (SELECT 1 FROM app.region_setting WHERE sublobe_id = r.id)
    WHEN 'area'    THEN EXISTS (SELECT 1 FROM app.region_setting WHERE sublobe_id = r.sublobe_id)
    WHEN 'lobe'    THEN EXISTS (SELECT 1 FROM app.brain_region s JOIN app.region_setting x ON x.sublobe_id = s.id WHERE s.parent_id = r.id AND s.kind = 'sublobe' AND s.retired_at IS NULL)
    ELSE false END;
  IF NOT coalesce(ok, false) THEN RAISE EXCEPTION 'step_region_invalid' USING ERRCODE = '23514'; END IF;
  IF split_part(r.path, '.', 1) <> NEW.hemisphere THEN RAISE EXCEPTION 'step_region_side' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER template_step_region_ck BEFORE INSERT OR UPDATE OF region_id, hemisphere, step_type ON app.template_step
  FOR EACH ROW EXECUTE FUNCTION app.check_step_region();
CREATE TRIGGER assignment_step_region_ck BEFORE INSERT OR UPDATE OF region_id, hemisphere, step_type ON app.assignment_step
  FOR EACH ROW EXECUTE FUNCTION app.check_step_region();
