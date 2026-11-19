-- 0029: Appointment color for calendar UI.
ALTER TABLE app.appointment ADD COLUMN IF NOT EXISTS color text NOT NULL DEFAULT 'blue'
  CHECK (color IN ('blue', 'green', 'purple', 'orange', 'red', 'teal', 'pink', 'yellow'));
