# ADR 0012 — Peek Peek on the SDK: hearts per board, placement by hemisphere, v1 fixes

- Status: Accepted
- Date: 2026-11-03
- Design doc: §8.4 Peek Peek, §8.1 (lives = auto), §10.3 (`lives_auto`), §17.1 (native parameters)
- Source: v1 `src/lib/peekPeek/*` and `src/pages/PeekPeek.jsx` (timewellspenthavlaz/emazebrain)

## Context

Peek Peek is the next MVP game (§15 Phase 1). v1's progression (12 hex boards over 50 levels, distinct pictures K,
copy partition, the λ = 2.5 heart-budget model, probe and relief levels, scoring) and its metrics are ported as
they were, with the platform rules of v2 around them. The product owner chose: placeholder art drawn in code, a
full port, and the hemisphere deciding both the palette and where pictures lean.

## Decisions

**Game logic is pure and ported line for line.** `games/peek-peek/src/config.ts`, `board.ts`, `engine.ts` and
`metrics.ts` take `now` and a seed; nothing reads a clock. A test pins K, the copy partition, the heart budget and
the study time for all 250 level × difficulty pairs, and three scores, to values generated from v1's own code.

**Lives (§8.1).** Three models, decided by the step:
- `lives = auto` (the manifest recommends it): each board gets max(3, round(M₀.₈₅ + slack)) hearts. An empty budget
  fails the board and a fresh board of the same size follows; after 5 failed attempts the game moves on.
  Session Rules records each wrong tile (`game_managed`) and never ends the session on them. The game shows the
  budget through a new optional SDK call, `session.boardHearts(left, total)`, drawn by the shared HUD with the
  same crack, glow and freeze as session hearts.
- `lives = N`: one session-wide counter in Session Rules; boards never fail.
- timed: wrong tiles are recorded only.
- Storage: `lives_auto boolean` on `template_step` and `assignment_step` (migration 0009, expand-only; the mode
  check is relaxed so a lives mode stores either a count or `lives_auto`). The API accepts `lives_auto` only for
  games whose manifest has `livesAuto`. The builder and the library preview offer "Automatic, per board".

**Hemisphere (no new parameter).** The design doc's `peek_peek.placement_bias` is not added; the step's hemisphere
drives it, as for Catch Me (ADR 0011):
- Look: left → warm "Treasure Garden" (terracotta pots, garden wall, sunflowers, petal burst); right → cold
  "Under the Sea" (clam shells, sea floor, bubbles).
- Placement: the first half of the pictures in tray order lean (p = 0.75) towards the side of the screen that
  hemisphere sees: left → right side, right → left side. v1's `orientation = right / left` did the same.
- Probe levels (4, 13, 17, 21, 25, 33, 41, 45 on mirror-symmetric boards) keep even placement, so the left/right
  measures, which use probe levels only, have a clean baseline. The control trial and practice are even too.

**Session flow.** Instructions → optional practice (one easy board, unscored) → control trial (one level-1 board
left face up: find every copy of one picture; `control_trials`, default on) → levels. The session clock starts on
the first tile tap after the first study phase, never during practice or the control trial.

**Parameters** (`peek_peek.*`): `pack` (marine / animals / household / faces / rotate), `control_trials`,
`hidden_count` (hide the copies-left dots), `study_time_s` (0 = formula, else 2–20 s). v1's `mode =
assessment | therapy` is dropped: its only effect was the `hidden_count` default, and the words break §11.6.

**Art.** 4 packs × 14 original pictures as small SVGs in `pictures.ts`, rasterised once in the frame (data: images
are allowed by the frame's CSP), with a 10% warm or cool glaze per palette. Results carry `art_status:
placeholder` until commissioned art lands.

## Fixed from v1

- Study time: v1 computed max(3, round½(1.6 + 0.225·T)) (+0.5 on relief levels) but always used 3 s. v2 uses the formula.
- Error classes: v1 marked a wrong tile as shown before classing it, so every miss was "within" and
  `perseveration_rate` was always 1. v2 classes first: within (already wrong for this picture), between (shown
  earlier in the level), novel (never shown).
- `learning_slope`: v1 spread misses evenly over re-reveals, so the slope was always 0. v2 divides each round's
  misses by chance for that round's pool, W(c, H) = c·(H−c)/(c+1), and fits a slope over the rounds of each level.
  Negative = getting better than chance as the board goes on.
- Board geometry: v1 shifted every other row on all boards, so "mirror-symmetric" interlock boards were lopsided.
  v2 centres each interlock row; brick boards keep the half-hex shift.

## Consequences

- `budget_model` stays flagged as not pilot-fitted; λ and the slack table must be re-fitted from pilot data before
  any normative claim.
- Metrics charted from the manifest: first-try accuracy (excluding the last picture), first-picture misses, capacity,
  learning, perseveration, search organisation, adjacency, the two left/right indices and best streak.
- The shared HUD now updates hearts in place, so the falling-heart animation is no longer wiped by the next frame
  (this also fixes session hearts in every game).
