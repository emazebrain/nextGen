-- Move tones from per-step to per-patient.
-- tones_enabled on patient controls whether pulsed tones play during sessions.
-- The per-step tones_enabled columns from 0031 are kept (no destructive changes)
-- but ignored by the app — the patient setting takes precedence.

ALTER TABLE app.patient ADD COLUMN IF NOT EXISTS tones_enabled boolean NOT NULL DEFAULT false;

INSERT INTO public.schema_migrations (name) VALUES ('0032_patient_tones.sql') ON CONFLICT (name) DO NOTHING;
