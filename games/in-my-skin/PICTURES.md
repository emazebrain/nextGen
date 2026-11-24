# In My Skin — pictures

The product owner supplies the pictures; do not add or generate more here. **Cartoons** (20 pictures), **Numbers** (the ten digits) and **Letters** (26 English, 22 Hebrew) are the owner's final sets. Every other category still holds **placeholders**.

## What to supply

- One file per picture: PNG or WebP, **transparent background**, square, 512 × 512 px or larger, the subject filling most of the square.
- Colourful: the game makes the grey outline from the same file, so a picture that is already grey or black-and-white cannot be told from its outline.
- For each picture: a short name, its category, and which way it looks (left, right, or neither). Pictures that look left or right are mirrored to face their travel; letters, numbers, signs and arrows never are.
- Categories: 2D objects, 3D objects, cartoon faces, real-life faces, letters (Latin and Hebrew), numbers, arithmetic signs, geometric shapes, cartoons, real life, sports equipment, road signs, arrows, everyday items. About twelve per category.
- Photographs of real people need a licence and a release that cover this use.

## How they are added

1. Name the PNGs `<id>.png`, put them in a folder and run `python3 scripts/import-pictures.py <folder>`: it trims the margin, drops stray specks and writes `assets/<id>.webp`.
2. List each one in `src/pictures.ts` with its category and `faces`.
3. `pnpm --filter @emb/game-in-my-skin test` checks every listed picture has a file.

Two categories that have no pictures yet (real-life faces, real life) also need a line in `CATEGORIES` and `CATEGORY_HEMISPHERE` (both right hemisphere) and an option in the manifest's `category` setting.
