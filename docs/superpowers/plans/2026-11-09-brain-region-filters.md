# Brain-Region Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A therapist gives each game step one brain-region filter (side / lobe / sub-lobe, or a Brodmann area); every launch runs the game with the product owner's table row for it, and videos are tagged and filtered with the same regions.

**Architecture:** The region tree in `app.brain_region` gains a `subcortical` lobe, `sublobe` nodes and Brodmann → sub-lobe links; a new `app.region_setting` table holds the sheet's 20 rows. One pure module in `@emb/contracts` resolves a step's region into a `RegionParam` plus the hemisphere the game runs as; the API calls it when it builds launch parameters (online, offline bundle), and the builder and demo use it for the summary.

**Tech Stack:** Postgres 16 (RLS), Hono API, zod contracts, React + TanStack Query web app, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-09-brain-region-filters-design.md` (approved 2026-11-09). Source sheet: `docs/superpowers/specs/2026-11-09-brain-region-settings.csv`.

## Global Constraints

- Expand/contract only; every new table in schema `app` gets `ENABLE` + `FORCE ROW LEVEL SECURITY` and policies in the same migration (`packages/db/test/rls.test.ts`).
- Requests run under `SET LOCAL app.user_id` via `withUser`/`run`; never trust a client clinic id.
- Games import only `@emb/game-sdk`; Session Rules own time and lives.
- Never drop a result; v2 tickets sign structural params exactly.
- No brain-region wording on the child's screen; region names only in therapist/admin screens. Wording: "game-based activities".
- English and Hebrew ICU messages for every new string; CSS logical properties; directions are physical (not mirrored).
- The table is the absolute truth whenever a lobe, sub-lobe or Brodmann area is chosen; side only = today's behaviour.
- Cold row ⇒ the game runs as hemisphere `right`; warm row ⇒ `left`.
- Lobe with no sub-lobe chosen ⇒ one of the lobe's sub-lobes with a row, picked from the launch seed, `drawn: true`.
- Settings rows load with `clinical_status = 'draft'`, `revision = 1`.
- Commits: `GIT_COMMITTER_NAME=Claude GIT_COMMITTER_EMAIL=noreply@anthropic.com git -c user.name=Barak -c user.email=barak@metgo.app commit`, trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_012v2MKdS2a28sz4kKkipj47`; push to main.
- DB for tests: `DATABASE_URL=postgres://postgres:spike@localhost:55432/postgres` (start Postgres with the `pg_ctl … -p 55432` command if it is down).

## Plan rulings (deviations from the spec's wording, same behaviour)

- **R1 — Snapshot in `config_echo`, no new `game_session` columns.** Ingest already stores the full launch params in `game_session.config_echo`, which will contain `region`; `game_session.hemisphere` already stores the launch's hemisphere. So the spec's `region_id`/`region` columns would duplicate it and force a rewrite of the definer function `app.ingest_game_session`. Progress reads `config_echo->'region'`. Cost if wrong: a later migration adds a column backfilled from `config_echo`.
- **R2 — Background choice is made by the API, not the game.** For games whose manifest declares `regionUse.background = { temperature: "<param>", type: "<param>" }`, `buildParams` overwrites those namespaced params from the row (type picked with the seed when two are listed). The ticket then signs the exact choice, and Catch Me needs no code change. The spec's "the game picks with the seed" still holds for per-round choices (direction, target location) in project 2. Cost if wrong: none for players; move the pick into the game later.
- **R3 — Older clients don't wipe a filter.** `region_id` is optional in the step input. On `PUT /templates/:id`, an omitted `region_id` keeps the region of the old step with the same ordinal and game id; `null` clears it.

## Review Focus

1. A stale (cached) web app saves a template without `region_id` → the filter is kept (Task 4 test `keeps a step's region when an older app omits region_id`).
2. A lobe whose sub-lobes span warm and cold (right subcortical: pons/mesencephalon cold, cerebellum warm) → each launch's hemisphere and timer corner follow the drawn row, and an offline result is never flagged `step_changed` just because two packages drew differently (Task 5 tests `lobe draw sets hemisphere from the drawn row` and `a lobe draw is not a step change`).
3. A request names a retired node (old `left.cerebellum.cerebellum`), a Brodmann area with no sub-lobe (BA44), a lobe with no rows (occipital) or a region whose side differs from `hemisphere` → 400 with a specific error, nothing written (Task 4 test `rejects regions a game can't use`).
4. A step with a filter on a game that has background settings but is in black and white → params still carry the row's background; the game's existing rule (black and white wins) decides the look (Task 5 test `background params follow the row`).
5. The builder in Hebrew: region labels in Hebrew, direction names not mirrored, layout with logical properties (Task 7 test `shows the filter summary in Hebrew`).

---

### Task 1: Shared region logic in `@emb/contracts`

**Files:**
- Create: `packages/contracts/src/regions.ts`
- Modify: `packages/contracts/src/videos.ts` (`RegionRef`, `BrainRegion`), `packages/contracts/src/index.ts` (export)
- Test: `packages/contracts/test/regions.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Direction = "ltr" | "rtl" | "ttb" | "btt" | "tldbr" | "brdtl" | "trdbl" | "bldtr";
  export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
  export interface RegionSettingView {
    bg_temperature: "warm" | "cold"; bg_types: ("solid" | "textured")[];
    motion: { movement_types: number[]; directions: Direction[] }[];
    target_locations: Compass[]; rotation: "cw" | "ccw";
    clinical_status: "draft" | "approved"; revision: number;
  }
  export interface RegionParam extends RegionSettingView { path: string; sublobe: string; drawn: boolean }
  // videos.ts: RegionRef.kind gains "sublobe"; BrainRegion gains sublobe_id: string | null; setting: RegionSettingView | null
  export interface RegionCatalog { byId: Map<string, BrainRegion>; byPath: Map<string, BrainRegion>; children: Map<string, BrainRegion[]> }
  export function regionCatalog(regions: BrainRegion[]): RegionCatalog;
  export function hemisphereForSetting(s: Pick<RegionSettingView, "bg_temperature">): "left" | "right"; // cold → right
  export function sideOf(r: Pick<BrainRegion, "path">): "left" | "right";               // first path segment
  export function gameRegionError(cat: RegionCatalog, id: string): null | "unknown" | "not_for_games";
  export function resolveRegion(cat: RegionCatalog, id: string, seed: number): { param: RegionParam; hemisphere: "left" | "right" } | null;
  export function seededIndex(seed: number, salt: string, n: number): number;          // 0 ≤ i < n, deterministic
  export function tableConsistencyErrors(rows: Array<{ path: string } & RegionSettingView>): string[];
  ```

- [ ] **Step 1: Write the failing tests** in `packages/contracts/test/regions.test.ts` with a small hand-built catalog (right.frontal with `dlpfc` cold/textured and `orbitofrontal` cold/solid; right.subcortical with `pons` cold and `cerebellum` warm; area `right.frontal.ba46` → dlpfc; area `right.frontal.ba44` with no sub-lobe; lobe `right.occipital` with no sub-lobes; a node with `retired_at`-style absence is simply not in the catalog):
  - `resolves a sub-lobe to its row` → `param.sublobe === "right.frontal.dlpfc"`, `drawn === false`, `hemisphere === "right"`.
  - `resolves a Brodmann area to its sub-lobe's row` → `path === "right.frontal.ba46"`, `sublobe === "right.frontal.dlpfc"`.
  - `a lobe draws one of its sub-lobes from the seed` → `drawn === true`; same seed ⇒ same sublobe; over seeds 1..200 both `dlpfc` and `orbitofrontal` appear.
  - `a warm row runs as the left hemisphere` → resolving `right.subcortical` with a seed that draws `cerebellum` gives `hemisphere === "left"`.
  - `gameRegionError` → `"not_for_games"` for `ba44`, `right.occipital` and a hemisphere node; `"unknown"` for a random uuid; `null` for dlpfc, ba46, right.frontal.
  - `seededIndex stays in range and is deterministic` (n = 1, 2, 7).
  - `tableConsistencyErrors` → `[]` for a cold/W/CW and a warm/E/CCW row; one error naming the path for a cold row with target `E` or rotation `ccw`. Rule: cold ⇔ every target in {N, S, W, SW, NW} and rotation cw; warm ⇔ every target in {N, S, E, SE, NE} and rotation ccw.
- [ ] **Step 2: Run** `pnpm --filter @emb/contracts test -- regions` → FAIL (module missing).
- [ ] **Step 3: Implement** `regions.ts` and the `videos.ts` type changes. `seededIndex`: FNV-1a 32-bit hash of `salt`, xor `seed`, one mulberry32 step, `Math.floor(x * n)`. Lobe draw salt: the lobe's path.
- [ ] **Step 4: Run** the test and `pnpm --filter @emb/contracts typecheck` → PASS.
- [ ] **Step 5: Commit** `contracts: shared brain-region resolution (spec 2026-11-09)`.

### Task 2: Region data in `@emb/db` (tree additions and the sheet)

**Files:**
- Modify: `packages/db/src/brain-regions.ts`
- Create: `packages/db/src/region-settings.ts`; move `docs/superpowers/specs/2026-11-09-brain-region-settings.csv` → `packages/db/src/region-settings.csv` (leave a one-line note in the spec pointing to the new path)
- Modify: `packages/db/package.json` exports (`"./region-settings": "./src/region-settings.ts"`)
- Test: `packages/db/test/region-data.test.ts`

**Interfaces:**
- Consumes: `RegionSettingView`, `Direction`, `Compass`, `tableConsistencyErrors` (Task 1).
- Produces:
  ```ts
  // brain-regions.ts (existing exports unchanged; regionSeedSql stays frozen for 0010)
  export const SUBCORTICAL: Named;                                  // { code: "subcortical", en: "Subcortical", he: "תת-קליפתי" }
  export const SUBLOBES: Array<Named & { lobe: string }>;          // 10 entries, codes/labels below
  export const AREA_SUBLOBE: Record<string, string>;               // "ba9" → "dlpfc", …
  export function regionExpandSql(): string;                       // INSERTs/UPDATEs for migration 0018 (§Task 3)
  // region-settings.ts
  export interface SettingRow extends Omit<RegionSettingView, "clinical_status" | "revision"> { side: "left" | "right"; lobe: string; sublobe: string }
  export const REGION_SETTINGS: SettingRow[];                      // 20 rows, typed, from the CSV
  export function parseSettingsCsv(text: string): SettingRow[];
  export function settingSeedSql(rows: SettingRow[]): string;
  ```
- Sub-lobes (code · lobe · en · he — Hebrew is a draft for clinical review):
  `dlpfc` · frontal · "DLPFC (dorsolateral prefrontal)" · "DLPFC (קדם-מצחי גבי-צדי)";
  `orbitofrontal` · frontal · "Orbitofrontal" · "אורביטו-פרונטלי";
  `parietal_main` · parietal · "Parietal" · "קודקודי";
  `superior_parietal` · parietal · "Superior parietal" · "קודקודי עליון";
  `superior_temporal` · temporal · "Superior temporal" · "רקתי עליון";
  `middle_temporal` · temporal · "Middle temporal" · "רקתי אמצעי";
  `inferior_temporal` · temporal · "Inferior temporal" · "רקתי תחתון";
  `pons` · subcortical · "Pons" · "גשר המוח (פונס)";
  `mesencephalon` · subcortical · "Mesencephalon (midbrain)" · "המוח התיכון";
  `cerebellum` · subcortical · "Cerebellum" · "המוח הקטן".
- `AREA_SUBLOBE`: ba9, ba46 → dlpfc; ba11, ba12, ba47 → orbitofrontal; ba1, ba2, ba3, ba39, ba40, ba43 → parietal_main; ba5, ba7 → superior_parietal; ba22, ba41, ba42 → superior_temporal; ba21 → middle_temporal; ba20, ba37 → inferior_temporal.
- CSV → row: sheet names map `Cerebelum`→cerebellum, `DLPFC`→dlpfc, `Orbital frontal`→orbitofrontal, `Parietal`→parietal_main, `Superior Parietal`→superior_parietal, `Superior/Middle/inferior Temporal`→…_temporal, `Pons`, `Mesencephalon`; `Cold`/`warm` lower-cased; `textured, solid` → `["textured","solid"]`; each CSV line of a sub-lobe = one `motion` entry (e.g. right DLPFC → `[{movement_types:[0,3],directions:["ltr","tldbr"]},{movement_types:[1],directions:["rtl","brdtl"]}]`); duplicates kept as given ("LTR, LTR" → `["ltr","ltr"]`); `CW`/`CCW` lower-cased.

- [ ] **Step 1: Write the failing tests**:
  - `REGION_SETTINGS matches the committed CSV` → `expect(REGION_SETTINGS).toEqual(parseSettingsCsv(readFileSync(csvPath, "utf8")))`.
  - `has 20 rows, one per side × sub-lobe` and every row's sub-lobe is in `SUBLOBES` under the row's lobe.
  - `right DLPFC has two motion entries` with the exact values above; `left cerebellum is cold, cw, targets W SW NW N S`.
  - `the table keeps the cold/warm pattern` → `tableConsistencyErrors(REGION_SETTINGS.map(withPath)) === []`.
  - `every Brodmann link stays inside its lobe` → for each `AREA_SUBLOBE` entry, the area's lobe in `AREAS` equals the sub-lobe's lobe.
  - `every sub-lobe has English and Hebrew labels`.
- [ ] **Step 2: Run** `pnpm --filter @emb/db exec vitest run test/region-data.test.ts` → FAIL.
- [ ] **Step 3: Implement** the two modules. `regionExpandSql()` emits, per hemisphere: the `subcortical` lobe (sort 8), each sub-lobe (`kind 'sublobe'`, path `<side>.<lobe>.<code>`, sort after the lobe's areas), and `UPDATE app.brain_region SET sublobe_id = … WHERE path = '<side>.<lobe>.<ba>'`.
- [ ] **Step 4: Run** the test → PASS; `pnpm --filter @emb/db typecheck` clean.
- [ ] **Step 5: Commit** `db: brain-region sub-lobes and the settings sheet as data`.

### Task 3: Migration 0018 — tree, settings table, step filters

**Files:**
- Create: `packages/db/migrations/0018_brain_region_filters.sql`
- Test: `packages/db/test/regions.test.ts`

**Interfaces:**
- Consumes: `regionExpandSql()`, `settingSeedSql(REGION_SETTINGS)` (Task 2) — pasted into the migration; the test regenerates and compares.
- Produces (schema):
  - `app.brain_region`: kind check allows `'sublobe'`; new `sublobe_id uuid NULL REFERENCES app.brain_region(id)`; new `retired_at timestamptz NULL`; trigger `brain_region_sublobe_ck` (an area's `sublobe_id` must be a sub-lobe with the same first two path segments; only areas may have one).
  - `app.region_setting (sublobe_id uuid PRIMARY KEY REFERENCES app.brain_region(id), bg_temperature text CHECK IN ('warm','cold'), bg_types text[] NOT NULL CHECK (cardinality ≥ 1 AND ⊆ {solid,textured}), motion jsonb NOT NULL CHECK (jsonb_typeof = 'array' AND jsonb_array_length ≥ 1), target_locations text[] NOT NULL CHECK (cardinality ≥ 1 AND ⊆ compass), rotation text CHECK IN ('cw','ccw'), clinical_status text NOT NULL DEFAULT 'draft' CHECK IN ('draft','approved'), revision integer NOT NULL DEFAULT 1 CHECK (revision ≥ 1), updated_at timestamptz NOT NULL DEFAULT now())`; RLS ENABLE + FORCE; `rsetting_read` FOR SELECT USING (`app.current_user_id() IS NOT NULL`); `rsetting_write` FOR ALL USING/WITH CHECK (`app.is_platform_admin()`); `GRANT SELECT, INSERT, UPDATE, DELETE … TO emb_app`.
  - Cerebellum move: `INSERT INTO app.video_region (video_id, region_id) SELECT vr.video_id, new.id … ON CONFLICT DO NOTHING` from `<side>.cerebellum` and `<side>.cerebellum.cerebellum` to `<side>.subcortical.cerebellum`; then `DELETE` those old `video_region` rows; then `UPDATE … SET retired_at = now()` on the old lobe and leaf (not deleted: contract later).
  - `template_step.region_id` and `assignment_step.region_id` (`uuid NULL REFERENCES app.brain_region(id)`); trigger function `app.check_step_region()` (SECURITY DEFINER, owner `emb_rls_helper` like 0013's helpers) on INSERT/UPDATE of both tables. A non-null `region_id` must belong to a game step, must not be retired, and must be either: a sub-lobe with a `region_setting`; an area whose `sublobe_id` has one; or a lobe with at least one such sub-lobe. Its first path segment must equal `hemisphere`. Errors: `step_region_invalid`, `step_region_side` (ERRCODE 23514).

- [ ] **Step 1: Write the failing tests** (`packages/db/test/regions.test.ts`, using `helpers.ts` as the other db tests do):
  - `the migration seeds what the data module generates` (sub-lobe count 20, settings count 20, `sublobe_id` set on the 19 linked areas × 2 sides).
  - `sub-lobes sit under their lobe and areas link inside their lobe` (trigger rejects linking `left.frontal.ba9` to `left.temporal.superior_temporal`).
  - `old cerebellum tags move to the subcortical cerebellum` (a video tagged on `left.cerebellum.cerebellum` before 0018 is tagged on `left.subcortical.cerebellum` after; build the before-state by running migrations up to 0017 in a fresh schema, as `offline.test.ts` does, or by inserting the tag and re-running 0018's move statements — implementer's choice).
  - `region_setting is read-only for therapists` (as `emb_app` with a therapist's `app.user_id`: SELECT works, UPDATE affects 0 rows / raises).
  - `a game step accepts a sub-lobe, an area with a sub-lobe and a lobe with rows`; `rejects BA44, right.occipital, a retired node, a video step with a region, and a side mismatch` with the error names above.
- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter @emb/db test -- regions` → FAIL.
- [ ] **Step 3: Write the migration.** Expand-only: no column dropped, no row deleted except the moved `video_region` duplicates.
- [ ] **Step 4: Run** the whole db suite (`rls.test.ts` included) → PASS.
- [ ] **Step 5: Commit** `db: migration 0018 brain-region filters (sub-lobes, settings table, step region)` — the commit message notes the migration needs a human-reviewed diff before deploy (CLAUDE.md).

### Task 4: API — region list and protocol steps

**Files:**
- Create: `apps/api/src/regions.ts` (`loadRegionCatalog(db): Promise<RegionCatalog>`)
- Modify: `apps/api/src/modules/videos/routes.ts` (`GET /brain-regions`), `apps/api/src/modules/protocols/routes.ts`, `packages/contracts/src/protocols.ts`
- Test: `apps/api/test/regions-api.test.ts`, `apps/api/test/protocols-api.test.ts`, `packages/contracts/test/protocols.test.ts`

**Interfaces:**
- Consumes: Task 1 (`regionCatalog`, `gameRegionError`, `sideOf`), Task 3 schema.
- Produces:
  - `GET /v1/brain-regions` → `{ regions: BrainRegion[] }`, retired nodes left out, each sub-lobe with `setting`, each area with `sublobe_id`.
  - `gameStepInput.region_id: z.string().uuid().nullable().optional()`; `STEP_COLUMNS` gains `region_id`; step views return `region_id`.
  - 400 errors `{ error: "invalid", issues: [{ path: "steps.<i>.region_id", code: "region_not_for_games" | "region_side" }] }`.

- [ ] **Step 1: Write the failing tests**:
  - `brain-regions lists sub-lobes with settings and hides retired nodes` (no path `left.cerebellum`; `right.temporal.superior_temporal.setting.bg_temperature === "cold"`).
  - `a template step saves and returns its region` (sub-lobe, then a Brodmann area, then a lobe).
  - `rejects regions a game can't use` → BA44, `right.occipital`, the retired cerebellum leaf's id, `region_side` when `hemisphere: "left"` with a right region; nothing written.
  - `keeps a step's region when an older app omits region_id` (PUT without the key keeps it; PUT with `region_id: null` clears it).
  - `assigning a template copies region_id to assignment steps`.
  - contracts: `region_id may be omitted, null or a uuid`.
- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter @emb/api test -- regions-api protocols-api` → FAIL.
- [ ] **Step 3: Implement.** Validate with the catalog before writing (clear 400s); the Task 3 trigger is the backstop. Carry-over on PUT per R3.
- [ ] **Step 4: Run** the api suite → PASS.
- [ ] **Step 5: Commit** `api: brain-region filter on game steps`.

### Task 5: Launch — params, hemisphere, background, tickets

**Files:**
- Modify: `packages/game-sdk/src/index.ts`, `games/catch-me-if-you-can/src/manifest.ts`, `apps/api/src/modules/sessions/routes.ts`, `apps/api/src/modules/offline/routes.ts`, `packages/contracts/src/sessions.ts`
- Test: `apps/api/test/sessions-api.test.ts`, `apps/api/test/offline-ingest-api.test.ts`, `apps/api/test/offline-bundle-api.test.ts`

**Interfaces:**
- Consumes: `resolveRegion`, `RegionParam` (Task 1), `loadRegionCatalog` (Task 4).
- Produces:
  - SDK: `PlatformParams.region?: RegionParam` (re-declared in the SDK as a structural type, not imported: games import only the SDK); `GameManifest.regionUse?: { background?: { temperature: string; type: string }; direction?: true; targetLocation?: true; rotation?: true; movement?: true }`.
  - Catch Me manifest: `regionUse: { background: { temperature: "bg_temperature", type: "background" } }`.
  - `StepRow.region_id: string | null`; `buildParams(step, patient, seed, regions: RegionCatalog)`. With a region it sets `region`, `hemisphere` = resolved hemisphere, `timer_position = timerPositionFor(hemisphere, shown)`, and per R2 the background params (`"<ns>.bg_temperature"` = row temperature; `"<ns>.background"` = `bg_types[seededIndex(seed, "bg", n)]`).
  - `STRUCTURAL` gains `"region"`. `stepChanged`, for a step with a region, compares `region.path` and the step's stored side (`hemisphere` column) against the ticket's `exact.region.path`, plus timer shown/hidden. It skips `hemisphere`, `timer_position`, the rest of `region`, and the region-driven background params. Steps without a region behave exactly as today.
  - `GameSessionView.region: { path: string; sublobe: string; drawn: boolean; revision: number } | null`, from `config_echo->'region'` (R1).
- [ ] **Step 1: Write the failing tests**:
  - `launch params carry the row for a sub-lobe step` (superior temporal: `region.bg_temperature === "cold"`, `hemisphere === "right"`).
  - `left cerebellum runs as the right hemisphere` (`hemisphere === "right"`, timer corner = `timerPositionFor("right", true)`).
  - `lobe draw sets hemisphere from the drawn row` (right subcortical over many launches: whenever `region.sublobe` ends in `.cerebellum`, `hemisphere === "left"`, else `"right"`).
  - `background params follow the row` (Catch Me step with own `bg_temperature: "warm"` and region right DLPFC → `catch_me_if_you_can.bg_temperature === "cold"`, `background === "textured"`; also with `monochrome: true`).
  - `a step without a region launches exactly as before` (snapshot of params keys/values equals the pre-change shape for the same seed).
  - offline: `the bundle's package params include region and the ticket signs it`; `a lobe draw is not a step change` (two packages with different draws both ingest `accepted`); `changing the step's region after issue is a step change`; `a table correction (revision bump) is not a step change`.
  - `progress shows the region a session ran with` (GameSessionView.region from config_echo).
- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter @emb/api test -- sessions-api offline` → FAIL.
- [ ] **Step 3: Implement**: load the catalog once per request (launch route, bundle route, ingest's `stepChanged`), select `s.region_id` in `loadLaunchRows`. `app.ticket_step` already returns `SELECT *`.
- [ ] **Step 4: Run** the api suite and `pnpm --filter catch-me-if-you-can test` (or the game's package name) → PASS.
- [ ] **Step 5: Commit** `api: launches run with the brain-region row (hemisphere, background, region param)`.

### Task 6: Videos — tags and filters with sub-lobes

**Files:**
- Modify: `apps/api/src/modules/videos/routes.ts` (`GET /videos` region match), `apps/web/src/routes/admin/RegionPicker.tsx`
- Test: `apps/api/test/videos-api.test.ts`, `apps/web/test/region-picker.test.tsx` (new)

**Interfaces:**
- Consumes: `BrainRegion.kind "sublobe"`, `sublobe_id` (Tasks 1, 4).
- Produces: region filter `?region=<id>` matches a tagged node `t` when `t.path = f.path OR t.path LIKE f.path || '.%' OR t.sublobe_id = f.id OR t.id = f.sublobe_id`. `useRegionTree` exposes sub-lobes per lobe; `RegionPicker` (tagging) and `RegionFilter` (library) offer Side → Lobe → Sub-lobe or Brodmann area.
- [ ] **Step 1: Write the failing tests**:
  - api: `a sub-lobe filter finds videos tagged with its Brodmann areas`, `a Brodmann filter finds videos tagged with its sub-lobe`, `admins can tag a sub-lobe`, `a lobe filter still finds everything under it`.
  - web: `the tagging picker offers sub-lobes under a lobe and hides retired nodes` (render with a fixture region list).
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** api + web suites → PASS.
- [ ] **Step 5: Commit** `videos: tag and filter by sub-lobe; Brodmann ↔ sub-lobe matching`.

### Task 7: Protocol builder, progress label, demo

**Files:**
- Create: `apps/web/src/routes/protocols/StepRegion.tsx`
- Modify: `apps/web/src/routes/protocols/steps.tsx` (replace the Hemisphere radio group with `StepRegion`; step summary line), `apps/web/src/routes/patients/progress.tsx` (region label per session), `apps/web/src/i18n/messages/en.*`, `he.*`, `apps/web/src/demo/fake-api.ts` (serve sub-lobes + settings from `@emb/db/brain-regions` and `@emb/db/region-settings`; resolve `region` in demo launches with `resolveRegion`)
- Test: `apps/web/test/step-region.test.tsx` (new), `apps/web/test/progress.test.tsx`

**Interfaces:**
- Consumes: `useBrainRegions`, `regionCatalog`, `resolveRegion`, `gameRegionError`, `hemisphereForSetting`, manifest `regionUse`, `hemisphereNote`.
- Produces: `StepRegion({ step, manifest, onChange })`. It sets `region_id` and `hemisphere` together (side = hemisphere; timer corner via `timerPositionFor`).
- UI behaviour (spec §7):
  - Two modes: By region (Side required; Lobe and Sub-lobe each with "Any") and By Brodmann area (Side; areas with no sub-lobe disabled, labelled "no settings yet").
  - Lobes with no rows are not offered.
  - The summary lists only what the game uses: the hemisphere it runs as, the background when `regionUse.background`, direction/target/rotation when declared.
  - For a lobe: "Each session uses one of: …".
  - A crossed note when the row's hemisphere ≠ side.
  - "Draft settings, pending clinical review" while any applicable row is `draft`.
  - With a region on a game with `regionUse.background`, the game's own background colour/type controls render read-only with the row's values.
- ICU keys (en/he): `stepRegion.legend`, `.byRegion`, `.byArea`, `.side`, `.lobe`, `.sublobe`, `.area`, `.any`, `.noSettings`, `.uses`, `.eachSession`, `.crossed`, `.draft`, `.lockedByRegion`, `progress.region`.
- [ ] **Step 1: Write the failing tests**:
  - `choosing a sub-lobe sets region_id and hemisphere together`.
  - `the summary lists only what the game uses` (Catch Me shows background; Peek Peek shows only the hemisphere).
  - `left cerebellum shows the crossed note`.
  - `a lobe choice says each session uses one of its sub-lobes`.
  - `Brodmann areas without a sub-lobe are disabled`.
  - `background controls are read-only under a region`.
  - `shows the filter summary in Hebrew` (`he` locale: Hebrew labels; `dir="rtl"` container; no physical `margin-left/right` in the component's CSS — grep assertion as other UI tests do, or a style check).
  - progress: `each session shows its region label` (from `GameSessionView.region` + region list).
- [ ] **Step 2: Run** `pnpm --filter @emb/web test -- step-region progress` → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the web suite and `pnpm typecheck` → PASS. Build the demo (`pnpm --filter @emb/web build:demo` or the repo's demo build script) and check that the builder control works in it.
- [ ] **Step 5: Commit** `web: brain-region filter in the protocol builder, progress label, demo`.

### Task 8: End to end, docs, ADR

**Files:**
- Modify: `apps/web/e2e/protocols.spec.ts` (and `sessions.spec.ts` if launch is checked there)
- Create: `docs/adr/0020-brain-region-filters.md`
- Modify: the design doc in Claude Docs (project `2ba06663-e5d5-402c-83e4-a7d5f217d8b5`): §7 `brain_region` (sub-lobes, `sublobe_id`, `retired_at`), new `region_setting`, §8.2 `region` platform parameter
- Test: e2e

- [ ] **Step 1: Write the failing e2e**: `a therapist builds a step filtered to right superior temporal, and its session launches with that row`. The test opens the builder, picks Catch Me, chooses By region → Right → Temporal → Superior temporal, sees "cold" in the summary and saves. It assigns the protocol to a synthetic patient, starts the session, and asserts the launch request's params contain `region.sublobe === "right.temporal.superior_temporal"` and `hemisphere === "right"`.
- [ ] **Step 2: Run** `cd apps/web && npx playwright test e2e/protocols.spec.ts` → FAIL before the UI is wired, PASS after (if Tasks 1–7 are done it passes at once: then confirm it fails with the `StepRegion` import removed, and restore).
- [ ] **Step 3: Write ADR 0020.** It records the decisions from the spec, rulings R1–R3, and the clinical items that are still open. Update the design doc sections, following the Docs connector's editing rules.
- [ ] **Step 4: Run** the full verification: `pnpm typecheck`, `DATABASE_URL=… pnpm test`, and the full e2e (`pnpm e2e` in apps/web, in the background, about 10 minutes) → all green.
- [ ] **Step 5: Commit** `Brain-region filters: e2e, ADR 0020, design doc §7/§8.2`, then push to main.
