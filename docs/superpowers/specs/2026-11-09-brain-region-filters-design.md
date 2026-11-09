# Brain-region filters for game steps and videos — design

- Date: 2026-11-09
- Status: Draft for the product owner's approval
- Product owner: Barak
- Source table: the product owner's "brain region settings" sheet (2026-11-09), with a Brodmann column added by us
  (draft, pending the clinical advisor). Shared for clinical review in the Claude Doc "New picture-line memory game:
  brief for clinical review".
- Design doc: §7 (`brain_region`), §8.2 (platform parameters), §8.4 (games), ADR 0009 (backgrounds), ADR 0011
  (hemisphere decides the side), ADR 0018 (video library), ADR 0019 (offline devices)

## Intent

A therapist builds a protocol by picking a game and then **one brain-region filter** for it: side → lobe → sub-lobe
(for example right → temporal → superior temporal), or a Brodmann area. Whenever that step runs, in the clinic or at
home, online or offline, the game runs with the settings the product owner's table gives for that filter: background
colour and type, direction, where most objects are placed, rotation (and movement type, for future games). These come
on top of the game's own settings (difficulty, timer, lives, age).

Videos are tagged and filtered with the same regions, and with Brodmann areas.

This is the first of two projects. The second is the new picture-line memory game, which depends on it. The filter
also reaches every existing game: at minimum its side, and its background where the game has backgrounds.

## Product owner decisions (2026-11-09)

- The therapist picks a game first, then a filter for it. One filter per game step. A protocol can hold many game
  steps, each with its own filter.
- Reading the table: the first three columns (side, lobe, sub-lobe) are the filter; the rest of the row is how the
  game runs. Where a cell lists several options, the game chooses among them.
- Target location = where most objects are placed, when that is relevant to a game.
- Movement type is not used by the picture-line game; it is for future games.
- Videos are tagged and filtered with the same three levels.
- Brodmann areas are also tags and filters. Each Brodmann area points to one sub-lobe; a game step filtered by a
  Brodmann area runs with that sub-lobe's row.
- The table lives in the database, loaded from the sheet, with no editing screen yet (option 2). We apply the clinical
  advisor's corrections as reviewed updates. An editing screen with versions can come later.
- Parked for later discussion: starting from a filter and then seeing the games that suit it.
- **The table is the absolute truth.** A filter can stop at any level:
  - side only → the game behaves as today for that hemisphere;
  - side + lobe, side + lobe + sub-lobe, or a Brodmann area → the table's row decides the configuration.
- **Side + lobe with no sub-lobe:** each session picks one of that lobe's sub-lobes and uses its row exactly; the pick
  is recorded with the result (option 1 of three offered).
- **Crossed rows (the cerebellum):** the row decides, including everything a game ties to the hemisphere (see §4).

## Goals

- The region list holds both views: side → lobe → sub-lobe from the table, and the Brodmann areas, each Brodmann area
  linked to at most one sub-lobe.
- The table's settings are stored once, per sub-lobe, and used by games, the protocol builder and the launch.
- The protocol builder lets the therapist choose one filter per game step and shows what it will change.
- Every launch (online launch, offline package, home program) carries the resolved settings; results record the filter
  and the exact settings that ran.
- Existing games keep working unchanged when no filter is chosen, and take the filter's side (and background, where
  they have one) when it is.
- Videos can be tagged with sub-lobes and filtered by side, lobe, sub-lobe or Brodmann area.

## Non-goals

- An editing screen for the table (later, option 3).
- Filter-first browsing of games (parked).
- The picture-line game itself (project 2), and any use of direction, target location, rotation or movement type in
  existing games.
- Per-region progress baselines. Baselines stay per game × difficulty × side × black-and-white (ADR 0009); the region
  is recorded on every result, so finer analysis stays possible later.

## Anti-goals

- A filter that silently does nothing. If the chosen game uses only the side, the builder says so.
- Results that can't say what ran. A later correction to the table must never change what an old result reports.
- Breaking any existing protocol, assignment, offline package or ticket.
- Any brain-region wording on the child's screen, or any claim that the game activates, treats, assesses or diagnoses
  (§11.6). Region names appear only in therapist and admin screens.

## Approaches considered

1. **Table in code, changed by us.** Quick and reviewed in git, but videos already keep the region list in the
   database, so the list would live in two places that drift.
2. **Table in the database, seeded from the sheet, no editing screen yet.** One region list for games and videos;
   corrections arrive as reviewed migrations; an editor can be added without restructuring. **Chosen by the product
   owner.**
3. **Option 2 plus an editing screen with versions now.** Best if the table changes often; the most work.

## Design

### 1. The region list (expand `app.brain_region`)

Today: hemisphere → lobe → Brodmann area (`kind` hemisphere / lobe / area), plus a `cerebellum` lobe with a single
`cerebellum` leaf. Videos are tagged with nodes of this tree (`app.video_region`).

Changes (expand-only migration):

- New `kind = 'sublobe'`, a child of a lobe, at path depth 3 like areas (`right.temporal.superior_temporal`).
- New lobe `subcortical` under each hemisphere, holding the sub-lobes `pons`, `mesencephalon`, `cerebellum`.
- Sub-lobes from the table, under each side:

  | Lobe | Sub-lobe (label) | Code | Brodmann areas linked (draft) |
  | --- | --- | --- | --- |
  | Frontal | DLPFC | `dlpfc` | BA9, BA46 |
  | Frontal | Orbital frontal | `orbitofrontal` | BA11, BA12, BA47 |
  | Parietal | Parietal | `parietal_main` | BA1, BA2, BA3, BA39, BA40, BA43 |
  | Parietal | Superior parietal | `superior_parietal` | BA5, BA7 |
  | Temporal | Superior temporal | `superior_temporal` | BA22, BA41, BA42 |
  | Temporal | Middle temporal | `middle_temporal` | BA21 |
  | Temporal | Inferior temporal | `inferior_temporal` | BA20, BA37 |
  | Subcortical | Pons | `pons` | none |
  | Subcortical | Mesencephalon | `mesencephalon` | none |
  | Subcortical | Cerebellum | `cerebellum` | none |

  Codes are our call. `parietal_main` avoids a code that equals its lobe's code (the video filter accepts bare codes).
  Hebrew labels are our draft, to be checked.
- Brodmann areas stay children of their lobe. A new nullable column `brain_region.sublobe_id` links an area to one
  sub-lobe, with a check that both share the hemisphere and lobe.
- Areas with no sub-lobe (BA4, BA6, BA8, BA10, BA44, BA45, BA38, BA17–19, BA23–36, BA13–16) stay usable as video tags
  and video filters, and are not selectable as a game filter until the clinical advisor maps them.
- The old `cerebellum` lobe and its leaf: video tags on them move to the new `subcortical.cerebellum` node in the same
  migration, and the old nodes get `retired_at` set (new nullable column) so pickers hide them. They are deleted in a
  later contract migration once no app version reads them.

The tree is seeded from TypeScript in `packages/db/src/brain-regions.ts` (as today), extended with the sub-lobes and
the area → sub-lobe links; a test checks the migration matches it.

### 2. The settings table (`app.region_setting`)

One row per sub-lobe (20 rows: 10 sub-lobes × 2 sides).

| Column | Type | Meaning |
| --- | --- | --- |
| `sublobe_id` | uuid PK → brain_region (kind sublobe) | the filter |
| `bg_temperature` | `warm` \| `cold` | background colour family |
| `bg_types` | text[] ⊆ {`solid`, `textured`}, non-empty | the game chooses when two are listed |
| `motion` | jsonb array of `{movement_types: int[], directions: text[]}` | one entry per line of the sheet |
| `target_locations` | text[] ⊆ {N, NE, E, SE, S, SW, W, NW}, non-empty | where most objects go |
| `rotation` | `cw` \| `ccw` | |
| `clinical_status` | `draft` \| `approved` | all `draft` until the advisor signs off |
| `revision` | int, starts at 1 | bumped by every correction migration |
| `updated_at` | timestamptz | |

- Directions are stored as codes `ltr`, `rtl`, `ttb`, `btt`, `tldbr`, `brdtl`, `trdbl`, `bldtr` (the sheet's letters,
  lower case). Movement types 0–5 as in the sheet.
- The sheet's values are loaded as given, including the two possible typos (right orbital frontal "LTR, LTR"; left
  DLPFC and left orbital frontal with no diagonal), which wait for the advisor. Duplicates within one cell are kept as
  given; a game choosing from the list may land on the same direction twice.
- The source sheet (blank cells filled from the line above, Brodmann column added) is committed next to this spec as
  `2026-11-09-brain-region-settings.csv`, and moves to `packages/db/src/region-settings.csv` in the build. Each sheet
  line is one `motion` entry. Worked example, right DLPFC (two lines):
  `[{"movement_types":[0,3],"directions":["ltr","tldbr"]},{"movement_types":[1],"directions":["rtl","brdtl"]}]`;
  right parietal (one line): `[{"movement_types":[0],"directions":["ltr","tldbr"]}]`.
- A generator in
  `packages/db/src/region-settings.ts` turns it into the seed SQL, and a test checks the migration matches the CSV.
  Corrections from the advisor: edit the CSV, regenerate, ship a migration that updates the changed rows and bumps
  their `revision`.
- RLS as `brain_region`: any signed-in user reads; only platform admins write. ENABLE + FORCE + policies in the same
  migration.

### 3. Game steps carry one filter

- New nullable column `region_id` on `template_step` and `assignment_step` (→ `brain_region`). Allowed nodes: a
  lobe that has at least one sub-lobe with a settings row, a sub-lobe, or an area with a `sublobe_id`. Checked in the
  API and by a trigger. Video steps keep it NULL.
- NULL = side only, today's behaviour: the step's `hemisphere` is the chosen side. Every existing step stays NULL.
- When set, the API sets the step's `hemisphere` column to the region's side (its path's first segment) and refuses a
  different one. That column keeps meaning "the side chosen". What the game runs as is decided per launch (§4).
- Copying a protocol to a patient (`assignment_step`) copies `region_id`, as it copies every other setting.

### 4. What a game receives

A new optional platform parameter, resolved by the API at launch:

```ts
interface RegionParam {
  path: string;            // the chosen node: a lobe ("right.frontal"), a sub-lobe or an area ("right.temporal.ba22")
  sublobe: string;         // the sub-lobe whose row applies, e.g. "right.temporal.superior_temporal"
  drawn: boolean;          // true when `path` is a lobe and this session's sub-lobe was picked from it
  revision: number;        // region_setting.revision used
  clinical_status: "draft" | "approved";
  bg_temperature: "warm" | "cold";
  bg_types: ("solid" | "textured")[];
  motion: { movement_types: number[]; directions: Direction[] }[];
  target_locations: Compass[];
  rotation: "cw" | "ccw";
}
// PlatformParams gains: region?: RegionParam
```

- Games read it only through `@emb/game-sdk` types (invariant 6). Absent when the step has no filter (side only).
- **Which row applies.** A sub-lobe → its row. An area → its sub-lobe's row. A lobe → the API picks one of the lobe's
  sub-lobes that has a row, uniformly, from the launch's seed (so the same seed always gives the same pick), and sets
  `drawn: true`. Each offline package has its own seed, so a run of packages covers the lobe's sub-lobes.
- **The row decides the hemisphere the game runs as.** In the table, `bg_temperature` always matches the pattern:
  every cold row has the right side's pattern (target west, clockwise) and every warm row the left side's (east,
  counter-clockwise), the crossed cerebellum included. So when a row applies, the launch's `hemisphere` platform
  parameter = `right` for a cold row and `left` for a warm row. Everything a game ties to the hemisphere (palette,
  placement lean, timer corner, tile style, rewards: ADR 0008–0012) then follows the row. A test checks the table
  keeps this property (cold ⇔ west-side targets ⇔ CW; warm ⇔ east-side targets ⇔ CCW), so a correction that breaks
  it is caught and brought back to the product owner instead of shipping a contradictory row.
- A game declares what it uses in its manifest: `regionUse?: { background?: true; direction?: true;
  targetLocation?: true; rotation?: true; movement?: true }`. The protocol builder reads it to say what the filter
  changes for that game.
- Choosing among listed options is the game's job, using the session seed, so a replay is identical. The game records
  each choice it made (in `config_echo` for once-per-session choices, in trial events for per-round ones).

### 5. Existing games

- All games: they receive the hemisphere decided in §4 (the side for side-only steps; the row's for the rest), so
  everything ADR 0008–0012 ties to the hemisphere works as now, driven by the table.
- Catch Me If You Can (the only game with background settings today) declares `regionUse.background`. With a filter:
  `bg_temperature` comes from the row instead of the step's own setting; the background type is drawn once per
  session from `bg_types` with the seed (matching ADR 0009's once-per-session colour draw). Its `bg_motion` setting
  is unchanged. In the builder, the background colour and type controls show the filter's values, read-only, with a
  note.
- Other games declare nothing beyond the side. Direction, target location, rotation and movement are first used by
  the picture-line game.

### 6. Launch, results, tickets, offline

- The API resolves `region_id` → sub-lobe → `region_setting` at the moment it builds the launch parameters (online
  launch, offline bundle package, home program package) and puts `region` into them.
- `region` is a structural parameter for v2 tickets: signed exactly, like `hemisphere`. An offline package keeps the
  settings it was issued with, even if the table is corrected later.
- **Corrections apply to everyone (our call).** Steps store only `region_id`; every new launch uses the table's current
  revision, so an advisor's correction reaches every protocol and patient without therapist action. The progress page
  shows the revision each session ran with.
- **A correction is not a step change (our call).** The offline "step changed" check (`stepChanged` in the sessions
  module) compares the step's `region_id` and hemisphere, not the resolved settings, `revision` or `clinical_status`.
  Results from packages issued before a correction are accepted normally; their `region` snapshot shows the revision
  they ran with.
- `game_session.hemisphere` stores the hemisphere the game ran as (§4), so progress baselines (per game × difficulty
  × hemisphere × black-and-white) group sessions by what the child actually saw. For a left-cerebellum step that is
  `right`.
- The offline "step changed" check compares the step's `region_id` and its stored side, never the per-launch
  hemisphere or the drawn sub-lobe, which legitimately vary between packages of the same step.
- `game_session` gains `region_id` (nullable) and `region` (jsonb snapshot of the parameter as launched). Ingest
  stores what the device reports in `config_echo`; a result whose `region` differs from its ticket's is kept and
  flagged `params_outside_ticket`, as today. Never dropped (invariant 8).
- Progress pages show the filter's label next to each session.

### 7. Protocol builder

On a game step, after the game is chosen, a **Brain region** control replaces the Hemisphere control:

```
Brain region   (•) By region        Side [Right ▾]  Lobe [Temporal ▾]  Sub-lobe [Superior temporal ▾]
               ( ) By Brodmann area Side [Right ▾]  Area [BA22 — superior temporal ▾]
               ─────────────────────────────────────────────
               This game uses: hemisphere (right), background (cold; solid)
               Draft settings, pending clinical review
```

- Side is required (it replaces the Hemisphere control). Lobe and sub-lobe are optional: "Any" stops the filter at
  that level. Side only = today's behaviour.
- Lobe with sub-lobe "Any": the summary says "Each session uses one of: DLPFC, orbital frontal" and lists what can
  vary. Lobes with no rows yet (occipital, limbic, insula) are not offered for games.
- When the row's hemisphere differs from the side (the cerebellum), the summary says so: "Runs with the right
  hemisphere's look and placement, as the table sets for the left cerebellum." 
- The Brodmann list shows each area with its sub-lobe; areas with no sub-lobe appear disabled ("no settings yet").
- The summary lists only what the chosen game uses (from `regionUse`), in the therapist's language.
- The same control appears wherever a patient's step is edited.
- English and Hebrew ICU messages; logical CSS properties; region and direction names are labels, not mirrored
  (directions are physical: "left to right" means the same in both languages).

### 8. Videos

- The admin tagging picker (`RegionPicker`) offers sub-lobes as well as Brodmann areas, and hides retired nodes.
- The library filter gains the sub-lobe level and a Brodmann-area choice. Matching:
  - a sub-lobe matches videos tagged with it or with any Brodmann area linked to it;
  - a Brodmann area matches videos tagged with it or with its sub-lobe;
  - a side or lobe matches everything under it, as today.

### 9. Demo and docs

- The demo build's fake API serves the region list and settings so the builder control works in the demo artifact.
- ADR 0020 records the decisions. The design doc's §7 (`brain_region`, new `region_setting`) and §8.2 (new `region`
  platform parameter) are updated to match after approval.

## Constraints (from the project rules)

- Expand/contract migrations only; RLS ENABLE + FORCE with policies in the same migration; `SET LOCAL app.user_id` via
  `withUser`.
- No patient data in the table, logs or fixtures; the sheet is clinical configuration, not patient data.
- Games import only `@emb/game-sdk`; Session Rules still own time and lives.
- i18n: English and Hebrew; RTL with logical properties; the game timer side and the line direction are physical.

## Left to the builder

- Exact component structure of the builder control, the trigger vs check implementation for allowed `region_id` nodes,
  migration numbering, the generator's code shape, test layout.
- How the progress page shows the region label.

## Open (clinical advisor; do not block the build)

- The Brodmann → sub-lobe mapping (draft), the unmapped areas, the two possible typos, the crossed cerebellum. All
  rows load as `clinical_status = draft`; corrections ship as migrations.
