# ADR 0021 — Picture Trail: a picture-line memory game driven by the brain-region filter

- Status: Accepted
- Date: 2026-11-10
- Design doc: §8.3 (SDK), §8.4 (games), §8.1 (Session Rules), §11.6 (wording)
- Spec: `docs/superpowers/specs/2026-11-10-picture-trail-design.md` (approved by the product owner)
- Plan: `docs/superpowers/plans/2026-11-10-picture-trail.md`
- Builds on: ADR 0020 (brain-region filters), ADR 0011/0012 (hemisphere look)

## Context

The product owner asked for a game in two phases. Pictures appear one at a time along a line across the screen; then a
new run follows on the same line, and the child finds the one picture that was in the first run. The line's direction
and position, the colours and the background follow the therapist's brain-region filter. Pictures fit the child's age.
The product owner chose that question pictures disappear as the next appears, and that answer pictures do too, with
the child tapping while the match is on screen.

## Decisions

**Pure core, thin renderer.** `config.ts` covers 30 levels with N = 3, 4, 5, 6 and 8 in bands of six, show time by age
band (1300 / 1100 / 950 / 850 ms), 4% faster per level within a band, and a two-up / two-down staircase.
`geometry.ts` is the line: edge to edge or corner to corner, evenly spaced, shifted 22% across the line toward the
target location; N is capped when pictures would be under 64 px. `rounds.ts` builds a round: directions from the
filter's movement-type-0 entry, no repeat within a round, the match biased into the target half, look-alikes from
difficulty 4. `engine.ts` is the round over injected time, and `metrics.ts` computes the metrics. `index.ts` (Pixi)
only draws and reports.

**Session Rules own time and lives.** The clock starts on the "Tap to start" button. The game reports
`wrong_picture` (once per wrong picture) and `missed_match` (the match passed untapped). The runtime decides lives and
the end of the session.

**The brain-region filter.** The manifest declares `regionUse: { background, direction: true, targetLocation: true }`.
The host fills the background parameters from the row (ADR 0020). The game reads `region` for directions and target
locations, and its palette follows the hemisphere the row runs as. The builder locks the game's own `direction` setting
under a filter. Without a filter: left to right for the right hemisphere, right to left for the left, or the step's
fixed direction.

**Age.** New platform parameter `age_band` ("4-6", "7-9", "10-12", "13+"), computed by the API from the date of birth
(never sent) at launch and in offline packages; "10-12" when unknown. Not structural for offline tickets.

**Pictures.** 141 Twemoji pictures (CC-BY 4.0, attribution in `NOTICE.md` and the game's credits string), curated by
`scripts/pick-pictures.mjs`: no flags, faces, people, hands, weapons, alcohol, pork, or religious or national symbols.
Each has a category and the youngest band it suits. They are bundled into the frame (games make no network requests).
This is a placeholder until commissioned art arrives.

**Look.** A bright gradient background, with a dot or wave pattern when patterned. White rounded cards that pop in, and
faint dots marking the trail's stops. The answer run has a coloured frame (dashed in black and white). Confetti when
correct; a shake and fade when wrong. The child taps the picture itself, or presses Space or Enter.

## Consequences

- The trial tags (direction, target, N, match slots, age band, look-alike, wrong taps, capped) allow later analysis
  by direction and position; the admin charts show the seven session metrics.
- Open with the clinical advisor: timing, counts per level, look-alikes, and whether the trail dots should stay.
- Rotation and movement types from the table are not used yet.
