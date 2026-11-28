-- When a planned session was started (its first launch). The home page's "Next up" list drops a patient once their
-- session has started today, while a session left unfinished on an earlier day stays listed; the status alone
-- ("in_progress") cannot tell the two apart. Additive only: sessions started before this have no time recorded.
ALTER TABLE app.planned_session ADD COLUMN started_at timestamptz;
