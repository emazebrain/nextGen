-- Guardian contact details: add address column (§4.3 contact details).
-- Phone is enforced NOT NULL at the app layer (contract validation);
-- existing rows with NULL phone stay as-is in the DB.

ALTER TABLE app.guardian ADD COLUMN IF NOT EXISTS address text;
INSERT INTO public.schema_migrations (name) VALUES ('0030_guardian_address.sql') ON CONFLICT (name) DO NOTHING;
