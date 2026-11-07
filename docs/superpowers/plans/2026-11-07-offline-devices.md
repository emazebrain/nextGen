# Offline Therapist Devices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An installable web app that a therapist can open and run sessions in with no connection, on a tablet shared with other therapists, with games and videos stored on the device and results sent by whoever next signs in online.

**Architecture:** A service worker precaches the app (including every game frame) and serves stored video versions from Cache Storage. Each therapist gets an encrypted IndexedDB space filled from a new `/v1/offline/bundle` endpoint; offline sessions run from pre-issued session packages carrying 30-day v2 launch tickets that sign allowed parameters. Results go to one device outbox sealed to a device key pair; the server authorises ingest by the verified ticket, keeps every attempt, and flags results that arrive after something changed.

**Tech Stack:** Hono + Postgres RLS (`withUser`), zod contracts, React/Vite, `vite-plugin-pwa` (injectManifest) + `workbox-*`, `idb`, WebCrypto (AES-GCM, PBKDF2, ECDH P-256, WebAuthn PRF), `fake-indexeddb` (tests), Playwright.

**Spec:** `docs/superpowers/specs/2026-11-07-offline-device-design.md` (approved 2026-11-07). Also read `CLAUDE.md`, `docs/adr/0018-video-library.md`.

## Global Constraints

- CLAUDE.md invariants apply to every task: synthetic data only; RLS ENABLE + FORCE + policies in the same migration; `SET LOCAL app.user_id` via `withUser`, no client clinic ids; append-only clinical records; Session Rules own time and lives; games import only `@emb/game-sdk`; no patient data in logs, keys or notifications; idempotent ingest by device UUIDv7; wording "game-based activities"; ICU messages in en + he, CSS logical properties only.
- Expand/contract only: v1 tickets and the current `/launch` keep working unchanged.
- Offline unlock lasts **30 days** after the space's last online sign-in.
- Offline password: **at least 8 characters**; PBKDF2-SHA-256 **≥ 600,000** iterations, 16-byte per-space salt. A 4–6 digit code is refused.
- Wrong offline password: **5** tries → lock **1 minute**, doubling after each further 5.
- v2 tickets live **30 days**. Session packages: at least the **next 4** planned sessions per active assignment, plus every planned session in the next **14 days**.
- Background refresh: on online sign-in, every **15 minutes** while open and online, and on "Update now".
- Ticket allowed parameters: exact = game, `session_mode`, `duration_s`, `lives`, `hemisphere`, `timer_position`, `monochrome`, `trial_window_ms`, game-own params, `lang`, `context`; range = `difficulty` within the step's allowed min/max (1–5 when the rule sets none); free = `seed`, `practice`, `instructions`.
- An outbox entry is removed only when the server answers `accepted`, `duplicate` (true duplicate) or `kept_for_review`.
- Review reasons (exact strings): `consent_withdrawn`, `not_on_care_team`, `membership_ended`, `assignment_not_active`, `step_changed`, `session_closed`, `played_twice`, `params_outside_ticket`.
- New localStorage/IndexedDB names: DB `emb.device.v1` (shared), `emb.space.<spaceId>.v1` (per space); cache `emb-videos-v1`. Existing `emb.outbox.v1` items and `emb.kidpin.v1` are migrated on first run (Task 11).
- Server env: `DEVICE_SECRET_KEY` (32-byte base64; required in production; random per process in dev/test).
- The demo build (`build:demo`) must not register a service worker.

## Review Focus

1. **A device that was offline across a protocol edit** (step removed, difficulty set by hand) uploads results → they are stored, flagged `step_changed`, and the hand-set difficulty is not overwritten (Task 4 test "a hand-set difficulty since the package was issued is kept").
2. **Storage fills up mid-download** → no partial file is ever indexed as stored; upcoming-session videos come first (Task 8 test "a failed or mismatched download leaves nothing behind" and "upcoming videos download before the rest of the library").
3. **The browser gets a new app build while a session is running** → the update waits until the session ends (Task 8 test "an update is not applied during a session").
4. **Two therapists' spaces on one browser profile** → B's sign-in sends A's outbox but B can't read A's space even with A's database copied (Task 7 test "another space's data key can't open this space"; Task 13 e2e).
5. **Uploader whose cookie expired** while results wait → nothing is dropped; the app asks for an online sign-in and then sends (Task 11 test "a 401 keeps the outbox and asks for sign-in").

---

### Task 1: Database — devices, spaces, uploader, review flags, ticketed ingest

**Files:**
- Create: `packages/db/migrations/0011_offline_devices.sql`
- Test: `packages/db/test/offline.test.ts`

**Interfaces:**
- Produces tables: `app.device(id uuid pk, outbox_public_key text, outbox_secret_enc bytea, created_at, last_seen_at)`; `app.device_space(id uuid pk, device_id fk, user_id fk, clinic_id fk, space_secret_enc bytea, created_at, last_online_at, ended_at, ended_by)`, unique `(device_id, user_id, clinic_id) WHERE ended_at IS NULL`; `app.result_review(id, game_session_id null, video_view_id null, decision text check in ('accept','exclude'), decided_by, decided_at, note)` with exactly-one-target check, append-only.
- Columns: `assignment_step.difficulty_set_at timestamptz` (null = never set by hand), `game_session.uploaded_by uuid`, `game_session.review_reason text`, `video_view.uploaded_by uuid`, `video_view.review_reason text` (nullable; set only at insert; review reasons from Global Constraints).
- Functions (owner `emb_rls_helper`, `SECURITY DEFINER`, `search_path = app, pg_temp`):
  - `app.ingest_game_session(row jsonb, therapist uuid, device uuid) RETURNS uuid` — inserts the row with `recorded_by = therapist`, `uploaded_by = app.current_user_id()`, `clinic_id` from the patient; returns the id or NULL on id conflict. Refuses (raises `ticketed_ingest_forbidden`) unless the caller is `therapist`, or holds an active `device_space` on `device`.
  - `app.ingest_video_view(row jsonb, therapist uuid, device uuid) RETURNS uuid` — same rule for `video_view`.
  - `app.review_reason_for(patient uuid, therapist uuid, assignment_step uuid, planned_session uuid) RETURNS text` — first matching reason in the order: consent_withdrawn, membership_ended, not_on_care_team, assignment_not_active, session_closed; NULL when none.

- [ ] **Step 1: Write the failing tests** in `packages/db/test/offline.test.ts` (shared helpers `freshDatabase`, `asUser`):
  - `"a therapist sees only their own spaces; a manager sees and ends their clinic's"` — insert spaces for two therapists in clinic One and one in clinic Two; therapist reads 1 row; manager of One reads 2 and can `UPDATE … SET ended_at` them; manager of One updating the clinic-Two space affects 0 rows.
  - `"ticketed ingest stores a result for a patient the uploader can't see, credited to the therapist"` — therapist A treats the patient; B (same clinic, not on care team) holds an active space on the device; `asUser(B)` calls `app.ingest_game_session` → row exists with `recorded_by = A`, `uploaded_by = B`.
  - `"ticketed ingest refuses an uploader with no space on the ticket's device"` — rejects with `/ticketed_ingest_forbidden/`.
  - `"review reasons: consent withdrawn first, then care team"` — withdraw consent → `consent_withdrawn`; restore, remove A from care team → `not_on_care_team`.
  - `"result reviews are append-only"` — UPDATE/DELETE on `result_review` raise `/append-only/`.
  - `rls.test.ts` stays green (new tables have FORCE RLS).

- [ ] **Step 2: Run** `DATABASE_URL=postgres://postgres:spike@localhost:55432/postgres pnpm --filter @emb/db test` — Expected: the new tests fail (relation `app.device` does not exist).

- [ ] **Step 3: Write `0011_offline_devices.sql`** — expand-only; RLS policies: `device` readable by users with a space on it, insertable by any staff; `device_space` own rows + `app.is_clinic_manager(clinic_id)` (use the existing manager helper from 0001; add one if absent); `result_review` readable via `app.can_see_patient` of the target's patient, insertable by `app.can_treat_patient` or manager. Grants to `emb_app`. Append-only and audit triggers as in 0010.

- [ ] **Step 4: Run** the db tests — Expected: all pass, including `rls.test.ts`.

- [ ] **Step 5: Commit** `feat(db): devices, spaces, ticketed ingest and review flags (0011)`.

---

### Task 2: Contracts — v2 tickets, offline bundle, devices, receipts

**Files:**
- Create: `packages/contracts/src/offline.ts`
- Modify: `packages/contracts/src/sessions.ts` (receipts), `packages/contracts/src/index.ts`
- Test: `packages/contracts/test/offline.test.ts`

**Interfaces:**
- Produces in `offline.ts`:
  - `type AllowedParams = { exact: Record<string, unknown>; difficulty: { min: number; max: number } }`.
  - `paramsWithinAllowed(allowed: AllowedParams, params: Record<string, unknown>): boolean` — every `exact` key equal; `difficulty` integer in range; `seed`, `practice`, `instructions` free; any other key present in params but not in `exact` → false.
  - `offlineParams(base: Record<string, unknown>, o: { difficulty: number; sessionsCompleted: number; practiceSetting: "on" | "off" | "auto"; seed: number }): Record<string, unknown>` — same practice/instructions rule as the API's `buildParams` (practice auto → on only when sessionsCompleted = 0; instructions `always` when < 2, else `short`).
  - `SessionPackage` = `LaunchPackage` where game steps carry `{ ticket: string; allowed: AllowedParams; base_params: Record<string, unknown>; practice_setting: "on"|"off"|"auto"; sessions_completed: number; progression: Rule | null; difficulty: number }` instead of `params`, plus `planned_date: string`.
  - `OfflineBundle = { generated_at: string; me: Me; caseload: PatientSummary[]; patients: Record<string, PatientDetail>; templates: TemplateSummary[]; assignments: AssignmentView[]; packages: SessionPackage[]; videos: Array<{ id: string; version: number; sha256: string; bytes: number; file_url: string }>; ended_spaces: string[] }` (reuse the existing contract types for patients/templates/assignments).
  - `LibraryManifest = { videos: OfflineBundle["videos"] }`.
  - `deviceRegisterInput = z.object({ device_id: uuid, outbox_public_key: z.string().max(200) })`, `DeviceSecrets = { outbox_secret: string | null; spaces: Array<{ space_id: string; clinic_id: string; space_secret: string }> }`, `DeviceSpace = { id, user_id, full_name, clinic_id, clinic_name, last_online_at, ended_at }`.
- Modifies `ResultReceipt.outcome` and `VideoViewReceipt.outcome` to `"accepted" | "duplicate" | "kept_for_review"` and adds `review_reason: string | null`.

- [ ] **Step 1: Write failing tests** `paramsWithinAllowed` (accepts difficulty 4 in 1–5 with a different seed and practice; refuses changed `hemisphere`; refuses difficulty 6; refuses an extra key) and `offlineParams` (practice auto with 0 sessions → `on`, 1 → `off`; instructions `always` at 1, `short` at 2; difficulty and seed applied; base untouched).
- [ ] **Step 2: Run** `pnpm --filter @emb/contracts test` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `offline.ts`, export from `index.ts`, extend receipts.
- [ ] **Step 4: Run** contracts tests and `pnpm typecheck` — Expected: contracts pass; typecheck may fail in api/web where receipts are matched exhaustively — fix those call sites minimally (treat `kept_for_review` like `accepted` for now).
- [ ] **Step 5: Commit** `feat(contracts): offline bundle, v2 ticket params, kept_for_review`.

---

### Task 3: API — device registration, secrets, spaces

**Files:**
- Create: `apps/api/src/device-crypto.ts`, `apps/api/src/modules/devices/routes.ts`
- Modify: `apps/api/src/app.ts` (mount; `AppDeps.deviceKey`), `apps/api/src/server.ts` (`DEVICE_SECRET_KEY`), `apps/api/test/support.ts`
- Test: `apps/api/test/devices-api.test.ts`

**Interfaces:**
- Consumes: Task 1 tables; Task 2 `deviceRegisterInput`, `DeviceSecrets`, `DeviceSpace`.
- Produces:
  - `deviceKey(base64: string | undefined): { seal(plain: Buffer): Buffer; open(sealed: Buffer): Buffer }` (AES-256-GCM, random 12-byte IV prefixed).
  - `POST /v1/devices/register` → 201 `{ device_id }`; idempotent for the same id; creates `outbox_secret` (32 random bytes) on first registration.
  - `POST /v1/devices/:id/spaces` → 201 `DeviceSpace` for the caller's active clinic (creates the space and its `space_secret`; returns the existing active one if present) and sets `last_online_at`.
  - `GET /v1/devices/:id/secrets` → `DeviceSecrets`: the outbox secret for any signed-in staff member with any active space on the device; `spaces` only the caller's own; touches `last_online_at` of the caller's spaces. 404 for an unregistered device.
  - `GET /v1/devices/:id/spaces` → `DeviceSpace[]` the caller may see (own + managed clinic).
  - `DELETE /v1/devices/:id/spaces/:spaceId` → 204 (own or manager), sets `ended_at`, `ended_by`.
  - Secrets are base64 in JSON, never logged.

- [ ] **Step 1: Write failing tests**: `"registers a device once and hands its outbox secret to anyone with a space there"`; `"a space secret goes only to its owner"`; `"a manager ends a therapist's space; a therapist can't end another's"`; `"secrets for an unknown device are 404"`; `"secrets are stored encrypted"` (raw column ≠ returned value, and `deviceKey(...).open(column)` equals it).
- [ ] **Step 2: Run** `pnpm --filter @emb/api test -- devices-api` — Expected: FAIL (404 route).
- [ ] **Step 3: Implement** the crypto helper and routes with `withUser`; in dev/test a random key per process when `DEVICE_SECRET_KEY` is unset; throw at start in production when unset.
- [ ] **Step 4: Run** api tests — Expected: PASS, previous 66 still pass.
- [ ] **Step 5: Commit** `feat(api): device registration, space and outbox secrets`.

---

### Task 4: API — v2 tickets and ingest that never drops

**Files:**
- Modify: `apps/api/src/tickets.ts`, `apps/api/src/modules/sessions/routes.ts`
- Test: `apps/api/test/offline-ingest-api.test.ts`

**Interfaces:**
- Consumes: Task 1 definer functions and columns; Task 2 `AllowedParams`, `paramsWithinAllowed`, receipts.
- Produces:
  - `TicketClaimsV2 = { v: 2; jti; psid; asid; pid; gid; sub; dev: string; allowed: AllowedParams; iat; exp }`; `ticketSigner(...).signV2(claims, ttlS)`; `verify()` returns `TicketClaims | TicketClaimsV2 | null`.
  - `OFFLINE_TICKET_TTL_S = 30 * 24 * 3600` exported from `sessions/routes.ts`.
  - `/results`: v1 path unchanged; v2 path: params checked with `paramsWithinAllowed` (outside → stored, flagged `params_outside_ticket`, not "rejected"); insert via `app.ingest_game_session(row, claims.sub, claims.dev)`; `review_reason` from `app.review_reason_for` plus `step_changed` (the step's structural params no longer match `allowed.exact`) and `played_twice` (another result already exists for the same planned session and step); a flagged result is `kept_for_review` (201) and, when `consent_withdrawn`, skips progression.
  - Fixes for both versions: an id conflict with a **different** step is a true id reuse — answer 409 `session_id_reused` and keep the raw row (the device keeps the item marked "needs help"); a result whose patient is hidden from the uploader goes through the ticketed function instead of being answered "duplicate".
  - `/video-views`: a view for a closed session is stored and flagged `session_closed` (`kept_for_review`, 201) instead of 409; v2 uses `app.ingest_video_view`. The view body gains optional `ticket` (v2) so offline views carry the therapist and device.
  - Progression for v2 results runs only when not flagged and uses the stored step difficulty; a difficulty the therapist set after the ticket's `iat` is not changed by a late result (compare `assignment_step.difficulty_set_at` from Task 1; the protocols module sets it whenever a therapist edits difficulty).

- [ ] **Step 1: Write failing tests** (own fixture, `platformAdmin()` not needed):
  - `"a v2 result uploaded by another therapist on the device is stored and credited to the ticket's therapist"`
  - `"a v2 result with a difficulty inside the ticket is accepted; a changed hemisphere is kept for review"`
  - `"a result after consent was withdrawn is kept for review and changes no difficulty"`
  - `"the same planned session played on two devices: both kept, the later one flagged played_twice"`
  - `"a hand-set difficulty since the package was issued is kept"`
  - `"a video view after the session closed is kept for review, not refused"`
  - `"a v1 result for a patient the uploader can't see is not answered duplicate"`
  - `"an expired v2 ticket is rejected and logged"` (`invalid_ticket`, raw row present)
- [ ] **Step 2: Run** `pnpm --filter @emb/api test -- offline-ingest` — Expected: FAIL.
- [ ] **Step 3: Implement** v2 sign/verify (same Ed25519 key, `v` discriminates), the ingest branch, the fixes, `difficulty_set_at` maintenance in the protocols module's difficulty update.
- [ ] **Step 4: Run** all api tests — Expected: PASS (existing sessions/video tests unchanged).
- [ ] **Step 5: Commit** `feat(api): v2 offline tickets; ingest keeps and flags instead of dropping`.

---

### Task 5: API — the offline bundle

**Files:**
- Create: `apps/api/src/modules/offline/routes.ts`
- Modify: `apps/api/src/modules/sessions/routes.ts` (extract `loadLaunchRows(db, plannedSessionId)` shared by `/launch` and the bundle, without the `in_progress` update), `apps/api/src/app.ts`
- Test: `apps/api/test/offline-bundle-api.test.ts`

**Interfaces:**
- Consumes: Task 2 `OfflineBundle`, `SessionPackage`, `LibraryManifest`; Task 4 `signV2`, `OFFLINE_TICKET_TTL_S`; Task 3 spaces.
- Produces:
  - `GET /v1/offline/bundle?device=<uuid>&lang=<locale>` → `OfflineBundle` for the caller's active clinic; 409 `no_space` unless the caller has an active space on that device. Caseload = patients on the caller's care team with consent to play; packages per the Global Constraints window, only `planned`/`in_progress` sessions of `active` assignments; tickets v2 bound to `sub = caller`, `dev = device`; `videos` = upload videos the packages use (current version, has file); `ended_spaces` = ids of spaces on this device ended since the caller's last bundle. Building the bundle changes no session state and writes one audit event (`offline_bundle`, no patient data in its details).
  - `GET /v1/offline/library` → `LibraryManifest` (every published upload video with a file).

- [ ] **Step 1: Write failing tests**: `"the bundle holds only the caller's caseload"` (a colleague's patient absent); `"packages cover the next 4 sessions and the next 14 days, without starting any"` (statuses still `planned`); `"package tickets are v2, 30 days, bound to the caller and device"`; `"videos list the versions the packages use"`; `"no bundle without a space on the device"`; `"ended spaces are reported"`; `"the library lists every published uploaded video"`.
- [ ] **Step 2: Run** — Expected: FAIL (404).
- [ ] **Step 3: Implement**; `allowed.difficulty` = the step rule's min/max, else 1–5; `allowed.exact` = `buildParams(...)` minus `difficulty`, `seed`, `practice`, `instructions`.
- [ ] **Step 4: Run** all api tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): offline bundle and library manifest`.

---

### Task 6: API — reviewing flagged results

**Files:**
- Modify: `apps/api/src/modules/sessions/routes.ts` (patient sessions list), progress/progression queries wherever they read `game_session`, Today query (`apps/api/src/modules/protocols/routes.ts` today endpoint or where it lives)
- Test: `apps/api/test/review-api.test.ts`

**Interfaces:**
- Produces:
  - `GET /v1/patients/:id/sessions` items gain `review: { reason: string; decision: "accept" | "exclude" | null } | null`.
  - `POST /v1/results/:sessionId/review` and `POST /v1/video-views/:id/review` with `{ decision: "accept" | "exclude", note?: string }` → 201; therapist on the care team or clinic manager; appends `result_review`.
  - Progress, progression history and reports exclude a game session when its latest review is `exclude`, or when it is flagged `consent_withdrawn` with no review.
  - `TodayResponse.review_count: number` — flagged, unreviewed results visible to the caller.

- [ ] **Step 1: Write failing tests**: `"a consent-withdrawn result stays out of progress until accepted"`; `"excluding a result removes it from progress"`; `"Today counts flagged results the caller can review"`; `"a colleague without access can't review"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement** with a SQL view `app.game_session_effective` (in a new migration `0012_review_view.sql`, `security_invoker = true`) used by progress queries.
- [ ] **Step 4: Run** db + api tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(api): review flagged results; keep unreviewed consent-withdrawn results out of progress`.

---

### Task 7: Web — device crypto and stores

**Files:**
- Create: `apps/web/src/device/crypto.ts`, `apps/web/src/device/db.ts`, `apps/web/src/device/spaces.ts`
- Modify: `apps/web/package.json` (add `idb`; dev `fake-indexeddb`)
- Test: `apps/web/test/device-crypto.test.ts` (`// @vitest-environment node`), `apps/web/test/device-spaces.test.ts`

**Interfaces:**
- Produces in `crypto.ts` (WebCrypto only):
  - `newDataKey(): Promise<CryptoKey>`; `wrapWithPassword(key, password, salt): Promise<Wrapped>`; `unwrapWithPassword(w, password): Promise<CryptoKey>`; `wrapWithSecret(key, secret: Uint8Array)`; `unwrapWithSecret(w, secret)`; `wrapWithPrf(key, prfOutput: Uint8Array)`; `unwrapWithPrf(w, prfOutput)`; `seal(key, value: unknown): Promise<Sealed>`; `open<T>(key, s: Sealed): Promise<T>`.
  - `newOutboxKeyPair(): Promise<{ publicKey: string; privateKeyWrapped: (secret) => Promise<Wrapped> }>`; `sealToPublic(publicKey: string, value: unknown): Promise<SealedForDevice>` (ECDH P-256 ephemeral + HKDF + AES-GCM); `openWithPrivate(privateKey: CryptoKey, s: SealedForDevice)`.
  - `PBKDF2_ITERATIONS = 600_000`, `MIN_PASSWORD_LENGTH = 8`, `validPassword(p: string): boolean` (≥ 8 chars and not all digits of length ≤ 6).
- Produces in `db.ts`: `deviceDb()` (shared DB `emb.device.v1`: stores `meta`, `spaces`, `outbox`, `videos`, `settings`), `spaceDb(spaceId)` (`emb.space.<id>.v1`: store `records` keyed by name, values `Sealed`).
- Produces in `spaces.ts`:
  - `type SpaceInfo = { id; user_id; display_name; clinic_id; clinic_name; last_online_at; wrapped: { password: Wrapped; secret: Wrapped; prf?: Wrapped & { credentialId: string } }; tries: { count: number; locked_until: number } }`
  - `listSpaces(): Promise<SpaceInfo[]>`; `createSpace(info, password, secret, prf?)`; `unlockWithPassword(id, password, now): Promise<OpenSpace | { locked_ms: number; tries_left: number }>`; `unlockWithSecret(id, secret)`; `unlockWithPrf(id, prfOutput)`; `removeSpace(id)`; `canUnlockOffline(info, now): boolean` (30 days).
  - `interface OpenSpace { id: string; read<T>(name: string): Promise<T | undefined>; write(name: string, value: unknown): Promise<void>; lock(): void }`.

- [ ] **Step 1: Write failing tests**:
  - `"a space opens with its password, its server secret or its passkey, and not with a wrong password"`
  - `"another space's data key can't open this space"` (copy B's records into A's DB name → `open` throws)
  - `"five wrong passwords lock for a minute, then two, then four"` (inject `now`)
  - `"a space can't be unlocked offline 30 days after its last online sign-in"`
  - `"short digit codes are refused as passwords"` (`"123456"` false, `"tablet42!"` true)
  - `"the outbox can be sealed with only the public key and opened only with the private key"`
  - `"records are stored encrypted"` (raw IndexedDB value has no plaintext patient name)
- [ ] **Step 2: Run** `pnpm --filter @emb/web test -- device-` — Expected: FAIL.
- [ ] **Step 3: Implement**; tests use `fake-indexeddb/auto`.
- [ ] **Step 4: Run** web tests — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): encrypted device spaces and sealed outbox crypto`.

---

### Task 8: Web — service worker, install, and the video store

**Files:**
- Create: `apps/web/src/sw.ts`, `apps/web/src/device/content.ts`, `apps/web/src/device/update.ts`, `apps/web/public/icons/*` (generated from the existing favicon mark), manifest via plugin config
- Modify: `apps/web/vite.config.ts` (`VitePWA({ strategies: "injectManifest", srcDir: "src", filename: "sw.ts", injectRegister: null, manifest: {...} })`, disabled when `mode === "demo"`), `apps/web/src/main.tsx` (register unless demo)
- Test: `apps/web/test/device-content.test.ts`

**Interfaces:**
- Consumes: Task 7 `deviceDb`; Task 2 `OfflineBundle["videos"]`, `LibraryManifest`.
- Produces in `content.ts`:
  - `type ContentMode = "local" | "network"`; `getContentMode(): Promise<ContentMode>` (default `"local"` once installed, `"network"` in a plain browser tab); `setContentMode(m)`.
  - `wantedVideos(spacesVideos: VideoRef[][], library: VideoRef[] | null): VideoRef[]` — union by id keeping the highest version; spaces' videos first, then library.
  - `syncVideos(wanted: VideoRef[], o: { fetch: typeof fetch; cache: Cache; estimate: () => Promise<{ usage: number; quota: number }>; onProgress?: (done: number, total: number) => void }): Promise<{ stored: number; skipped_for_space: VideoRef[] }>` — downloads missing versions one at a time, verifies sha256 before `cache.put`, records the index row, stops adding library videos when the estimate says they won't fit, then removes cached versions no space package references and not in `wanted`.
  - `removeDownloadedVideos(): Promise<void>`; `storedSummary(): Promise<{ videos: number; bytes: number; games_bytes: number; last_update: string | null }>`.
- `sw.ts`: `precacheAndRoute(self.__WB_MANIFEST)` (all JS incl. game frame chunks, CSS, fonts, i18n, icons); navigation fallback to `index.html` except `/v1/` and `/api/`; route `/v1/videos/:id/file?v=` → cache `emb-videos-v1` with `RangeRequestsPlugin`, network fallback when not stored; `skipWaiting` only on a message `{ type: "apply-update" }`.
- `update.ts`: `useAppUpdate(): { ready: boolean; apply(): void }`; `apply()` is a no-op while `sessionRunning()` (from the session runner state) is true.

- [ ] **Step 1: Write failing tests**:
  - `"upcoming videos download before the rest of the library"`
  - `"a failed or mismatched download leaves nothing behind"` (sha mismatch → not in cache, no index row)
  - `"a newer version replaces the old one once no package uses it"`
  - `"library videos that won't fit are skipped and reported"`
  - `"an update is not applied during a session"`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement**; `pnpm --filter @emb/web add vite-plugin-pwa workbox-precaching workbox-routing workbox-strategies workbox-range-requests idb` and `-D fake-indexeddb`.
- [ ] **Step 4: Run** web tests and `pnpm --filter @emb/web build` — Expected: PASS; `dist/sw.js` and `dist/manifest.webmanifest` exist; `build:demo` output has neither.
- [ ] **Step 5: Commit** `feat(web): installable app shell and on-device video store`.

---

### Task 9: Web — offline unlock on a shared device

**Files:**
- Create: `apps/web/src/device/session.tsx` (`DeviceProvider`, `useDevice()`), `apps/web/src/routes/offline-sign-in.tsx`, `apps/web/src/routes/setup-offline.tsx`
- Modify: `apps/web/src/App.tsx` (routes `/offline`, `/setup-offline`; staff guard falls back to `/offline` when the network fails and a space can unlock), `apps/web/src/routes/auth.tsx` (after online sign-in on an installed app: register device, create space, go to `/setup-offline` if the space has no password yet), `apps/web/src/lib/idle.ts` consumer in `ClinicShell` (idle lock → `/offline` when offline), `apps/web/src/session/kidmode.ts` (PIN stored in the open space; falls back to localStorage when no space)
- Test: `apps/web/test/offline-sign-in.test.tsx`

**Interfaces:**
- Consumes: Task 7 `spaces.ts`; Task 3 endpoints.
- Produces: `useDevice(): { deviceId: string; online: boolean; space: OpenSpace | null; info: SpaceInfo | null; openOnline(me: Me): Promise<void>; openOffline(id: string, cred: { password: string } | { prf: true }): Promise<UnlockResult>; signOut(): Promise<void> }`. `openOnline` fetches `/v1/devices/:id/secrets`, unlocks own spaces with their secrets and the outbox private key (held in memory only).
- Passkey setup: `navigator.credentials.create` with `extensions: { prf: { eval: { first: salt } } }`, rpId = current host; offered only when `PublicKeyCredential.getClientCapabilities?.()` reports `prf`, else skipped silently.
- Copy (en/he, ICU): `offline.title` "No connection", `offline.pick` "Who's using the tablet?", `offline.password` "Offline password", `offline.unlock` "Unlock", `offline.useFace` "Use Face ID or fingerprint", `offline.tooOld` "Sign in online to continue — it's been more than 30 days.", `offline.locked` "{seconds, plural, one {Try again in # second} other {Try again in # seconds}}", `setupOffline.*` for the setup page (title "Set up offline use", password rules "At least 8 characters. Not a short number code.").

- [ ] **Step 1: Write failing tests** (React Testing Library, `fake-indexeddb`, fetch stubbed to fail): `"offline, the sign-in lists this device's therapists and opens a space with its password"`; `"a wrong password says how many tries are left"`; `"a space last online 31 days ago asks for an online sign-in"`; `"signing out removes only your own space"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests + typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): offline sign-in and per-therapist spaces on shared devices`.

---

### Task 10: Web — reading from the space when offline

**Files:**
- Create: `apps/web/src/device/bundle.ts`, `apps/web/src/device/OfflineBanner.tsx`
- Modify: `apps/web/src/api/queries.ts` (`useToday`, `usePatients`, `usePatient`, `useTemplates`, `useTemplate`, `usePatientSessions`, progress queries: fall back to the space when offline or the request fails with a network error), edit pages and buttons (disabled with `offline.needsConnection` "Needs a connection" when offline)
- Test: `apps/web/test/offline-data.test.tsx`

**Interfaces:**
- Consumes: Task 5 bundle; Task 9 `useDevice`; Task 8 `syncVideos`, `wantedVideos`, `getContentMode`.
- Produces: `refreshBundle(space: OpenSpace, deviceId: string, lang: string): Promise<OfflineBundle>` (stores records `bundle`, `bundle_at`; removes ended spaces; then `syncVideos` when mode is local); `useBundleRefresh()` (on open-online, every 15 min while online, and `refreshNow()`); `offlineQuery<T>(name: keyof OfflineBundle | derived, select: (b: OfflineBundle) => T)`.
- Banner copy: `offline.saved` "Showing saved data from {time}" (design doc §5.3).

- [ ] **Step 1: Write failing tests**: `"offline, Today shows the saved sessions with the saved-data banner"`; `"offline, editing a protocol is disabled and says it needs a connection"`; `"a refresh removes spaces the server reports as ended"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Today, patients and protocols from the device when offline`.

---

### Task 11: Web — offline sessions and the shared outbox

**Files:**
- Modify: `apps/web/src/session/SessionPage.tsx` (launch: online `/launch` when online and no package needed; otherwise from the space's package), `apps/web/src/session/outbox.ts` (sealed IndexedDB outbox; migration of `emb.outbox.v1`), `apps/web/src/session/VideoStep.tsx` (play from cache via the same URL; network mode offline → Continue fallback)
- Create: `apps/web/src/session/package.ts`, `apps/web/src/session/preflight.ts`
- Test: `apps/web/test/offline-session.test.ts`

**Interfaces:**
- Consumes: Task 2 `SessionPackage`, `offlineParams`, `paramsWithinAllowed`; `@emb/progression` `decide`; Task 7 `sealToPublic`/`openWithPrivate`; Task 8 content index; Task 9 `useDevice`.
- Produces:
  - `launchFromPackage(pkg: SessionPackage, localHistory: (asid: string) => SessionPoint[], seed: () => number): LaunchPackage` — difficulty per step = `decide(step.progression, history, step.difficulty).to` clamped to `allowed.difficulty`; params from `offlineParams`; asserts `paramsWithinAllowed`.
  - `preflight(pkg, o: { online: boolean; hasVideo: (id, v) => Promise<boolean> }): Promise<{ ok: true } | { ok: false; missing: Array<{ ordinal: number; kind: "game" | "video"; title: string }> }>` — games are always present (precached); an upload video must be stored or the device online; YouTube needs online.
  - `outbox.enqueue(ticket, envelope)` / `enqueueView(view)` write `sealToPublic(device.outbox_public_key, item)`; `outbox.flush(privateKey)` sends oldest first; removes only on `accepted`/`duplicate`/`kept_for_review`; on 401 stops and sets `needsSignIn`; on network error stops; on 409 `session_id_reused` keeps the item marked `needs_help`.
  - Local planned-session state: after a session ends offline, the space records it done so Today moves to the next package.
- Copy: `run.preflight.missing` "{count, plural, one {One step isn't on this device:} other {# steps aren't on this device:}}", `run.preflight.startWithout` "Start without it", `run.preflight.wait` "Wait for a connection", header status `sync.waiting` "{count, plural, one {Will send # result} other {Will send # results}}", `sync.signIn` "Sign in to send waiting results".

- [ ] **Step 1: Write failing tests**:
  - `"a second offline session starts at the difficulty the server would choose"` (same results → same `decide` output as the API's)
  - `"offline params stay within the ticket"`
  - `"preflight names a video that isn't on the device when offline"`
  - `"the outbox is written with the public key and sent by whoever opens it"`
  - `"a 401 keeps the outbox and asks for sign-in"`
  - `"kept_for_review removes the item; a network error keeps it"`
  - `"old localStorage results move into the sealed outbox once"`
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests + typecheck — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): offline sessions from packages; sealed outbox anyone can send`.

---

### Task 12: Web — the Device page, header status, and review

**Files:**
- Create: `apps/web/src/routes/device.tsx`
- Modify: `apps/web/src/App.tsx` (`/settings/device`), `apps/web/src/routes/pages.tsx` (Settings link; Today review count chip), `apps/web/src/shell/ClinicShell.tsx` (status: offline / "Will send N" / "Updating…" / update ready), patient session history (`apps/web/src/routes/patients/*`) review badge with Accept / Exclude, `apps/web/src/demo/fake-api.ts` (`review_count: 0`, review fields null)
- Test: `apps/web/test/device-page.test.tsx`

**Interfaces:**
- Consumes: Tasks 6, 8, 9, 10, 11.
- Device page sections (spec §7.6): content mode radio; storage (used, free, videos count/size, games size, last update); Download everything (size, confirm); Remove downloaded videos (confirm); therapists on this device (name, clinic, last online, Remove — own, or any of a managed clinic); Install button (`beforeinstallprompt`) or iPad instructions.
- Copy keys under `device.*` in en and he; review badge `review.reason` ICU select over the eight reason strings; `review.accept` "Count it", `review.exclude` "Don't count it".

- [ ] **Step 1: Write failing tests**: `"switching to play from the network keeps games and says videos will stream"`; `"Download everything shows its size and asks first"`; `"a manager can remove another therapist's space; a therapist can't"`; `"a flagged result shows why and can be counted"`.
- [ ] **Step 2: Run** — Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** web tests, typecheck, `pnpm --filter @emb/web build:demo` — Expected: PASS.
- [ ] **Step 5: Commit** `feat(web): Device page, sync status and result review`.

---

### Task 13: End to end, ADR, docs

**Files:**
- Create: `apps/web/e2e/offline.spec.ts`, `docs/adr/0019-offline-devices.md`
- Modify: `apps/api/scripts/seed-dev.ts` (accounts `tamar@synthetic.test` and `oren@synthetic.test`, same clinic, each with one patient on a protocol [Tunnel Rush 60 s, Colour shapes]), `apps/web/e2e/start-api.ts` (`DEVICE_SECRET_KEY`), design doc (Claude Docs §9.8 and the device rows: PWA, spaces, v2 tickets, review flags)

- [ ] **Step 1: Write the e2e** (one browser context = one tablet; `context.setOffline`):
  - `"a therapist installs, goes offline, unlocks with her password and runs a session that uploads once online"` — tamar signs in online, sets an offline password, Device page shows Colour shapes stored; offline + reload → `/offline` lists Tamar → password → Today (saved-data banner) → run Tunnel Rush (skip via controls) and the video (plays from cache, "Watched to the end") → header "Will send 1 result"; online → "Saved"; API shows one game session.
  - `"a second therapist on the same tablet can't see the first one's patients but sends her waiting results"` — tamar runs a session offline and locks; offline oren unlocks his own space (tamar's patient absent); online sign-in as oren → tamar's result arrives credited to tamar.
  - `"play from the network: offline, a video step offers Continue"`
  - `axe` on `/offline`, `/setup-offline`, `/settings/device`; screenshots `60-offline-sign-in`, `61-device-page`.
- [ ] **Step 2: Run** `npx playwright test e2e/offline.spec.ts` — Expected: FAIL before seeds/flows are complete; iterate until PASS.
- [ ] **Step 3: Write ADR 0019** (decisions: PWA; spaces and keys; threat model; sealed outbox and anyone-can-send; ticket v2 allowed params; ticketed definer ingest and invariant 3; review flags; progression order; what's left for project 3 and the home program).
- [ ] **Step 4: Run** the full suites: db, api, web unit, typecheck, full e2e (background, ~12 min), `build:demo` — Expected: all pass.
- [ ] **Step 5: Commit** `test(e2e): offline sessions on a shared tablet; ADR 0019`.
