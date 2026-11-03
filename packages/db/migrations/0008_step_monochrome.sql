-- 0008: black and white per protocol step (ADR 0009). Expand-only: a new
-- column with a default, so existing rows and older app versions keep working.
-- The tables already have row-level security; adding a column changes nothing there.
ALTER TABLE app.template_step   ADD COLUMN monochrome boolean NOT NULL DEFAULT false;
ALTER TABLE app.assignment_step ADD COLUMN monochrome boolean NOT NULL DEFAULT false;
