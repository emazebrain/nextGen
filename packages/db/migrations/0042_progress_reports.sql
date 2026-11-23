-- 0042: progress reports (design doc §5.9.2 export; progress report design 2026-11-23).
-- A therapist issues a report for one patient over a date range, with a short written summary. What was issued is
-- kept exactly as issued: the figures are stored with the report, and nothing but the "shared with the family"
-- switch can change afterwards. Clinics gain the details a letterhead needs.

ALTER TABLE app.clinic
  ADD COLUMN address    text CHECK (address IS NULL OR char_length(address) <= 300),
  ADD COLUMN phone      text CHECK (phone IS NULL OR char_length(phone) <= 40),
  ADD COLUMN license_no text CHECK (license_no IS NULL OR char_length(license_no) <= 60);

CREATE TABLE app.progress_report (
  id                 uuid PRIMARY KEY DEFAULT app.uuidv7(),
  patient_id         uuid NOT NULL REFERENCES app.patient(id),
  clinic_id          uuid NOT NULL REFERENCES app.clinic(id),
  created_by         uuid NOT NULL REFERENCES app.app_user(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  period_from        date NOT NULL,
  period_to          date NOT NULL,
  audience           text NOT NULL CHECK (audience IN ('family', 'formal')),
  locale             text NOT NULL CHECK (locale IN ('en', 'he')),
  summary            text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 2000),
  shared_with_family boolean NOT NULL DEFAULT false,
  -- The figures as they stood when the report was issued (totals, activities, trend, difficulty changes, plan).
  data               jsonb NOT NULL,
  CONSTRAINT progress_report_period CHECK (period_to >= period_from AND period_to - period_from <= 366)
);
CREATE INDEX progress_report_patient_ix ON app.progress_report (patient_id, created_at DESC);

-- The clinic is the patient's, whatever the caller sent.
CREATE FUNCTION app.progress_report_fill() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = app, pg_temp AS $$
BEGIN
  SELECT p.clinic_id INTO NEW.clinic_id FROM app.patient p WHERE p.id = NEW.patient_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER progress_report_fill BEFORE INSERT ON app.progress_report FOR EACH ROW EXECUTE FUNCTION app.progress_report_fill();

-- An issued report is never rewritten or removed; only sharing with the family can be switched.
CREATE FUNCTION app.progress_report_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'progress reports are append-only';
  END IF;
  IF (to_jsonb(NEW) - 'shared_with_family') IS DISTINCT FROM (to_jsonb(OLD) - 'shared_with_family') THEN
    RAISE EXCEPTION 'progress reports are append-only: only sharing can change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER progress_report_guard BEFORE UPDATE OR DELETE ON app.progress_report FOR EACH ROW EXECUTE FUNCTION app.progress_report_guard();
CREATE TRIGGER audit_progress_report AFTER INSERT OR UPDATE OR DELETE ON app.progress_report FOR EACH ROW EXECUTE FUNCTION app.audit_row_change();

ALTER TABLE app.progress_report ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.progress_report FORCE ROW LEVEL SECURITY;

-- Policies call helpers only, never another table directly (see 0041).
CREATE POLICY progress_report_read ON app.progress_report FOR SELECT
  USING (app.can_see_patient(patient_id) OR (shared_with_family AND app.is_guardian_of(patient_id)));
CREATE POLICY progress_report_insert ON app.progress_report FOR INSERT
  WITH CHECK (app.can_treat_patient(patient_id) AND created_by = app.current_user_id());
CREATE POLICY progress_report_share ON app.progress_report FOR UPDATE
  USING (app.can_treat_patient(patient_id)) WITH CHECK (app.can_treat_patient(patient_id));

GRANT SELECT, INSERT ON app.progress_report TO emb_app;
GRANT UPDATE (shared_with_family) ON app.progress_report TO emb_app;
