# ADR 0019 — Offline therapist devices: an installable app, per-therapist encrypted spaces, sealed results

- Status: Accepted
- Date: 2026-11-07
- Design doc: §5.6 (session runner offline), §8.2 (30-day launch tickets with allowed parameters), §9.8 (on-device
  database, idempotent sync), §11 (security)
- Spec: `docs/superpowers/specs/2026-11-07-offline-device-design.md` (approved by the product owner)
- Plan: `docs/superpowers/plans/2026-11-07-offline-devices.md`
- Builds on: ADR 0018 (video library: versioned file URLs)

## Context

The product owner wants eMazeBrain to work fully offline on a therapist's device: open the app, see today's patients,
start a session and run it to the end with no connection, with games and videos playing from the device and fetched
again only when their version changes. Clinic tablets are shared by several therapists. The product owner chose an
installable web app now, with store wrappers possibly later; a "determined thief" threat model for data on the device;
that waiting results are sent by whoever next signs in online; and that results arriving after something changed are
kept and flagged, not dropped. Editing offline is project 3; the home program (parents' devices) comes next and must
reuse this device layer.

## Decisions

**Installable web app.** `vite-plugin-pwa` (injectManifest) builds a service worker that precaches the whole app,
every game frame bundle included, and serves the shell for navigations offline. API data is never cached by the
worker. A new build waits for the page to ask (never during a session). The demo build has no worker.

**Video store.** Cache Storage `emb-videos-v1`, keyed by the versioned URL, with an index keyed `(id, version)`: an
upcoming package may still play an older version while the library has a newer one. A version is stored only after
its sha256 matches; versions nothing wants are removed. The worker answers stored versions, with byte ranges. Per
device, "play from this device" (default when installed) or "from the network"; Download everything adds the library.
Video references (ids, versions, hashes) live outside the encrypted spaces so one sync serves everyone on the device.

**Spaces.** One IndexedDB database per therapist per clinic, every record AES-GCM encrypted with the space's data
key. The key is wrapped by the offline password (8+ characters, PBKDF2-SHA-256 600,000 iterations), by a passkey's
PRF output where the platform has it, and by a server space secret returned only to its owner online. Passwords must
be 8+ characters and not digits only (a number code falls to a copied disk in hours). Offline unlock
lasts 30 days after the last online sign-in; 5 wrong passwords lock for a minute, doubling (a usability guard; the
real protection against a copied disk is the password strength). Signing out ends and removes the space; a manager
can remove spaces of their clinic. The kid-mode PIN lives in the space. Server secrets are stored encrypted with
`DEVICE_SECRET_KEY` (not hashed: they must be returned).

**Sealed outbox; anyone can send.** Results and views go to one device outbox sealed to an ECDH P-256 public key, so
a session writes offline with nobody signed in online. The private key is wrapped by a device outbox secret that the
server gives to any active staff member of the device's organisation (devices belong to the organisation of whoever
registered them; spaces can be made only for its clinics), so whoever signs in next sends everything. Online launches
on a set-up device put the device in their tickets too, so a dropped connection mid-session is covered the same way.
If the device copy can't be written, the result is still sent and the screen says so. An entry
leaves only when the server stored it (accepted, duplicate, kept for review); a refusal keeps it as needing help.

**Offline sessions.** `/v1/offline/bundle` gives each space its caseload, protocols and session packages (the next 4
sessions per assignment and all in the next 14 days) without starting any. Packages carry v2 tickets (30 days) that
sign the therapist, the device and the allowed parameters: structural settings exact, difficulty within the step's
range, seed/practice/instructions free. Video steps carry tickets too. Game steps carry their recent counted results,
and the device replays `@emb/progression` over those plus its own results, in order, so a second offline session
starts where the server would put it. A pre-flight before the child gets the tablet names anything not on the
device.

**Ticketed ingest (invariant 3).** A v2 upload is authorised by the verified ticket, not by the uploader's view of the
patient: `app.act_for_ticket` checks the uploader is the ticket's therapist, or may use the ticket's device while the
therapist holds or held a space on it,
and narrow definer functions insert with `recorded_by` = the therapist and `uploaded_by` = the sender. Requests still
run under `SET LOCAL app.user_id`; no client clinic id is trusted. A view without a ticket still needs the sender to
treat the patient.

**Never dropped; flagged for review.** Every result or view is stored. A ticket is judged by when the session was
played (its start within the ticket's life, a day of clock slack), not when the upload arrives; a session played
after its pass expired is kept and flagged `ticket_expired`, and the pre-flight warns about it. It is flagged (`review_reason`) when it
arrives after consent was withdrawn, after the therapist left the care team or the clinic, after the assignment was
paused or ended, after the step changed or the session closed, when the same session was played twice, or with
parameters outside the ticket. A consent-withdrawn result counts for nothing until reviewed. Reviews are append-only;
the latest decides. Progression applies results in arrival order and never rewrites a decision; a hand-set difficulty
newer than the ticket wins. The two silent drops in the earlier code (an RLS-hidden patient answered "duplicate"; a
late view answered 409 and dropped) are gone.

**Offline reads.** Each read that has an offline answer falls back to the space: the bundle, or the last copy of what
the therapist saw online (progress, history). Today is computed on the device from the packages. A banner says when
data is saved data; writes are disabled with "needs a connection". Requests never pause offline
(`networkMode: "always"`), and `/v1/me` is re-asked every 15 s while the network is down. When it answers again, a
cookie of a different therapist than the open space's locks the space and ends that session, a 401 asks for sign-in,
and online answers are copied into a space only once `/v1/me` has confirmed its owner.

## Consequences

- Project 3 (offline edits) adds a write queue next to the outbox; the space and bundle shapes stay.
- The home program reuses this layer: a parent's space, the same content store and setting, packages with v2 tickets
  issued to the parent, the same outbox. Nothing here assumes the holder of a space is staff.
- Store wrappers (Capacitor) can reuse everything: only `content.ts`'s cache and `db.ts` would get native backends.
- Downloads are hashed in memory; very large uploads on low-memory tablets would need a streaming hash.
- WebAuthn PRF is not unit-tested (no WebAuthn in jsdom); the password path is covered end to end.
