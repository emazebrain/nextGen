# ADR 0018 — Video library: videos as protocol steps, tagged by brain region, stored for local play

- Status: Accepted
- Date: 2026-11-07
- Design doc: §7 data model (`brain_region`, `video`, `video_i18n`, `file_object`, `video_view`; protocol step `step_type`), §9 Video Service, journey T2 ("Peek Peek → Video → Orbital Order")
- Plan: `docs/superpowers/plans/2026-11-07-video-library.md`

## Context

The product owner asked for videos that therapists add to protocols, chosen from a library filtered by hemisphere,
lobe and Brodmann area, with platform admins adding videos and tagging them. The design doc already named the
tables and the step shape but nothing was built: steps could only hold games, and Brodmann codes lived only inside
game manifests. The product owner also set a direction for the platform: content plays from the device, is fetched
again only when a new version exists, and a device that is offline for a long time can download everything at
once. That direction is split into three projects:

1. this one, the library and video steps (online first);
2. device-side storage of games and videos, with a per-device "play from this device / from the network" setting;
3. offline sync of results, protocols and settings.

## Decisions

**Sources: uploads and YouTube links.** An uploaded file (MP4 or WebM, up to 1 GiB) is the main path: it can be
kept on the device (project 2). A YouTube link is allowed for content already published there, stored as its
11-character id and played in a sandboxed `youtube-nocookie.com` embed with no popups or top navigation, so a
child can't leave the session through it. Every YouTube video is marked "Needs Internet" in the library, the
picker and the protocol, and the session says so and offers Continue when the device is offline.

**Versions.** `video.version` goes up when the media changes (a new upload, or a different YouTube id); editing
titles, regions, ages or status does not. Each file belongs to one version (`file_object.video_id`, `video_version`); file URLs carry `?v=<version>`,
serve that version's file (404 for a version that never had one), and are served with
`Cache-Control: private, max-age=31536000, immutable` and the file's sha256 as ETag; the launch package carries the
version and sha256 too. That is what project 2's device store keys on. A replaced file stays in storage, because a
session may be playing it.

**Storage behind one interface.** `FileStore` (`apps/api/src/files.ts`) with a local-disk implementation
(`FILE_STORE_DIR`) serves development, tests and the local version; the cloud cells add an S3 implementation with
deployment. Uploads stream to a temporary file and are renamed into place, so no partial file is ever visible;
byte ranges are served for seeking. Storage keys are `videos/<video id>/<version>-<random>.<ext>`: no patient data.

**Brain regions.** `app.brain_region` is the design doc's tree (hemisphere → lobe → Brodmann area) with a text
`path` (`left.frontal.ba44`) and a prefix index instead of `ltree`, so the local version needs no extension. It is
seeded with v1's mapping of areas to lobes for both hemispheres, plus the cerebellum (not a Brodmann area, but games
map to it). The mapping is an [Assumption] until a clinical advisor signs it off. Videos are tagged with tree nodes;
the filter takes one node and matches it and everything under it, or a lobe or area code (`code=ba44`) that
matches in both hemispheres, which the picker offers as "Both hemispheres".

**Who does what (RLS).** `app.is_platform_admin()` (an active `platform_admin` membership) guards every write to
the content tables. Signed-in staff read published videos. A video that a protocol uses stays readable after it is
archived, to anyone who can see that protocol, so running protocols keep playing it; the picker offers published
videos only, and the builder marks a step whose video is no longer published. An upload can't be published until
its file is in; the editor saves a new upload as a draft, uploads, then publishes, keeping the id across retries. Uploads are refused before a byte is stored when the caller isn't a platform admin.

**Steps.** `template_step` and `assignment_step` gain `step_type` (default `game`) and `video_id`; `game_id` and
`session_mode` become nullable, and the check is "a video step has only its video, a game step keeps the mode
rules". This is expand-only: existing rows and older apps, which never send `step_type`, stay valid. In the API
contract a step is a discriminated union, and a step without `step_type` is a game. New steps need a published
video; a template being edited may keep a video it already had.

**Views.** `app.video_view` records each watched video: version, start and end, seconds watched, completed or not,
and who ran the session. It is append-only (triggers) and audited, and the device's UUIDv7 `client_view_id` makes
retries idempotent. A planned session closes when every game step has a result and every video step a view. The
app keeps views in its own device outbox (`emb.outbox.views.v1`) until the server answers, like results. "Completed"
means the file played to its end; for YouTube, which gives no end signal without its script API, it means at least
80 % of the length the admin entered, and is unknown (null) when no length was entered. Every attempt, accepted or
refused, is also kept in `session_result_raw` (`envelope_version = 'video_view.1'`), so no view is dropped silently. A therapist's Skip or End on a video records the view as not completed.

**Samples.** Three synthetic clips (generated patterns; `scripts/make-sample-videos.sh`) ship with the seed and the
demo. No real people, no third-party footage.

## Consequences

- Project 2 can cache by `(video id, version, sha256)` and needs no API change; YouTube videos can never be cached.
- The S3 `FileStore` and signed CloudFront URLs are still to build with production deployment.
- HLS streaming (design doc §9) is not used yet: MP4 with byte ranges is enough at these sizes and simpler offline.
- A region taxonomy editor for admins (design doc tree editor) is not built; the tree is seeded by migration.
