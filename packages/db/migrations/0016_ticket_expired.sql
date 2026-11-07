-- 0016: a result played after its ticket expired is kept and flagged, never refused (offline devices review, ADR 0019).
-- Expand-only: one more allowed review reason.
ALTER TABLE app.game_session DROP CONSTRAINT game_session_review_reason;
ALTER TABLE app.game_session ADD CONSTRAINT game_session_review_reason CHECK (review_reason IN
  ('consent_withdrawn', 'not_on_care_team', 'membership_ended', 'assignment_not_active', 'step_changed', 'session_closed', 'played_twice', 'params_outside_ticket', 'ticket_expired'));
ALTER TABLE app.video_view DROP CONSTRAINT video_view_review_reason;
ALTER TABLE app.video_view ADD CONSTRAINT video_view_review_reason CHECK (review_reason IN
  ('consent_withdrawn', 'not_on_care_team', 'membership_ended', 'assignment_not_active', 'step_changed', 'session_closed', 'played_twice', 'params_outside_ticket', 'ticket_expired'));
