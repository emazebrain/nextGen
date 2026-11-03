# ADR 0011 — Catch Me If You Can: the larger grid's side follows the hemisphere

- Status: Accepted
- Date: 2026-11-03
- Supersedes: "no side bias, the anchor board goes left or right at random" (v2)
- Design doc: §8.4 Catch Me If You Can (two-board stages)

## Context

From stage 2 a stage shows two boards: the larger anchor board and a smaller companion. Until now the anchor's
side was a coin flip on every stage. The product owner wants the anchor placed by the hemisphere the step is
set to activate, and no separate launch parameter for it (an `orientation` parameter was proposed and declined;
the manifest already uses `orientation` for landscape/portrait).

## Decision

- The step's existing `hemisphere` platform parameter decides the side. The anchor goes on the side of the
  screen that hemisphere sees (the visual field crosses over):
  - `hemisphere = left` → anchor on the right, companion on the left.
  - `hemisphere = right` → anchor on the left, companion on the right.
- Stage 1 and practice show the anchor alone, centred, as before.
- The side is fixed for the whole session; the random draw is removed (`anchorSideFor()` in `logic.ts`).
- On the last stage of a level both boards are the same size; the anchor is still the one placed by this rule.
- Games can describe what the hemisphere choice changes with an optional manifest field `hemisphereNote`; the
  protocol builder shows it under the Hemisphere control (English and Hebrew).

## Consequences

- With `hemisphere = left` the warm clock (top right) sits above the anchor; with `right` the cold bar (top left)
  does. Both fit the HUD space.
- Hemifield metrics (anchor-first rate, quadrants, side reached first) now always describe the same layout
  within a session. Baselines are already grouped by hemisphere (ADR 0009), so comparisons stay like for like.
- Removing the coin flip changes the seeded random sequence, so a seed replays a different run than before.
