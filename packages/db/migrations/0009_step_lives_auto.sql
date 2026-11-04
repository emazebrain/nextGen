-- 0009: lives = auto, a per-board heart budget the game manages (Peek Peek; design doc §8.1, §10.3, ADR 0012).
-- Expand-only: a new column with a default, and the mode check relaxed so a lives mode may leave `lives` empty
-- when `lives_auto` is on. Every existing row already passes the new check, and older app versions (which never
-- set lives_auto) keep writing rows that pass it. The tables already have row-level security; nothing changes there.
ALTER TABLE app.template_step   ADD COLUMN lives_auto boolean NOT NULL DEFAULT false;
ALTER TABLE app.assignment_step ADD COLUMN lives_auto boolean NOT NULL DEFAULT false;

ALTER TABLE app.template_step
  DROP CONSTRAINT step_mode_fields,
  ADD CONSTRAINT step_mode_fields CHECK (
    (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL AND NOT lives_auto) OR
    (session_mode = 'lives'       AND duration_s IS NULL     AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))) OR
    (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))));

ALTER TABLE app.assignment_step
  DROP CONSTRAINT astep_mode_fields,
  ADD CONSTRAINT astep_mode_fields CHECK (
    (session_mode = 'timed'       AND duration_s IS NOT NULL AND lives IS NULL AND NOT lives_auto) OR
    (session_mode = 'lives'       AND duration_s IS NULL     AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))) OR
    (session_mode = 'timed_lives' AND duration_s IS NOT NULL AND ((lives IS NOT NULL AND NOT lives_auto) OR (lives IS NULL AND lives_auto))));
