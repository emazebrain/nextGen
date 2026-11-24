# In My Skin — artwork

## Cartoons

The twenty pictures of the "cartoons" category were supplied by the product owner on 2026-11-23, who holds the
right to use them. `scripts/import-pictures.py` trimmed and resized them; they are otherwise unchanged.

## Numbers

The ten digits of the "numbers" category were supplied by the product owner on 2026-11-24 as one SVG sheet, who
holds the right to use them. Each digit was cut out on its own; the sheet's flat grey drop shadow was left out,
because next to the game's grey outline it reads as a second outline. The arithmetic signs on the same sheet are
not used.

## Placeholders

The 3D-style pictures in `assets/` and the flat pictures in `src/flat.generated.ts` are a curated subset of
**Fluent Emoji**: Copyright (c) Microsoft Corporation, licensed under the
[MIT License](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE). Source packages:
`@lobehub/fluent-emoji-3d` 1.1.0 (3D style, 256 px) and `@iconify-json/fluent-emoji-flat` 1.2.6 (flat style).
`scripts/build-pictures.py` rebuilds both from those packages.

Letters, arithmetic signs, geometric shapes, arrows and road signs are drawn in code (`src/drawn.ts`).

The manifest's `credits` text shows this attribution on the game's library page.
