# ADR 0009 — Catch Me If You Can: a different look and reward for each side, black and white, backgrounds

- Status: Accepted
- Date: 2026-11-03
- Design doc: §8.4 Catch Me If You Can (rows "Look by side", "Rewards", "Black and white", "Background", "Progress")

## Decisions

**Each side looks and rewards differently.** The hemisphere chosen for a step decides:

| | Left hemisphere | Right hemisphere |
| --- | --- | --- |
| Tiles | Flat 2D | 3D buttons |
| Correct answer | A short effort-praise message | A small confetti burst |
| Level up | A two-line message | Confetti cannons from both sides |
| Timer (ADR 0008) | Warm clock, top right | Cold bar, top left |

**The task stays measurable.**
- 3D tiles get their depth only from a bevelled rim and a shadow (superseded for the tile look by ADR 0010: mitred bevel facets, no drop shadow). Each tile's face is one flat colour, so the ΔE the engine sets is the ΔE the child sees.
- The background never touches the tiles. Each board keeps its plain light frame, so a background colour or pattern can't change how the tile colours look (simultaneous contrast).
- Rewards last under a second and never delay the next board beyond the existing 750 ms. With reduced motion, nothing moves.

**Black and white is a platform parameter, `monochrome`.** It is stored per step (migration 0008) and logged in `config_echo`. It is a platform setting rather than a game setting because the runtime draws the timer, the hearts and the end screen. A game opts in with `capabilities.monochrome`. Catch Me If You Can then uses lightness-only differences on grey tiles (the cvd_mode task), with grey confetti and a grey background. Only colours change: the side still decides everything in the table above.

**Backgrounds are game settings** (`background` solid/textured, `bg_motion`, `bg_temperature` auto/warm/cold).
- "Auto" follows the side. The colour is drawn once per session from that palette, using the seeded random generator, so a replay looks the same.
- Textures are flat patterns on the left and shaded 3D shapes on the right.
- Movement applies only to textures, and is off under reduced motion.

**Progress baselines are kept separately** per game × difficulty × side × black-and-white, because the two sides are no longer the same visual task.

## Consequences

- The praise wording lives in the game's strings (Hebrew and English) and follows §11.6: effort and attention, never "genius", "smart" or anything that sounds like a judgement.
- Existing sessions have no `monochrome` in `config_echo` and count as colour.
- A child who switches side starts a new baseline on that side, which the chart already shows with hollow points.
