# Reports dashboard redesign — design

Status: draft for approval (2026-11-23). Extends design doc §5.9.2. Mockup: "Reports Dashboard Mockup" artifact (version 5).

## Intent

Reports is a clinical tool first: a therapist opens it to decide what to do next, not to count activity. Today's page (`apps/web/src/routes/reports.tsx`) shows four totals, a sessions-per-period bar chart and a per-activity table. It answers "how much happened" and nothing about which patient needs attention.

The page should answer three questions, in this order:

1. Who is worth a look today?
2. How is each patient on my caseload doing?
3. Is the plan being followed?

## Goals

- A caseload-first page: an attention list, then one row per patient, then plan adherence, then the activity mix.
- Every comparison is with the child's own earlier sessions (§11.6).
- The glass look from the approved mockup, on top of the platform background (Admin → Appearance, migration 0040).
- Works in light and dark, LTR and RTL, and at phone width.

## Non-goals

- The PDF progress note (§5.9.2 export). It is per patient and is a separate piece of work.
- Applying the glass look to other screens. Reports is first; the rest follow as their own change.
- New tables. Everything reads `game_session`, `game_session_review`, `planned_session`, `progression_decision` and the care team.

## Anti-goals

- Red/green "at risk" flags, age norms, percentiles, or any ranking of children against each other (§11.6, invariant 9).
- Patient data in logs, analytics or error reports (invariant 7).
- Glass that costs legibility: numbers, chips, chart marks and table text are always fully opaque.

## What the page shows

**Top row — four tiles**

| Tile | Value | Graphic |
|---|---|---|
| Sessions | counted sessions in the range; "N this week" | six weekly bars, current week highlighted and labelled |
| Active patients | patients with a counted session in the range; "of N in care" | stack of up to four initials avatars and "+N" |
| Plan followed | done ÷ (done + missed) planned sessions in the range | 270° arc gauge |
| Average session | mean `active_ms`, in minutes | six-week area line |

**Worth a look** — one row per patient who has at least one reason, most reasons first, then oldest last session. Reasons, each a neutral chip (only "waiting for review" uses the warning tone):

| Reason | Rule |
|---|---|
| Results waiting for review | ≥ 1 flagged result with no decision (the existing review queue) |
| Planned sessions missed | ≥ 1 `planned_session` with status `missed`, or still `planned` with `planned_date` before today, in the last 7 days; home and clinic named separately |
| No recent sessions | active assignment and no counted session for 14 days |
| Below own earlier sessions | trend summary `declining` (`@emb/metrics` `trend`, accuracy view) |
| Difficulty stepped down | the last two progression decisions for the patient are both `down` |

The row's button is "Review" when a result is waiting (opens the review queue filtered to the patient), otherwise "Open" (the patient's Progress page).

**Caseload** — one row per patient the caller may treat, sortable by any column, row opens Progress:

- Patient (avatar, name)
- Last 8 sessions: sparkline of the accuracy-view score against the child's own baseline (dashed line), endpoint emphasised
- Trend: `improving` / `steady` / `declining` → "Below earlier sessions" / `not_enough` → "Not enough sessions yet"
- This week: done of planned (pips + "2 of 3")
- Difficulty: current level and the direction of the last change
- Last session: relative day

**Planned and done, per week** — six weeks; stacked bars for done in clinic and done at home, a dashed marker for planned.

**Game-based activities** — the existing breakdown as horizontal bars: sessions and average accuracy.

Controls: scope ("My caseload" / "Whole clinic", the latter for clinic managers and org admins only) and date range (7 days, 30 days, 3 months; default 30 days).

## Approaches considered

1. **One caseload endpoint, trends computed on the server with `@emb/metrics`** — chosen. One request, one place for the rules, and the browser receives only the summary each row needs.
2. **Compute in the browser from each patient's sessions** — rejected. One request per patient is slow for a whole clinic and ships far more clinical data to the device than the page shows.
3. **SQL-only trend calculation** — rejected. It would duplicate the baseline and scoring logic that `@emb/metrics` already owns and tests.

## How it is built

**API** (`apps/api/src/modules/sessions/routes.ts`, beside the existing report routes; all through `withUser`, RLS in force, patients limited by `app.can_treat_patient`, or the clinic for managers when `scope=clinic`):

- `GET /v1/reports/caseload?clinic=&scope=mine|clinic&from=&to=` →
  `{ patients: CaseloadRow[] }` where
  `CaseloadRow = { patient_id, given_name, family_name, scores: (number|null)[] (≤ 8), baseline: number|null, summary: Summary, week: { done, planned }, difficulty: number|null, last_change: "up"|"down"|null, last_session_at: string|null, reasons: Reason[] }` and
  `Reason = { kind: "review"|"missed_home"|"missed_clinic"|"inactive"|"declining"|"stepped_down", count?: number, days?: number }`.
- `GET /v1/reports/adherence?clinic=&scope=&weeks=6` → `{ weeks: { week_start, planned, done_clinic, done_home }[] }`.
- `GET /v1/reports/summary` gains `from`/`to`/`scope`, and returns `plan_followed` (0–1 or null), `in_care` and `weekly: { week_start, sessions, avg_duration_ms }[]` alongside today's fields.

**Pure logic** (`packages/metrics`): `caseloadRow(sessions, decisions, planned, review, games, now)` builds one `CaseloadRow` from plain inputs — no clock, no I/O, fully unit-tested (CLAUDE.md "keep packages pure"). The route only loads rows and calls it.

**Web**

- `routes/reports.tsx` is rewritten around the four sections; small chart components (`Sparkline`, `ArcGauge`, `WeekBars`, `MiniArea`) live in `routes/reports/` as hand-drawn SVG, like `TrendChart` today. No chart library.
- Glass: new tokens in `packages/ui` `tokens.css` (`--glass`, `--glass-solid`, `--glass-stroke`, `--glass-well`, light and dark) and a `.emb-glass` utility. Reports opts in; on devices without `backdrop-filter`, or when no platform background is set, tiles fall back to the existing solid card.
- ICU messages for every string, in `en` and `he`; logical properties only; charts are not mirrored in RTL except their labels.
- The demo build's fake API answers the three routes with synthetic data.

## Constraints

- Invariants 2, 3, 7, 9, 10. No migration is needed.
- Results that don't count (excluded, or awaiting review) stay out of scores, totals and trends, as on Progress.
- A patient with fewer than three scored sessions shows "Not enough sessions yet" and never a trend.

## Dependency

The API tests for the report routes run against row-level security. That suite is currently failing on `main` for reasons unrelated to Reports (the policies left by migrations 0033–0039). The endpoints here are built and verified only after that fix lands; the pure `@emb/metrics` logic and the web components can proceed first.

## Left to the builder

- Exact SQL for loading the last eight scored sessions per patient in one query.
- Tile and table breakpoints below 900 px.
- Whether "Whole clinic" remembers its last value per user (default: not remembered).
