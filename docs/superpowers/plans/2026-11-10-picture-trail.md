# Picture Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The picture-line memory game ("Picture Trail", working name) as a new eMazeBrain game, with the platform's new `age_band` parameter and the brain-region filter driving direction, target location and background.

**Architecture:** A new package `games/picture-trail` on the Game SDK. Pure modules handle the levels and pace (`config.ts`), the line geometry (`geometry.ts`), building rounds (`rounds.ts`), the round state machine (`engine.ts`, injected clock) and the metrics (`metrics.ts`). A Pixi renderer (`index.ts`) draws it and reports to Session Rules. The pictures are a curated Twemoji subset, generated into `pictures.ts`. The API adds `age_band` to launch params.

**Tech Stack:** TypeScript, Pixi 8, vitest, Playwright; Postgres-backed API tests.

**Spec:** `docs/superpowers/specs/2026-11-10-picture-trail-design.md`

## Global Constraints

- Games import only `@emb/game-sdk` (and their renderer); no network; Session Rules own time and lives; the clock starts on the "Tap to start" tap.
- Wording: "game-based activity"; no brain or clinical words on the child's screen.
- en + he strings; the line direction and timer side are physical (not mirrored).
- Pure modules: no clock, no I/O, deterministic from the seed.
- Twemoji graphics CC-BY 4.0: attribution in `games/picture-trail/NOTICE.md` and the manifest summary credits.
- Same commit author/committer/trailers as the repo norm; push to main.

## Review Focus

1. A small portrait phone with a diagonal and N=8 → N is capped so pictures stay ≥ 64 px, and the cap is recorded (Task 2 test `caps N on a small diagonal`).
2. A filter whose motion entries have no movement type 0 → falls back to the first entry (Task 3 test `falls back to the first motion entry`).
3. The child taps several wrong pictures in one answer run → one life per wrong tap; the run continues; the outcome is commission only if the match was never tapped (Task 4 test `wrong taps then the match`).
4. The session ends (timer or lives) mid-round → no further events, metrics computed from completed rounds (Task 4 test `ends mid-round cleanly`).
5. Age set exhausted in a long session → pictures may repeat across rounds but never within one (Task 3 test `reuses only after the set is used up`).

---

### Task 1: `age_band` platform parameter
**Files:** `packages/game-sdk/src/index.ts`, `apps/api/src/modules/sessions/routes.ts` (buildParams + loadLaunchRows), `apps/api/src/modules/offline/routes.ts`, `apps/web/src/demo/fake-api.ts`; Test: `apps/api/test/region-launch-api.test.ts` (new describe) or `apps/api/test/age-band-api.test.ts`.
**Interfaces:** `PlatformParams.age_band?: "4-6" | "7-9" | "10-12" | "13+"`; `ageBand(dob: string | null, today: Date): AgeBand` exported from `packages/contracts/src/sessions.ts` (pure; under 7 → "4-6", 7–9, 10–12, 13+; null → "10-12").
- [ ] Tests: `ageBand` boundaries (6y364d → 4-6, 7y → 7-9, 12y → 10-12, 13y → 13+, null → 10-12); launch params carry `age_band` from the patient's DOB; offline package params carry it; a birthday between packages is not a step change.
- [ ] Run → FAIL; implement; run → PASS; commit `platform: age_band launch parameter (picture-line game spec)`.

### Task 2: Pure core — levels, pace, geometry
**Files:** `games/picture-trail/{package.json,tsconfig.json}`, `src/config.ts`, `src/geometry.ts`; Test: `test/core.test.ts`.
**Interfaces:** `countForLevel(level): number` (3/4/5/6/8 by bands of 6); `showMs(level, ageBand, speedScale, override?): number`; `startLevel(difficulty): number` (1,4,8,14,20); `nextLevel(level, history: boolean[]): number` (2 up / 2 down); `MAX_LEVEL = 30`; `linePoints(dir, n, w, h, target?): { points: {x,y}[]; size: number; n: number; capped: boolean }`.
- [ ] Tests with the spec's exact values; `caps N on a small diagonal` (375×667, tldbr, N=8 → n < 8, size ≥ 64, capped true); evenly spaced points; perpendicular shift by 22% toward the target; no shift for an absent component.
- [ ] FAIL → implement → PASS → commit.

### Task 3: Pictures and rounds
**Files:** `scripts/pick-pictures.mjs` (copies the curated SVGs from `@twemoji/svg` and writes `src/pictures.ts`), `src/pictures.ts` (generated: `{ id, category, band, svg }[]`), `NOTICE.md`, `src/rounds.ts`; Test: `test/rounds.test.ts`, `test/pictures.test.ts`.
**Interfaces:** `picturesFor(band): Picture[]`; `directionsFor(params): Direction[]`, `targetsFor(params): Compass[]`; `buildRound(rng, ctx: { level, band, lures, directions, targets, used: Set<string> }): Round` → `{ direction, target, n, question: Picture[], answer: Picture[], matchQ, matchA, lure }`.
- [ ] Tests: band counts (≥48, +24 each), no excluded categories/ids, no duplicate ids; a round has no repeated picture and exactly one shared picture; match answer slot biased into the target half (over 500 seeds > 70%); `falls back to the first motion entry`; side-only defaults (right → ltr, left → rtl); `reuses only after the set is used up`; lures share the match's category.
- [ ] FAIL → implement → PASS → commit.

### Task 4: Engine and metrics
**Files:** `src/engine.ts` (state machine over an injected time: `tick(nowMs)`, `tap(slotOrNull, nowMs)`, emits events), `src/metrics.ts`; Test: `test/engine.test.ts`.
**Interfaces:** `TrailEngine` with `startRound(round, showMs)`, `tick(now): EngineEvent[]`, `tap(now): EngineEvent[]`; events `show {phase, slot, picture}`, `hide`, `cue`, `correct {rt}`, `wrong`, `miss`, `roundEnd {outcome, wrongTaps, rt}`; `computeMetrics(rounds: RoundRecord[]): Record<string, number>`.
- [ ] Tests: question run order and timing, no gap before the answer run, correct tap ends the round, `wrong taps then the match`, miss when the match passes, taps between pictures ignored, `ends mid-round cleanly`; metrics values for a fixed record list.
- [ ] FAIL → implement → PASS → commit.

### Task 5: Renderer, manifest, strings, registration
**Files:** `src/index.ts`, `src/manifest.ts`, `src/strings.ts`; `packages/game-runtime/frames/picture-trail.ts` + package.json dep; `apps/web/src/games/registry.ts` + package.json dep; `apps/api/src/games.ts`; `apps/web/src/routes/protocols/steps.tsx` (lock `direction` param under a filter when `regionUse.direction`); demo template; Test: `test/manifest.test.ts`, `apps/web/test/step-region.test.tsx` (direction locked), game-runtime frame build.
- [ ] Tests: manifest params valid and match the spec (regionUse, lifeLossEvents `wrong_picture`, `missed_match`); en/he strings have the same keys; builder locks `direction` under a filter.
- [ ] Implement renderer per spec Look; build frames; FAIL → PASS → commit.

### Task 6: Browser check, ADR, docs
**Files:** `apps/web/e2e/library.spec.ts` (Picture Trail preview plays a round), `docs/adr/0021-picture-trail.md`, design doc §8.4 game list.
- [ ] e2e: open `/library/picture-trail`, start the preview, see pictures appear one at a time and the answer cue; screenshot. Full suites + full e2e green. Commit, push.
