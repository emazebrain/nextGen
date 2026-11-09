# ADR 0020 — Brain-region filters: one filter per game step, the product owner's table decides

- Status: Accepted
- Date: 2026-11-09
- Design doc: §7 (`brain_region`, new `region_setting`), §8.2 (new `region` platform parameter)
- Spec: `docs/superpowers/specs/2026-11-09-brain-region-filters-design.md` (approved by the product owner)
- Plan: `docs/superpowers/plans/2026-11-09-brain-region-filters.md`
- Builds on: ADR 0009 (backgrounds), ADR 0011 (hemisphere decides the side), ADR 0018 (video library), ADR 0019 (offline)

## Context

The product owner supplied a table that says, for each side → lobe → sub-lobe, how a game should run: background colour
and type, direction, where most objects go, rotation and movement type. A therapist builds a protocol by picking a game,
then one brain-region filter for it, and the game runs with that row in the clinic and at home. Videos are tagged and
filtered with the same regions, and with Brodmann areas, each of which points to one sub-lobe. The table is the
absolute truth whenever a lobe, sub-lobe or Brodmann area is chosen; a side alone keeps today's behaviour. The next
game (picture-line memory) is the first to use direction and target location.

## Decisions

**Regions.** `app.brain_region` gains a `subcortical` lobe, `sublobe` nodes (the table's ten sub-lobes per side) and
`sublobe_id` on Brodmann areas (a draft mapping, pending the clinical advisor). The old `cerebellum` lobe and leaf are
retired (`retired_at`) and their video tags moved to `subcortical.cerebellum`; a later contract migration deletes them.
Areas with no sub-lobe stay video tags and filters only.

**The table in the database** (`app.region_setting`, one row per sub-lobe, seeded from `packages/db/src/region-settings.csv`
through `region-settings.ts`; `clinical_status = draft`, `revision = 1`). Corrections are reviewed migrations that bump
`revision`; an editing screen with versions can come later. Read by every signed-in user, written by platform admins.

**One filter per game step** (`template_step.region_id`, `assignment_step.region_id`): a lobe with at least one row, a
sub-lobe with a row, or a Brodmann area linked to one. Its side must equal the step's `hemisphere` column, which keeps
meaning "the side chosen". A trigger backs up the API's checks. An older app that leaves `region_id` out keeps the
region of the step at the same position with the same game.

**Resolution** (`@emb/contracts` `resolveRegion`, pure, shared by the API, the builder and the demo). A sub-lobe or area
uses its sub-lobe's row; a lobe draws one of its sub-lobes from the launch seed (`drawn: true`). The row's colour decides
the hemisphere the game runs as: cold → right, warm → left. The table keeps this pattern (cold ⇔ west targets ⇔
clockwise; warm ⇔ east ⇔ counter-clockwise), which a test checks, so the crossed cerebellum (left cerebellum cold)
runs fully with the right hemisphere's look, placement and timer corner.

**Launch.** `buildParams` adds `region` (the row plus `path`, `sublobe`, `drawn`) and sets `hemisphere` and the timer
corner from the row. Games that declare `regionUse.background` in their manifest (Catch Me If You Can) get their own
background parameters from the row; when the row lists two types the host picks one with the seed, so the ticket signs
the exact choice. `region` is structural for offline tickets. The "step changed" check compares the step's chosen filter
and timer shown/hidden, not what the filter resolved to, so a lobe draw or a table correction is never a step change.
Results keep the full parameters in `config_echo`; progress shows the region from there.

**Builder.** A Brain region control replaces the Hemisphere control: by region (side, lobe, sub-lobe, each optional
below the side) or by Brodmann area (areas with no sub-lobe disabled). It lists only what the chosen game uses, says when
a lobe draws per session, when a row is crossed, and that the rows are draft. Background controls set by the row are
shown as "Set by the brain region".

**Videos.** Admins tag sub-lobes as well as areas. A sub-lobe filter matches videos tagged with its Brodmann areas, and an
area filter matches videos tagged with its sub-lobe.

## Consequences

- No new `game_session` columns: the region snapshot is in `config_echo`, and `hemisphere` stores what the game ran as,
  so baselines group sessions by what the child saw.
- Baselines stay per game × difficulty × hemisphere × black-and-white; per-region analysis can be added from `config_echo`.
- Open with the clinical advisor: the Brodmann mapping, the unmapped areas, two possible typos in the sheet (right orbital
  frontal "LTR, LTR"; left DLPFC and orbital frontal without a diagonal), and the Hebrew sub-lobe labels.
- Parked: starting from a filter and then seeing the games that suit it.
