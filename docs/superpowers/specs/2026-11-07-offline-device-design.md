# Offline therapist devices — design (project 2 of 3)

- Date: 2026-11-07
- Status: Approved by the product owner, 2026-11-07
- Design doc: §3 journey T1 (two taps to start), M1 ("download offline packs"), §5.6 (session runner: "Offline: results stored on the device with a 'Will sync' indicator", "Peek Peek isn't on this device"), §8.2 (launch ticket: "valid up to 30 days so play works offline … the allowed parameter ranges"), §9.8 (on-device database with idempotent sync), §11 (security)
- Builds on: ADR 0018 (video library; versioned file URLs, `(video id, version, sha256)`)

## 1. Intent

Therapists often work where the internet is weak or missing. The product owner wants eMazeBrain to work **fully
offline** on a therapist's device: open the app, see today's patients, start a session and run it to the end, with no
connection. Games and videos play from the device and are downloaded again only when a new version exists. A device
that will be offline for a long time can download everything at once. A per-device setting chooses between keeping
content on the device and playing it from the network, so a device with little storage still works online.

The app is installed like an application from the browser (an installable web app, "PWA") on iPad, Android, Windows,
Mac and Chromebook. Store apps (iOS/Android wrappers) may come later and must be able to reuse everything built here.

**Clinic tablets are shared** between several therapists.

## 2. Goals

1. **Installable.** The web app can be installed from the browser, has its own icon, opens full screen and starts with
   no connection once it has been opened online.
2. **Works fully offline for a therapist who signed in on this device in the last 30 days:** Today, patient list and
   patient overview (read-only), protocols (read-only), progress (last saved data), and running sessions end to end.
3. **Content on the device.** Game bundles are always on the device. Videos follow the device setting:
   - *Play from this device* (default on a newly installed app): every video used by the protocols of the signed-in
     therapists' patients is downloaded automatically; **Download everything** also downloads the whole published library.
   - *Play from the network*: videos stream; nothing large is stored; offline, a video step says it needs the Internet
     and offers Continue (as YouTube steps already do).
   Content is downloaded again only when its version changes.
4. **Shared tablets.** Each therapist who signs in on a device gets a separate, encrypted space holding their caseload,
   protocols and upcoming sessions. Games and videos are stored once and shared. Offline, the sign-in screen lists this
   device's therapists; a therapist taps their name and unlocks with Face ID / fingerprint or their offline password.
   **Results waiting on the device are sent by whoever next signs in online on it** and stay credited to the therapist
   who ran the session (product owner, 2026-11-07).
5. **Offline sessions are real sessions.** Results and views recorded offline upload without duplicates when the
   device is online, and are attributed to the right planned session, step, parameters and therapist.
6. **A Device page** in settings: the setting, what is stored and how much space it takes, last update, Download
   everything, Remove downloaded videos, and the list of therapists with a space on this device.

## 3. Non-goals (this project)

- **Editing offline.** Creating or editing patients, protocols, assignments or settings needs a connection; offline,
  those actions are disabled with a short explanation. Syncing offline edits is **project 3**.
- **The home program and parent devices.** Parents can't sign in yet; the home program (parent accounts, a therapist
  sending a home program, kid mode at home) is the **next project after this one**, by the product owner's decision
  (2026-11-07). See §10: it must reuse this device layer.
- Store apps, MDM deployment, background sync while the app is closed.
- The public demo (it runs inside a claude.ai artifact, where a service worker can't be installed); the demo keeps
  working online as today.

## 4. Anti-goals — a failure even if it "works"

- Patient data from one therapist readable by another therapist on a shared tablet, or by anyone without the passcode.
- A result recorded offline that is lost, duplicated, or attached to the wrong session or parameters. This includes
  the two silent drops in today's code, which this project fixes: a result for a patient the uploader no longer sees
  through RLS is logged as a conflict and answered "duplicate" (so the device deletes it), and a video view answered
  409 `session_closed` is dropped by the outbox.
- Results waiting on a shared tablet for weeks because the therapist who ran them hasn't signed in there again.
- A session that starts and then stalls because a game or video turns out not to be on the device. Missing content is
  found **before** the session starts (pre-flight), never in the middle.
- Re-downloading the whole video library because one video changed.
- A device that silently runs out of space mid-download and leaves half-written files that look complete.

## 5. Constraints

- CLAUDE.md invariants, especially: no patient data in logs or analytics; idempotent ingest by device UUIDv7; Session
  Rules own time and lives; games import only `@emb/game-sdk` and do no I/O (the host passes bundles in); RTL/i18n.
- Design doc §8.2: launch tickets are Ed25519 JWS signed by the regional cell, valid up to 30 days for offline play,
  carrying allowed parameter ranges; exact parameters and their hash travel in the results envelope.
- Browser storage: Cache Storage and IndexedDB are the only stores available to an installed web app on all target
  platforms. The app must call `navigator.storage.persist()` and show the real usage and quota from
  `navigator.storage.estimate()`. Safari can evict data of sites that are not installed; installing is part of setup.
- The 15-minute idle lock (§11.2) stays.
- Expand/contract migrations only; RLS on every new table.

## 6. Approaches considered

| | Approach | Trade-off |
|---|---|---|
| 1 | **Installable web app (PWA)** — service worker, Cache Storage, IndexedDB | One codebase, all platforms, no stores, automatic updates. iPad storage is less controllable than a native app. |
| 2 | Store apps from the start (Capacitor iOS/Android + desktop installer) | Native file storage and MDM; costs store accounts, reviews, signing, pipelines, slower first delivery. |
| 3 | PWA now, store wrappers later | Same as 1 for this project; the offline layer is written so a wrapper can reuse it. |

**Chosen: 1/3** (product owner, 2026-11-07): "start with the PWA version; maybe later another option." Everything
below lives in the web app; nothing depends on a native shell, and the storage layer sits behind an interface a
wrapper could re-implement.

## 7. Design

### 7.1 App shell offline

- A service worker precaches the built app (HTML, JS, CSS, fonts, icons, i18n catalogs, and every game frame bundle,
  which are already part of the build). It serves the app shell for every navigation when offline.
- A web app manifest (name, icons, `display: standalone`, theme colour, `lang`/`dir` per locale) makes it installable.
- **Updates:** when a new build is available the app shows "An update is ready" and applies it on the next start, or
  at once from that prompt — never in the middle of a session.
- API requests (`/v1/*`) are **not** cached by the service worker as HTTP responses; offline data comes from the
  device database (§7.3). Exceptions: video files (§7.2).

### 7.2 Content store (shared by everyone on the device)

- **Games:** precached with the app (§7.1), so their version is the build's version; nothing else to do.
- **Videos:** stored in a dedicated Cache Storage cache, keyed by the versioned URL `/v1/videos/:id/file?v=N`.
  An index in IndexedDB records `{video_id, version, sha256, bytes, stored_at, last_used_at}`.
  - A download is written to the cache only after its sha256 matches the server's; a mismatch or a failure leaves no
    entry. Downloads run one at a time with progress, can be paused by going offline, and resume from where the list
    left off (whole-file retry; byte-range resume is not required).
  - The service worker answers requests for a stored version from the cache, including `Range` requests (video
    seeking), so the `<video>` element works the same online and offline.
  - When the library reports a newer version, the new file is downloaded; the old one is removed once nothing on the
    device still references it (an upcoming session package may still point at the old version).
  - YouTube videos are never stored.
- **What to download:** the union, over all spaces on the device, of videos in those therapists' cached session
  packages; plus, after **Download everything**, every published library video. **Remove downloaded videos** clears
  the video cache (the next sync re-downloads what upcoming sessions need, if the setting is "this device").
- **Space:** before downloading, compare the total against `estimate()`; if it won't fit, download what upcoming
  sessions need first and show how much more space Download everything needs.
- The setting is stored per device (not per therapist): `device.contentMode = "local" | "network"`.

### 7.3 Device database and per-therapist spaces

- IndexedDB, one shared database for the content index and device settings, and one database **per therapist space**.
- **Threat model (product owner, 2026-11-07): a determined thief.** Data on the device must stay unreadable even to
  someone who copies the device's storage and attacks it offline, where in-app lockouts don't apply.
- **Encryption at rest:** each space has a random 256-bit data key. Records are stored AES-GCM encrypted (WebCrypto).
  The data key is wrapped by:
  - a **passkey** (WebAuthn with the PRF extension: Face ID, Touch ID, Windows Hello, Android biometrics) where the
    device supports it — the key material never leaves the platform authenticator;
  - an **offline password** of at least 8 characters, required where no PRF passkey is available and kept as a
    fallback everywhere (PBKDF2-SHA-256, ≥ 600,000 iterations, per-space salt; a 4–6 digit code is not accepted);
  - the server's **space secret** (§7.5), so an online sign-in opens the space without the passkey or password.
  Nothing readable about patients is stored outside a space; the space list shows only the therapist's display name.
  [Builder's call: record layout.]
- **What a space holds:** the therapist's `/v1/me`, caseload (patients on their care team, with what the patient
  overview shows), templates and assignments visible to them, upcoming **session packages** (§7.4), progress
  summaries already shown online (cached as last fetched), the planned-session state changes made offline, and the
  kid-mode PIN hash (moves here from `localStorage`, so each therapist has their own).
- **The device outbox is not inside a space**, so anyone can send it (goal 4). Results and views are written to a
  shared outbox encrypted to a **device outbox key pair**: the public key is stored in the clear, so a session can
  write offline; the private key is wrapped by a device secret the server hands to any staff member who signs in
  online on that registered device, so the outbox can only be read and sent online, by a signed-in person. An entry
  leaves the outbox only when the server has stored it (accepted, duplicate, or kept for review — never "rejected and
  forgotten").
- **A space is per therapist per clinic** (memberships are clinic-scoped). The space list shows the clinic name when a
  therapist has spaces for two clinics on one device.
- **Lifetime:** a space can be unlocked offline for **30 days after its last online sign-in**; after that it stays
  locked until the therapist signs in online. **Signing out locks the space and keeps it on the device** (product
  owner, 2026-11-09: "offline data should always be stored on the device with the relevant therapist until it was sent
  to the server; once it is on the server and not needed locally, it can be deleted"). Every waiting result or view is
  labelled with its therapist's account id (no patient data) and leaves the device only when the server has stored it.
  A space (saved copies of server data) can be removed by its therapist or a clinic manager of its clinic only while
  none of that therapist's results are waiting; the Device page shows how many wait per therapist. When the server
  reports that a membership has ended, that space is removed at the next online sign-in of anyone on the device; its
  therapist's waiting results stay and are sent as usual.
- **Wrong passwords:** 5 wrong offline passwords lock the space for 1 minute, doubling after each further 5. This is a
  usability guard; protection against a copied disk comes from the password length and passkeys, not the lockout.
- **Refresh:** whenever a therapist is signed in online, their space refreshes in the background: on sign-in, every
  15 minutes while the app is open and online, and from the Device page ("Update now").

### 7.4 Offline sessions

- **Session packages:** for each active assignment of the therapist's caseload, the device keeps launch packages for
  the next planned sessions — at least the next 4 per assignment, and every planned session in the next 14 days.
  [Builder's call: exact window, within the 30-day ticket life.]
- **Launch ticket v2 (server):** an offline package carries tickets valid for **30 days** that sign the planned
  session, step, patient, game, the therapist (`sub`) and device, the game's version range and the **allowed
  parameters**, not one exact parameter hash. The results envelope keeps carrying the exact parameters and their hash;
  ingest checks them against the ticket. Online launch keeps issuing the current exact-hash v1 tickets until clients
  move over (expand/contract). What the ticket allows [my call]:
  - **exactly as assigned:** game, mode, duration, lives, hemisphere, timer position, monochrome, trial window;
  - **difficulty:** any level within the game's scale and the step's progression rule bounds (it may move across
    offline sessions);
  - **free:** seed, and whether practice and instructions are shown (they depend on how many sessions were done and
    carry no clinical setting).
- **Difficulty offline** [my call]: the device applies `@emb/progression` (already pure and deterministic) to its own
  results, so a second offline session for the same patient starts at the difficulty the server would have chosen
  from the same results. That choice is provisional. The server keeps applying progression **in the order results
  arrive**, as it does today: `progression_decision` stays append-only and past decisions are never rewritten. A
  difficulty the therapist set by hand since the package was made wins over both. "Device equals server" is tested
  for the same results in the same order.
- **Starting offline:** Today and the patient overview read from the space. Pressing Start runs a **pre-flight** that
  checks every step's game bundle and video is on the device (or the device is online); if something is missing, it
  says which and offers to start with that step removed, or to wait for a connection.
- **During and after:** the session runner is unchanged. Results and views go to the space's outbox (as they do now,
  but per therapist) and upload when online. Planned-session state (in progress, done) is updated on the device so Today
  shows the right next session; the server's state wins after upload.
- **Clock:** offline results carry device timestamps as today; ingest accepts results played within the ticket's life.
- **Who may upload** (product owner, 2026-11-07: anyone signed in): the uploader must be a signed-in staff member on a
  registered device. Ingest authorises the write by the **verified ticket** (server-signed: patient, session, step,
  therapist), not by the uploader's RLS view of the patient, through a narrow `SECURITY DEFINER` ingest function.
  `recorded_by` is the ticket's therapist; a new `uploaded_by` column records who sent it. The request still runs
  under `SET LOCAL app.user_id` = the uploader (invariant 3); no client-supplied clinic id is trusted. Record this in an ADR.
- **Results that arrive after something changed** (product owner, 2026-11-07: keep and flag). A result or view is
  always stored. It is **flagged for review** when, at ingest: consent for the patient was withdrawn; the therapist is
  no longer on the patient's care team or no longer a member of the clinic; the assignment was paused or ended; the
  step was removed or changed; the planned session was cancelled or already completed by another result for the same
  step (the same session played on two devices — both are kept, the later one flagged) [my call for the last case].
  A result flagged because consent was withdrawn is left out of progress charts, progression and reports until it is
  reviewed. Reviews are append-only records (accept / exclude, who, when, note). A clinic manager and the patient's
  therapists see flagged results in the patient's session history and a count on Today.

### 7.5 Sign-in on a shared device

- **Online:** unchanged (email code, MFA). The first time a therapist signs in on an installed app, they set up
  offline unlock: a passkey (Face ID / fingerprint) where supported, and an offline password (8+ characters; separate
  from the kid-mode PIN). That creates their space. The server registers the device and keeps, per space, a **space
  secret** and, per device, the **device outbox secret**, both stored **encrypted with a server key** (not hashed, so
  they can be returned) and returned only to a signed-in user on that device (the space secret only to that space's
  owner) [my call]. They change only when a space or device is re-created, not on every sign-in, so an online sign-in
  can always open the space.
- **Offline:** the sign-in screen shows "No connection" and the list of therapists with a space on this device. Tap a
  name → passkey prompt (or password) → that space opens. The idle lock returns to this screen.
- An online session cookie still expires after 12 h; offline mode does not need it. When the connection returns, the
  app asks for an online sign-in before uploading if the cookie has expired; the outbox waits.

### 7.6 Device page (Settings → This device)

- **Content:** "Play from this device" / "Play from the network" (radio), with one line on what each means.
- **Storage:** used by eMazeBrain, free on the device, videos stored (count and size), games (size), last update.
- **Download everything** (with size) and **Remove downloaded videos**, each with a confirm.
- **Therapists on this device:** names, last online sign-in, "Remove" (own space; any space for a clinic manager).
- **Install:** if not installed, an "Install eMazeBrain" button where the browser supports it, and short instructions
  for iPad (Share → Add to Home Screen).
- A small status in the shell header: online/offline, "Will send N results" when the outbox is not empty, and
  "Updating…" while content downloads.

## 8. Server changes

1. `device` (id generated on the device, outbox public key, encrypted outbox secret, created/last seen) and
   `device_space` (device, user, clinic, encrypted space secret, created, last online sign-in, ended_at) with RLS: a
   user sees their own spaces; a clinic manager sees and ends spaces of their clinic. Expand-only migration.
2. `POST /v1/devices/register`, `GET /v1/devices/:id/secrets` (returns what the caller may have), and space
   end/list endpoints for the Device page and managers.
3. `GET /v1/offline/bundle?since=` returning, for the signed-in therapist: caseload, templates, assignments, session
   packages (with v2 tickets) and the list of video `(id, version, sha256, bytes)` those packages need; plus a library
   manifest for Download everything. `since` lets the device fetch only changes. [Builder's call: one endpoint or a few.]
4. Launch ticket v2 and the allowed-parameters check at ingest (§7.4), keeping v1.
5. Ticket-authorised ingest (`SECURITY DEFINER`), `uploaded_by`, never-drop handling of every refusal, the review flag
   and its append-only review records, and the session-history/Today review counts.

## 9. Testing

- Unit: content-store index and eviction rules, encryption round trip and wrong-passcode lockout, progression on the
  device equals the server's for the same inputs, ticket v2 range checks.
- API: bundle contents are limited to the caller's caseload (RLS); ticket v2 accepted within its allowed parameters
  and flagged/refused outside; a result uploaded by another therapist is stored and credited to the ticket's therapist;
  each "something changed" case is stored and flagged; a consent-withdrawn result is absent from progress until
  reviewed; nothing is answered "duplicate" unless it really is one; ended memberships are reported.
- e2e (Playwright with the browser set offline): install prerequisites (manifest, service worker), sign in online,
  download, go offline, reload, unlock with the passcode, run a session with a game and a video, come back online,
  results upload once; a second therapist on the same browser can't see the first one's patients but their sign-in
  sends the first one's waiting results; "Play from the
  network" offline shows the Continue fallback on a video step.

## 10. Next projects (keep in mind)

- **Project 3 — offline edits:** creating and editing patients, protocols, assignments and settings while offline,
  queued and synced with conflict rules.
- **Home program (product owner, 2026-11-07: "offline for therapists now and the home program next … keep this in
  mind"):** parent accounts and sign-in, the therapist sending a home program, kid mode at home, adherence on Today.
  A family's phone or tablet must use this same device layer: a space per signed-in person (parent), shared content
  store, the local/network setting, session packages with v2 tickets issued to the parent, and the same outbox.
  Nothing in this project may assume the person holding a space is staff.

## 11. Left to the builder

Service-worker tooling, IndexedDB library choice, exact record schema, refresh scheduling details, the package
window within the stated minimums, and copy (en + he) for every new screen and message.
