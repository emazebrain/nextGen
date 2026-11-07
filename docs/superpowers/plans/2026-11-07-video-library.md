# Video Library and Video Steps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Platform admins add videos (uploaded files or YouTube links) tagged by hemisphere, lobe and Brodmann area; therapists filter the library and add videos as steps in protocols; the session runner plays them and records each view.

**Architecture:** One vertical slice (CLAUDE.md): migration 0010 → contracts → API (`modules/videos`, plus video steps in `protocols` and `sessions`) → web (admin Videos page, step-editor picker, session-runner video step) → seed, demo and tests. Uploaded files sit behind a `FileStore` interface with a local-disk implementation (development, tests and the future local version); an S3 implementation comes with production deployment. This is project 1 of 3 agreed in conversation; device-side caching (project 2) and offline sync of edits (project 3) are out of scope.

**Tech Stack:** Postgres 16 (RLS), Hono, zod (`packages/contracts`), React + TanStack Query, Playwright, Vitest.

**Spec:** eMazeBrain v2 Product & Technical Design Document (Claude Docs, node `174acc90-806b`): §7 data model rows `brain_region` (tree hemisphere → lobe → Brodmann area via `parent_id`), `video`, `video_i18n`, `file_object`, `video_view`; protocol step table: `step_type` `game` / `video`, "exactly one of `game_id` / `video_id` (CHECK)", `session_mode` "required for games"; §9 "Video Service: therapeutic video library (HLS, plus MP4 download for offline)"; journey "Peek Peek → Video → Orbital Order". Conversation decisions (2026-11-07): uploads and YouTube links both allowed; YouTube marked "needs Internet"; local-first storage interface; video steps live inside protocols.

## Global Constraints

- Every new table in schema `app`: `ENABLE` + `FORCE ROW LEVEL SECURITY` and policies in the same migration (`packages/db/test/rls.test.ts`).
- Requests run through `withUser()` (`SET LOCAL ROLE emb_app`, `app.user_id`); the API never authorises by a client-sent clinic id.
- Expand-only migration: new tables, new nullable columns, relaxed constraints; existing rows and older app versions stay valid.
- `video_view` is append-only (update/delete blocked by trigger), like the other clinical records.
- No patient data in logs, file names or storage keys. Storage keys are `videos/<video_id>/<version>-<sha256-prefix>.<ext>`.
- Wording: "videos" and "game-based activities"; never "assessment", "treatment" or "diagnosis".
- UI strings via ICU messages in `apps/web/src/i18n/messages/{en,he}.json`; CSS logical properties only.
- Upload limits: MIME `video/mp4` or `video/webm`; max 1 GiB (`VIDEO_MAX_BYTES = 1_073_741_824`).
- YouTube: store the 11-character id only (`^[A-Za-z0-9_-]{11}$`), play through `https://www.youtube-nocookie.com/embed/<id>?rel=0&modestbranding=1`.
- Brodmann mappings are `[Assumption]` until a clinical advisor signs them off (design doc §8).

## Review Focus

1. A therapist (not a platform admin) tries to create, edit or upload a video → 403, nothing written. (Task 3 test.)
2. An archived or draft video already in a protocol → existing assignments keep playing it; the picker no longer offers it. (Task 4 test.)
3. A session with only video steps, or a video step watched twice after an interruption → the planned session closes once, the view is stored once per `client_view_id`. (Task 4 test.)
4. A browser seeks in an uploaded video (HTTP `Range`) → `206` with the right bytes; a bad range → `416`. (Task 3 test.)
5. A Hebrew-only or English-only title → the list falls back to the other language rather than showing nothing. (Task 3 test.)

---

### Task 1: Migration 0010 — brain regions, videos, video steps, video views

**Files:**
- Create: `packages/db/migrations/0010_video_library.sql`
- Create: `packages/db/src/brain-regions.ts` (the seed list, exported for tests and seed scripts)
- Modify: `packages/db/test/rls.test.ts` (new `describe("video library")` block)

**Interfaces:**
- Produces SQL objects:
  - `app.is_platform_admin() RETURNS boolean` (SECURITY DEFINER, owner `emb_rls_helper`): an active `membership` with role `platform_admin`.
  - `app.brain_region(id uuid pk, parent_id uuid null, kind text check in ('hemisphere','lobe','area'), code text, path text unique, labels jsonb {en,he}, sort smallint)`. `path` examples: `left`, `left.frontal`, `left.frontal.ba44`, `right.cerebellum.cerebellum`. Seeded in the migration from the list in `brain-regions.ts` (copy the generated `INSERT` into the SQL; the TS file is the source the test compares against).
  - `app.file_object(id, storage_key text unique, sha256 bytea, bytes bigint, mime text, created_by, created_at)`.
  - `app.video(id, source text check in ('upload','youtube'), youtube_id text, file_id uuid → file_object, duration_s integer, age_min smallint, age_max smallint, status text check in ('draft','published','archived') default 'draft', version integer default 1, created_by, created_at, updated_at)`; CHECK `(source='youtube') = (youtube_id IS NOT NULL)`; CHECK `source='upload' OR file_id IS NULL`.
  - `app.video_i18n(video_id, locale text check in ('en','he','ar','ru','fr','es','zh'), title text 1–160, description text ≤ 2000, pk (video_id, locale))`.
  - `app.video_region(video_id, region_id → brain_region, pk)`.
  - `template_step` and `assignment_step`: `step_type text NOT NULL DEFAULT 'game' CHECK in ('game','video')`, `video_id uuid REFERENCES app.video(id)`, `game_id` and `session_mode` drop NOT NULL; replace `step_mode_fields` / `astep_mode_fields` with: `(step_type='video' AND video_id IS NOT NULL AND game_id IS NULL AND session_mode IS NULL AND duration_s IS NULL AND lives IS NULL AND NOT lives_auto) OR (step_type='game' AND game_id IS NOT NULL AND video_id IS NULL AND <the 0009 mode rule>)`.
  - `app.video_view(id uuid pk default uuidv7, client_view_id uuid unique, planned_session_id → planned_session, assignment_step_id → assignment_step, patient_id, clinic_id, video_id, video_version integer, started_at timestamptz, ended_at timestamptz, watched_s integer ≥ 0, completed boolean, recorded_by → app_user, created_at)`; append-only trigger; audit trigger.
- RLS:
  - `brain_region`, `file_object`, `video`, `video_i18n`, `video_region`: SELECT for `app.current_user_id() IS NOT NULL`; `video` rows with status ≠ `published` only for `is_platform_admin()`. INSERT/UPDATE/DELETE only `is_platform_admin()`.
  - `video_view`: SELECT `can_see_patient(patient_id)`; INSERT `can_treat_patient(patient_id) AND recorded_by = current_user_id()` and the planned session belongs to that patient.
  - Grants to `emb_app`: SELECT on all; INSERT/UPDATE/DELETE on the content tables; INSERT on `video_view`.

- [ ] **Step 1: Write failing RLS tests** in `rls.test.ts`, seeding a platform admin (own org "eMazeBrain") as superuser:
  - `it("only platform admins write videos")`: therapistA `INSERT INTO app.video` → error code `42501`; admin insert succeeds.
  - `it("staff see published videos only")`: admin inserts one draft and one published; therapistA `SELECT count(*)` = 1; admin = 2.
  - `it("a video step needs exactly one of game and video")`: superuser insert into `template_step` with both `game_id` and `video_id` → check violation `23514`; video step with `session_mode` set → `23514`.
  - `it("video views follow the patient")`: therapistA inserts a view for p1 → ok; therapistB reads → 0 rows; therapistA `UPDATE app.video_view` → error.
  - `it("seeds the Brodmann tree for both hemispheres")`: `SELECT count(*) FROM app.brain_region WHERE kind='area'` equals `2 * AREAS.length` from `brain-regions.ts`; `path` of BA44 left is `left.frontal.ba44`.
- [ ] **Step 2: Run** `DATABASE_URL=postgres://postgres:spike@localhost:55432/postgres pnpm --filter @emb/db test` → the new tests FAIL (relations missing); the generic "every app table has RLS" test still passes.
- [ ] **Step 3: Write `brain-regions.ts`**: `export const LOBES: Array<{code; en; he}>` and `export const AREAS: Array<{code: string /* "ba44" | "cerebellum" */; lobe: string; en: string; he: string}>`. Lobes and areas (the v1 taxonomy, `[Assumption]`):
  - frontal: BA4, 6, 8, 9, 10, 11, 12, 44, 45, 46, 47
  - parietal: BA1, 2, 3, 5, 7, 39, 40, 43
  - temporal: BA20, 21, 22, 37, 38, 41, 42
  - occipital: BA17, 18, 19
  - limbic: BA23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36
  - insula: BA13, 14, 15, 16
  - cerebellum: `cerebellum` (not a Brodmann area)
  - Labels: en "Brodmann area 44 (BA44)", he "אזור ברודמן 44 (BA44)"; lobes en/he (Frontal lobe / האונה המצחית, Parietal lobe / האונה הקודקודית, Temporal lobe / האונה הרקתית, Occipital lobe / האונה העורפית, Limbic lobe / האונה הלימבית, Insula / האינסולה, Cerebellum / המוח הקטן); hemispheres (Left hemisphere / ההמיספרה השמאלית, Right hemisphere / ההמיספרה הימנית).
  - Also export `regionSeedSql(): string` producing the INSERTs; use it once to paste into the migration.
- [ ] **Step 4: Write the migration** as specified above (header comment explains expand-only; `ltree` replaced by a text `path` with a unique index and `text_pattern_ops` index, so no extension is needed in the local version).
- [ ] **Step 5: Run** the db tests → PASS, including existing ones.
- [ ] **Step 6: Commit** `feat(db): video library, Brodmann tree and video steps (0010)`.

### Task 2: Contracts — video types, step union, video view

**Files:**
- Create: `packages/contracts/src/videos.ts`; export from `packages/contracts/src/index.ts`
- Modify: `packages/contracts/src/protocols.ts` (step union)
- Modify: `packages/contracts/src/sessions.ts` (`LaunchStep` union, `videoViewInput`)
- Test: `packages/contracts/test/videos.test.ts`

**Interfaces:**
- `youtubeId(urlOrId: string): string | null` — accepts `https://www.youtube.com/watch?v=ID`, `https://youtu.be/ID`, `https://www.youtube.com/shorts/ID`, `https://www.youtube.com/embed/ID`, or a bare 11-char id.
- `videoInput` (zod): `{ source: "upload" | "youtube"; youtube_url?: string; titles: Partial<Record<Locale, string>> (≥ 1 non-empty); descriptions?: Partial<Record<Locale, string>>; region_ids: uuid[] (0–60); age_min: 3–18 | null; age_max: 3–18 | null (≥ age_min); status: "draft" | "published" | "archived"; duration_s?: 1–7200 | null }`; refine: `source === "youtube"` ⇒ `youtubeId(youtube_url)` not null.
- `VideoSummary { id; source; youtube_id: string | null; title: string; description: string | null; titles: Record<string,string>; duration_s: number | null; age_min; age_max; status; version; has_file: boolean; needs_internet: boolean; regions: Array<{ id; path; code; kind }> }`.
- `BrainRegion { id; parent_id: string | null; kind: "hemisphere" | "lobe" | "area"; code; path; label: string; sort }`.
- `stepInput` becomes `z.preprocess(addDefaultStepType, z.discriminatedUnion("step_type", [gameStepInput, videoStepInput]))`; `gameStepInput` is today's object plus `step_type: z.literal("game")` (same refinements); `videoStepInput = { step_type: z.literal("video"); video_id: uuid }`. Types: `GameStepInput`, `VideoStepInput`, `StepInput = GameStepInput | VideoStepInput` (input types), helper `isVideoStep(s): s is VideoStepInput`.
- `TemplateSummary.games` stays `string[]` of game ids; add `items: Array<{ kind: "game"; game_id } | { kind: "video"; video_id; title }>`.
- `LaunchStep = LaunchGameStep (today's shape + kind: "game") | LaunchVideoStep { kind: "video"; assignment_step_id; ordinal; video: { id; version; source; youtube_id; title; duration_s; file_url: string | null; sha256: string | null }; done }`.
- `videoViewInput = { client_view_id: uuidv7; planned_session_id: uuid; assignment_step_id: uuid; video_id: uuid; video_version: int ≥ 1; started_at: datetime; ended_at: datetime; watched_s: int 0–7200; completed: boolean }`.

- [ ] **Step 1: Failing tests** in `videos.test.ts`: `youtubeId` for each URL form returns `"dQw4w9WgXcQ"`-shaped ids and `null` for `https://vimeo.com/1`; a step without `step_type` parses as `"game"`; `{ step_type: "video", video_id }` parses; a video step with `session_mode` is stripped or rejected (assert it is rejected: use `.strict()` on `videoStepInput`); `videoInput` with source youtube and no URL fails with path `youtube_url`; titles all empty fails.
- [ ] **Step 2: Run** `pnpm --filter @emb/contracts test` → FAIL.
- [ ] **Step 3: Implement** as specified.
- [ ] **Step 4: Run** contracts tests → PASS; `pnpm typecheck` shows the expected errors in api/web where `step.game_id` is read off the union — list them, fix them in Tasks 4–7 (do not cast them away here; narrow with `isVideoStep`).
- [ ] **Step 5: Commit** `feat(contracts): video library types and game/video step union`.

### Task 3: API — file store and video library routes

**Files:**
- Create: `apps/api/src/files.ts` (`FileStore`)
- Create: `apps/api/src/modules/videos/routes.ts`
- Modify: `apps/api/src/app.ts` (`AppDeps.files?: FileStore`; mount `/v1/brain-regions`, `/v1/videos`, `/v1/admin/videos`)
- Modify: `apps/api/src/server.ts` (`localFileStore(process.env.FILE_STORE_DIR ?? ".data/files")`)
- Modify: `apps/api/src/modules/me/routes.ts` (add `is_platform_admin: boolean`)
- Test: `apps/api/test/videos-api.test.ts`; extend `apps/api/test/support.ts` with a platform-admin user helper.

**Interfaces:**
- `interface FileStore { put(key: string, body: ReadableStream<Uint8Array>, maxBytes: number): Promise<{ bytes: number; sha256: Buffer }>; open(key: string, range?: { start: number; end: number }): Promise<{ stream: ReadableStream<Uint8Array>; size: number } | null>; remove(key: string): Promise<void> }`; `localFileStore(dir: string): FileStore` writes to a temp file then renames (no partial files), rejects past `maxBytes` with `FileTooLarge`.
- Routes (all under `withUser`):
  - `GET /v1/brain-regions` → `{ regions: BrainRegion[] }`, `label` in the caller's `?lang=` (default `en`, falls back to `en`).
  - `GET /v1/videos?q=&hemisphere=left|right&region=<uuid>&lang=` → `{ videos: VideoSummary[] }` published only (admins: `&all=1` includes draft/archived). `region` matches the node or any descendant by `path` prefix; a lobe or BA chosen without hemisphere matches both hemispheres by `code`. Title falls back `lang` → `en` → `he` → any.
  - `GET /v1/videos/:id` → `{ video: VideoSummary }`.
  - `GET /v1/videos/:id/file` → streams the current file; honours `Range: bytes=a-b` (206, `Content-Range`, `Accept-Ranges: bytes`), invalid range 416; `Cache-Control: private, max-age=31536000, immutable` and `ETag: "<sha256>"` (the URL includes `?v=<version>`).
  - `POST /v1/admin/videos` (body `videoInput`) → 201 `{ video }`. `PUT /v1/admin/videos/:id` → `{ video }` (replaces titles and regions; bumps `version` only when the file or YouTube id changes). `PUT /v1/admin/videos/:id/file` (raw body, `Content-Type` video/mp4|video/webm, `Content-Length` ≤ 1 GiB else 413) → `{ video }` with `version + 1`, new `file_object`, old file kept (assignments may be mid-session). Non-admins get 403 because RLS rejects the write (`42501` → 403 already mapped in `app.ts`); check `is_platform_admin()` before streaming the body so a therapist's upload is refused without storing bytes.
- [ ] **Step 1: Failing tests** in `videos-api.test.ts`:
  - `brain regions come back as a tree with Hebrew labels` (`lang=he` label of left BA44 contains `ברודמן`).
  - `a platform admin adds a YouTube video and a therapist finds it by Brodmann area` (create published with region left.frontal.ba44; therapist `GET /v1/videos?region=<id of left.frontal>` contains it; `?region=<id of right.frontal.ba44>` does not; `needs_internet: true`).
  - `a therapist cannot add, edit or upload videos` (POST 403, PUT 403, PUT file 403; admin list unchanged).
  - `uploads a file, then serves it whole and by range` (PUT 1 KiB of bytes with `video/mp4`; GET file → 200 same bytes; `Range: bytes=10-19` → 206 with those 10 bytes; `Range: bytes=5000-6000` → 416; `version` went 1 → 2).
  - `rejects a file that is not a video, or too large` (`text/plain` → 415; `Content-Length: 1073741825` → 413).
  - `falls back to the other language for a missing title` (only `he` title; `lang=en` list shows the Hebrew title).
  - `drafts are hidden from therapists` (draft not in therapist list; `GET /v1/videos/:id` → 404).
- [ ] **Step 2: Run** `DATABASE_URL=… pnpm --filter @emb/api test -- videos` → FAIL.
- [ ] **Step 3: Implement** `files.ts`, the routes and the `me` flag. Tests use `localFileStore(mkdtemp())`.
- [ ] **Step 4: Run** API tests → PASS (all files).
- [ ] **Step 5: Commit** `feat(api): video library, Brodmann filter and local file store`.

### Task 4: API — video steps in protocols and sessions, video views

**Files:**
- Modify: `apps/api/src/modules/protocols/routes.ts` (`STEP_COLUMNS` + `step_type, video_id`; `stepValues` for both kinds; `gameIssues` skips video steps; new `videoIssues(db, steps)`; `items` in summaries; Today's `games` keeps game ids and gains `items`)
- Modify: `apps/api/src/modules/sessions/routes.ts` (launch builds `LaunchVideoStep` with no ticket; `POST /v1/video-views`; closing rule counts video views)
- Test: extend `apps/api/test/protocols-api.test.ts` and `apps/api/test/sessions-api.test.ts`

**Interfaces:**
- `videoIssues(db, steps): Promise<Issue[]>`: for each video step, the video must exist and be `published` at save time → else `{ path: "steps.N.video_id", code: "video_not_available" }`.
- Assignment copy of a video step: `difficulty_start = current_difficulty = 3`, `hemisphere 'left'`, `timer_position 'hidden'`, `practice 'off'`, other game fields null.
- Launch: video step `done` = a `video_view` exists for `(planned_session_id, assignment_step_id)`; `file_url = /v1/videos/<id>/file?v=<version>` for uploads, null for YouTube. Archived videos already in an assignment still launch (RLS: assignments may read the video row they reference — add policy `video_read_assigned`: SELECT where an `assignment_step` the caller can see references it).
- `POST /v1/video-views` (body `videoViewInput`) → 201 `{ outcome: "accepted", planned_session_status }` or 200 `{ outcome: "duplicate" }` on the same `client_view_id`; 409 `session_closed` when the planned session is done/cancelled; 422 `step_mismatch` when the step is not a video step of that session's assignment or the video id differs.
- Closing rule: the planned session becomes `done` when every assignment step has a `game_session` (game steps) or a `video_view` (video steps); run it after both result ingest and video view insert.
- [ ] **Step 1: Failing tests:**
  - protocols: `a template mixes games and videos` (POST template with `[game, {step_type:"video", video_id}, game]` → 201; GET returns the video step with `video_id` and `items[1].title`); `a draft or unknown video cannot be added` (400 `video_not_available`); `an assignment keeps an archived video` (assign, admin archives, `GET /patients/:id/assignment` still lists it).
  - sessions: `launch includes a playable video step` (`kind: "video"`, `file_url` ends with `?v=1` for upload, no `ticket`); `a watched video counts once and closes the session` (session whose steps are one game + one video: post game result → status `in_progress`; post view → `done`; repeat view → 200 `duplicate`); `a view for another patient's step is refused` (422 `step_mismatch`); `views are append-only` (direct UPDATE as emb_app fails — covered in Task 1; here assert a second view with a new `client_view_id` after `done` → 409).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** all API tests → PASS; `pnpm typecheck` clean for `apps/api`.
- [ ] **Step 5: Commit** `feat(api): video steps in protocols and sessions, idempotent video views`.

### Task 5: Web — platform admin Videos page

**Files:**
- Create: `apps/web/src/routes/admin/videos.tsx` (list + editor), `apps/web/src/routes/admin/RegionPicker.tsx` (shared with Task 6)
- Modify: `apps/web/src/api/queries.ts` (`useBrainRegions(lang)`, `useVideos(filters)`, `useSaveVideo()`, `uploadVideoFile(id, file, onProgress)` via `XMLHttpRequest` for progress), `apps/web/src/App.tsx` (route `/admin/videos`; rail item "Videos" only when `me.is_platform_admin`), `apps/web/src/i18n/messages/{en,he}.json` (`videos.*`, `regions.*`), `apps/web/src/demo/fake-api.ts` (same endpoints in memory)
- Test: `apps/web/e2e/videos.spec.ts`

**Interfaces:**
- `RegionPicker({ regions, value: string[], onChange, mode: "tag" | "filter" })`: hemisphere tabs (Left / Right / Both in filter mode), lobes as groups, areas as checkboxes (tag mode) or a single select (filter mode). Real checkboxes with labels; keyboard reachable.
- Editor fields: source (radio Upload file / YouTube link), YouTube link input with live preview of the parsed id (error "That isn't a YouTube link"), file input (`accept="video/mp4,video/webm"`) with progress bar, titles en + he (at least one), descriptions, age range, regions, status (Draft / Published / Archived). Badge "Needs Internet" on YouTube videos.
- [ ] **Step 1: Failing e2e** `a platform admin adds a video and tags it with Brodmann areas`: sign in as the seeded platform admin; Videos in the rail; add YouTube video with title, tick Left → Frontal → BA44; publish; it appears in the list with "Needs Internet" and "BA44". And `therapists don't see the Videos admin page` (rail has no Videos; `/admin/videos` shows not-allowed state).
- [ ] **Step 2: Run** `pnpm e2e -g "Videos admin|admin page"` → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** `feat(web): platform admin video library`.

### Task 6: Web — video picker in the step editor; video steps in protocol views

**Files:**
- Create: `apps/web/src/routes/protocols/VideoPicker.tsx`
- Modify: `apps/web/src/routes/protocols/steps.tsx` ("Add video" next to "Add game"; video step row shows thumbnail-less card: title, duration, region chips, "Needs Internet"), `apps/web/src/routes/protocols/pages.tsx` and `apps/web/src/routes/patients/protocol-card.tsx` and Today cards (render `items`, video as "▶ title"), i18n files
- Test: extend `apps/web/e2e/videos.spec.ts`

**Interfaces:**
- `VideoPicker({ open, onClose, onPick(video: VideoSummary) })`: filters — search, hemisphere, lobe/BA (`RegionPicker mode="filter"`), age fits patient (when known); result list as buttons naming title and areas; empty state "No videos match these filters."
- [ ] **Step 1: Failing e2e** `a therapist filters videos by Brodmann area and adds one between two games`: new template → add game → Add video → filter Left / Frontal / BA44 → the admin's video is listed, a BA17-only video is not → pick → add second game → save → template detail shows "Game → ▶ title → Game".
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(web): add videos to protocols from a filtered library`.

### Task 7: Web — session runner plays video steps

**Files:**
- Create: `apps/web/src/session/VideoStep.tsx`
- Modify: `apps/web/src/session/SessionPage.tsx` (branch on `step.kind`; video views go through the same device-first queue as results, keyed by `client_view_id`), `apps/web/src/session/queue.ts` or the existing queue module (add `kind: "video_view"` items), i18n files
- Test: extend `apps/web/e2e/videos.spec.ts`

**Interfaces:**
- `VideoStep({ step: LaunchVideoStep, onDone(view: VideoViewInput) })`: uploads play in `<video controls playsInline preload="auto" src={file_url}>`; YouTube in an `<iframe>` on youtube-nocookie with `allow="autoplay; encrypted-media"`, `referrerPolicy="strict-origin"`, `title={video.title}`; when offline (`navigator.onLine === false`) a YouTube step shows "This video needs the Internet" with Skip. "Continue" button appears when the video ends or after 3 s for YouTube (no end event without the iframe API); `watched_s` from `currentTime` (uploads) or wall-clock while visible (YouTube); `completed` = ended (uploads) or Continue after ≥ 80% of `duration_s` (YouTube, when known).
- [ ] **Step 1: Failing e2e** `a session plays the video step and moves on`: seeded patient with protocol `[Tunnel Rush, uploaded video]`; start session; finish/stop the game; video step shows the title and a `<video>`; Continue → summary lists the video as watched; reload Today: session done.
- [ ] **Step 2–4:** run (FAIL) → implement → run (PASS).
- [ ] **Step 5: Commit** `feat(web): play video steps in sessions and record views`.

### Task 8: Seed, demo and synthetic sample videos

**Files:**
- Modify: `apps/api/scripts/seed-dev.ts` (platform org "eMazeBrain", user `admin@synthetic.test` with role `platform_admin`; three published sample videos with regions; e2e accounts for Tasks 5–7; bump the patients team count assertion if staff counts change)
- Create: `apps/web/public/demo-videos/*.mp4` — three ≤ 300 KB synthetic clips generated with ffmpeg (`testsrc2`/`mandelbrot` patterns, 8–12 s, 480p, H.264 baseline, no audio) via `scripts/make-sample-videos.sh`; no real people, no third-party footage.
- Modify: `apps/web/src/demo/fake-api.ts` (brain regions from `@emb/db/brain-regions`, the three samples, admin mode toggle for the demo user)
- [ ] **Step 1:** generate clips; **Step 2:** seed + demo changes; **Step 3:** `pnpm e2e` full run in the background → all pass; **Step 4: Commit** `chore: seed platform admin and synthetic sample videos`.

### Task 9: Docs, verification and release

**Files:**
- Create: `docs/adr/0018-video-library.md` (decisions: uploads + YouTube, needs-Internet flag, local `FileStore`, Brodmann tree as text path, step union, append-only views, project 2/3 boundaries)
- Modify: design doc — §7 rows note `path` text instead of `ltree`; Video Service row notes the local file store; the Brodmann list marked `[Assumption]`.
- [ ] **Step 1:** ADR + doc. **Step 2:** `pnpm typecheck`, all unit + db + API tests, full e2e → paste the pass counts. **Step 3:** requesting-code-review on the whole branch; fix findings. **Step 4:** build runtime + demo; commit; push to main; publish demo artifact.
