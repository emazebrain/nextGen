-- 0048: background music for a child (product owner, 2026-11-27).
--
-- Like the pulsed tones (0032), music is a per-child setting the therapist switches on in the child's details.
-- When it is on, the session player plays a tune that follows the hemisphere of the game being played. The tunes
-- are generated on the device; nothing is stored here but the switch. Expand-only: one column with a default.
ALTER TABLE app.patient ADD COLUMN IF NOT EXISTS music_enabled boolean NOT NULL DEFAULT false;
