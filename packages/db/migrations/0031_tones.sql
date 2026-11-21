-- Pulsed audio tones during game/video steps.
-- tones_enabled: per-step flag in both template and assignment steps.
-- tone_age_group: patient-level override (nullable; auto-computed from DOB when null).

ALTER TABLE app.template_step ADD COLUMN IF NOT EXISTS tones_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE app.assignment_step ADD COLUMN IF NOT EXISTS tones_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE app.patient ADD COLUMN IF NOT EXISTS tone_age_group smallint;

INSERT INTO public.schema_migrations (name) VALUES ('0031_tones.sql') ON CONFLICT (name) DO NOTHING;
