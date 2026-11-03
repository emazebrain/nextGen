# ADR 0010 — Catch Me If You Can: bevelled 3D tiles on the right side

- Status: Accepted
- Date: 2026-11-03
- Supersedes: the 3D tile look in ADR 0009 (neutral side wall and drop shadow)
- Design doc: §8.4 Catch Me If You Can (row "Look by side")

## Context

The right-hemisphere 3D tiles were a flat face on a grey side wall with a drop shadow. The product owner asked
for the look of a glossy toy block instead: highlights, shades and tones that make each square read as 3D,
keeping the cold palette and one colour per board.

## Decision

- Each right-side tile is a bevelled block lit from above: four mitred edge facets around a raised face.
  Facet tones are fixed `shade()` steps of the tile's own colour: top +0.46, left +0.16, right −0.22,
  bottom −0.44. Each facet is drawn in 6 bands that ease from full tone at the outer edge to half tone
  next to the face, so the edges look rounded, not cut.
- The bevel is deeper at the bottom (11.5% of the tile) than the top (7.5%) and sides (8.5%), so the face
  sits up towards the light.
- A thin white gloss line on the top edge and a fine dark outline. No drop shadow and no grey side wall.
- Palettes are unchanged: one cold colour per board, the odd tile a ΔE away, black and white as before.

## Fairness

- Every tile on a board gets identical geometry and the same tone steps, so the only difference between the
  odd tile and the rest is the colour the engine chose.
- The face, about 65% of the tile, is one flat exact colour. The ΔE the engine sets is the ΔE the child sees
  on the largest, most central part of the tile. The bevel tones scale with the colour, so they never add
  a cue of their own.
- Tap targets are unchanged: the whole tile plus the forgiving margin.

## Consequences

- Drawn as plain polygons (no gradients or masks), so nothing extra to free between boards. On a laptop
  with integrated graphics the game holds the display rate.
- The left side keeps its flat 2D tiles.
