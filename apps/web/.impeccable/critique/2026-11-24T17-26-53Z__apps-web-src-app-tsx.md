---
target: the application UI (apps/web)
total_score: 22
max_score: 40
na_heuristics: 
p0_count: 0
p1_count: 4
target_identity: "file:/home/claude/nextgen/apps/web/apps/web/src/App.tsx"
timestamp: 2026-11-24T17-26-53Z
slug: apps-web-src-app-tsx
---
Method: dual-agent (A: independent design review · B: detector and measured browser evidence)

# Design critique: eMazeBrain web app — 22/40

## Heuristics
1 Visibility of system status 2 — Calendar/Messages have no error branch (calendar.tsx:157, messages.tsx:27); Today says "all caught up" beside an overdue session.
2 Match real world 3 — parents get clinician columns ("Ended: Out of hearts").
3 User control 2 — session PIN gate has no back; parent portal has no sign-out.
4 Consistency 2 — undefined-token areas; "Carter, Eli" vs "Eli Carter"; two date formats; three back-link styles.
5 Error prevention 3 — new template defaults to Platform-wide.
6 Recognition 2 — patients list shows no protocol/next session/last activity.
7 Flexibility 2 — no sort/filter on patients; nine unsearchable templates.
8 Aesthetic/minimal 2 — repeated labels; unstyled Messages.
9 Error recovery 3 — parent errors are a bare sentence (parent/shell.tsx:36-50).
10 Help 1 — one sentence.

## Design specificity
Clinical core (progress, Reports, consent, assign step 2) is product-specific. Shell, Patients, Protocols, Library, Settings are a generic admin kit. Parent portal, Messages, Calendar are unfinished.
Detector: 3 side-tab hits (app.css:2834 .cal-event, app.css:3056 .cal-week__event, packages/ui components.css:222 .emb-alert), all functional stripes. In-page: footer.app-footer contrast 2.49:1 (opacity .6) on every page.

## Priority issues
- [P1] Undefined CSS custom properties in apps/web/src/styles/app.css ~2232-3100 (--border 24, --surface 9, --surface-raised 8, --text-sm 14, --on-accent 5, --radius-md, --text-muted, --space-5; --accent only defined inside .rdoc). Parent tab bar transparent; message bubbles unstyled; dark calendar events invisible (.cal-color--* line 2782). Fix: map to real tokens in packages/ui/src/styles/tokens.css, add dark values, lint undefined properties. → polish
- [P1] Parent portal is a data dump: no header/clinic/sign-out/language/help; results show Protocol/Difficulty/Ended; parent/messages.tsx and parent/progress.tsx exist but are not routed in App.tsx. → shape, clarify
- [P1] Session start dead-end: /session/:id PIN setup has no back; Today has no times, overdue not in Needs attention, repeated step names. → harden
- [P1] Phone: patient Progress is 690px wide at 390px (.progress-tiles app.css:1404 minmax(180px,1fr)); clinic name clipped in top bar. → adapt
- [P2] Lists don't support "what next": patients list columns, no sort/filter; protocol cards only Duplicate; assign step 1 nine identical cards. → layout

## Persona red flags
Therapist: no times on Today; PIN wall; no start-session from patient page; calendar Start is 12px link.
Parent on phone: no identity; transparent tab bar; jargon; no messaging/sign-out.
Keyboard/screen reader: nested main in messages.tsx:75; unlabelled unread count; colour-only appointment swatches.

## Minor
Phone targets under 44px: a.nextup__name, a.rcase__name (24-27px), button.cal-view-btn (36px), button.cmdpal-trigger (44x32), a.app-topbar__mobilebrand (28px). Hebrew kbd renders "K⌘". Near-duplicate sizes 14/14.4, 17.6/18. Progress report language default; game preview language.

## Questions
Should Worth a look/Caseload be the home screen? Does the parent portal need tabs? Where are the games in the Library cards?

## Not checked
Glass look (no platform background in demo); calendar week/month; gameplay; org admin; parent registration; password reset; role-specific nav. Calendar/Messages/parent portal reviewed on stand-in data.
