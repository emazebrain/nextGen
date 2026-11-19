-- 0027: Calendar support (design doc §5.13).
-- Add time-of-day to planned sessions so the calendar can show a day view.
-- Nullable for backward compat: existing sessions keep date-only until rescheduled.

ALTER TABLE app.planned_session ADD COLUMN IF NOT EXISTS planned_time time;

-- Index for calendar queries: date range + clinic, optionally filtered by care-team user.
CREATE INDEX IF NOT EXISTS planned_session_calendar_ix
  ON app.planned_session (clinic_id, planned_date, planned_time)
  WHERE status IN ('planned', 'in_progress');
