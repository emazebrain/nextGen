# In My Skin — artwork

## Cartoons

The twenty pictures of the "cartoons" category were supplied by the product owner on 2026-11-23, who holds the
right to use them. `scripts/import-pictures.py` trimmed and resized them; they are otherwise unchanged.

## Placeholders

The 3D-style pictures in `assets/` and the flat pictures in `src/flat.generated.ts` are a curated subset of
**Fluent Emoji**: Copyright (c) Microsoft Corporation, licensed under the
[MIT License](https://github.com/microsoft/fluentui-emoji/blob/main/LICENSE). Source packages:
`@lobehub/fluent-emoji-3d` 1.1.0 (3D style, 256 px) and `@iconify-json/fluent-emoji-flat` 1.2.6 (flat style).
`scripts/build-pictures.py` rebuilds both from those packages.

Letters, numbers, arithmetic signs, geometric shapes, arrows and road signs are drawn in code (`src/drawn.ts`).

The manifest's `credits` text shows this attribution on the game's library page.
