# It's Left, It's Right — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a fully playable laterality discrimination game where children identify left vs right on rotated body-part images, following the existing game architecture.

**Architecture:** Pure deterministic engine (`engine.ts`) drives a state machine (idle → showing → waiting → feedback → done). A Pixi.js renderer (`index.ts`) wires the engine to the SDK, drawing body-part SVGs with runtime rotation and horizontal flip for side generation. Difficulty scales across rotation range, time limit, body-part complexity, and age bands over 30 levels with a 2-correct-up / 2-wrong-down staircase.

**Tech Stack:** TypeScript, Pixi.js 8, `@emb/game-sdk`, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-its-left-its-right-design.md`

## Global Constraints

- Games import only `@emb/game-sdk`. No network access from games.
- Session Rules own time and lives (§8.1). Timer starts on first qualifying interaction, not on load.
- RTL and i18n from day one: CSS logical properties, ICU messages in en and he. Game timer side is physical, not mirrored.
- Wording: "game-based activity", never "assessment", "treatment", or "diagnosis" (§11.6).
- The Left/Right buttons are physical (not mirrored in RTL) — Left always screen-left, Right always screen-right.
- No real patient data outside production.
- Idempotent result ingest via device-generated UUIDv7 `session_id`.
- The hidden per-question timer starts when the image is fully visible, not on load.
- CW/CCW rotation bias: 80/20 strong bias.
- Horizontal flip (`scaleX: -1`) creates opposite-hand versions; only one side per pose is stored.

## Review Focus

1. **Timer-starts-too-early:** If the engine's `shownAt` is set before the fly-in animation completes, RT measurements and timeout deadlines will be wrong. The renderer must call `engine.imageReady(now)` only after the pop-in animation promise resolves — test that `tick()` before `imageReady()` never fires a timeout.
2. **Flip asymmetry on non-symmetric parts:** A horizontal flip of an ear or arm can produce an anatomically incorrect image if the SVG has asymmetric shading or text. The asset catalogue must mark any pose that cannot be flipped; the round generator must skip flip for those — test that `generateRound` never picks a flip-ineligible pose with the flipped side.
3. **Staircase at boundaries:** `nextLevel(1, [false, false])` must clamp to 1, `nextLevel(30, [true, true])` must clamp to 30 — test both.
4. **Button side independence from locale:** The "Left" button must be at screen-left and "Right" at screen-right regardless of the `lang` param (en or he). Test by inspecting DOM/style in both locales.
5. **Age-band filtering leaves no body parts:** If a therapist restricts to `body_parts: ["ear"]` for a 5-year-old (age band "4-6"), the available set is empty since ears require 10+. The round generator must fall back to all eligible parts for the age band — test this edge case.

---

### Task 1: Package scaffolding and asset catalogue

**Files:**
- Create: `games/its-left-its-right/package.json`
- Create: `games/its-left-its-right/tsconfig.json`
- Create: `games/its-left-its-right/src/assets.ts`
- Create: `games/its-left-its-right/test/assets.test.ts`

**Interfaces:**
- Consumes: `@emb/game-sdk` types (`GameManifest`, `PlatformParams`)
- Produces:
  - `type BodyPart = "hand" | "arm" | "foot" | "ear"`
  - `type AgeBand = "4-6" | "7-9" | "10-12" | "13+"`
  - `type Side = "left" | "right"`
  - `interface Pose { id: string; bodyPart: BodyPart; minBand: AgeBand; svgFile: string; canFlip: boolean }`
  - `const POSES: Pose[]` — the full catalogue
  - `function posesFor(ageBand: AgeBand, bodyParts?: BodyPart[]): Pose[]` — filters by age band and optionally by allowed body parts
  - `const BAND_ORDER: Record<AgeBand, number>` — for band comparison

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@emb/game-its-left-its-right",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./manifest": "./src/manifest.ts"
  },
  "scripts": { "test": "vitest run" },
  "dependencies": {
    "@emb/game-sdk": "workspace:*",
    "pixi.js": "^8.9.0"
  },
  "devDependencies": {
    "typescript": "^5.8.0",
    "vitest": "^3.2.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "noEmit": true, "allowImportingTsExtensions": true, "declaration": false, "lib": ["ES2023", "DOM", "DOM.Iterable"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Write the failing test for `posesFor`**

In `test/assets.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { POSES, posesFor, type BodyPart, type AgeBand } from "../src/assets.ts";

describe("POSES catalogue", () => {
  it("has at least 8 hand poses, 4 arm, 3 foot, 3 ear", () => {
    const count = (bp: BodyPart) => POSES.filter(p => p.bodyPart === bp).length;
    expect(count("hand")).toBeGreaterThanOrEqual(8);
    expect(count("arm")).toBeGreaterThanOrEqual(4);
    expect(count("foot")).toBeGreaterThanOrEqual(3);
    expect(count("ear")).toBeGreaterThanOrEqual(3);
  });
  it("every pose has a unique id and a svgFile ending in .svg", () => {
    const ids = POSES.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const p of POSES) expect(p.svgFile).toMatch(/\.svg$/);
  });
  it("all poses have canFlip = true (initial set)", () => {
    for (const p of POSES) expect(p.canFlip).toBe(true);
  });
});

describe("posesFor", () => {
  it("returns only hands for band 4-6", () => {
    const ps = posesFor("4-6");
    expect(ps.length).toBeGreaterThan(0);
    for (const p of ps) expect(p.bodyPart).toBe("hand");
  });
  it("returns hands + arms + feet for band 7-9", () => {
    const ps = posesFor("7-9");
    const parts = new Set(ps.map(p => p.bodyPart));
    expect(parts).toContain("hand");
    expect(parts).toContain("arm");
    expect(parts).toContain("foot");
    expect(parts).not.toContain("ear");
  });
  it("returns all body parts for band 10-12 and 13+", () => {
    for (const band of ["10-12", "13+"] as AgeBand[]) {
      const parts = new Set(posesFor(band).map(p => p.bodyPart));
      expect(parts).toEqual(new Set(["hand", "arm", "foot", "ear"]));
    }
  });
  it("filters by allowed body parts", () => {
    const ps = posesFor("13+", ["foot", "ear"]);
    for (const p of ps) expect(["foot", "ear"]).toContain(p.bodyPart);
  });
  it("falls back to all eligible if filter leaves nothing (Review Focus #5)", () => {
    // ear requires 10+, so filtering to ear-only for 4-6 should fall back
    const ps = posesFor("4-6", ["ear"]);
    expect(ps.length).toBeGreaterThan(0);
    // fallback gives all eligible for the age band (hands)
    expect(ps[0]!.bodyPart).toBe("hand");
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test`
Expected: FAIL — module not found

- [ ] **Step 5: Implement `assets.ts`**

Define `BAND_ORDER = { "4-6": 0, "7-9": 1, "10-12": 2, "13+": 3 }`. Each pose has a `minBand`. `posesFor` filters `POSES` to those where `BAND_ORDER[minBand] <= BAND_ORDER[ageBand]`, then further filters by `bodyParts` if provided. If the filter empties the list, return the unfiltered (age-only) result.

The `POSES` array has these entries (all `canFlip: true`, all right-side canonical):

Hands (minBand "4-6"): thumbsup, pointing, openpalm, pinch, peace, fist, wave, grab
Arms (minBand "7-9"): extended, bent-elbow, reaching-up, reaching-down
Feet (minBand "7-9"): top-view, side-view, sole
Ears (minBand "10-12"): profile, angled, from-behind

SVG file pattern: `{bodyPart}-{pose}-r.svg`

- [ ] **Step 6: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test`
Expected: PASS

- [ ] **Step 7: Run `pnpm install` and commit**

```bash
cd /home/claude/emazebrain-v2 && pnpm install
git add games/its-left-its-right/
git commit -m "feat(its-left-its-right): scaffold package and asset catalogue

Pose catalogue with age-band filtering and body-part restriction.
Falls back to all eligible poses when filter leaves nothing."
```

---

### Task 2: Config — difficulty tables, timing, and staircase

**Files:**
- Create: `games/its-left-its-right/src/config.ts`
- Create: `games/its-left-its-right/test/config.test.ts`

**Interfaces:**
- Consumes: `AgeBand` from `assets.ts`
- Produces:
  - `const MAX_LEVEL = 30`
  - `function rotationRange(level: number): number` — max rotation degrees for a level (0–180)
  - `function timeLimit(level: number, override: number): number` — per-question time limit in ms
  - `function bodyPartsForLevel(level: number): BodyPart[]` — which body parts appear at this level
  - `function nextLevel(level: number, sinceChange: boolean[]): number` — 2-up/2-down staircase
  - `const clamp: (v: number, lo: number, hi: number) => number`

- [ ] **Step 1: Write the failing test**

In `test/config.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { MAX_LEVEL, rotationRange, timeLimit, bodyPartsForLevel, nextLevel, clamp } from "../src/config.ts";

describe("rotationRange", () => {
  it("levels 1-5 cap at 15°", () => {
    for (let l = 1; l <= 5; l++) expect(rotationRange(l)).toBe(15);
  });
  it("levels 6-10 cap at 45°", () => {
    expect(rotationRange(6)).toBe(45);
    expect(rotationRange(10)).toBe(45);
  });
  it("levels 26-30 cap at 180°", () => {
    expect(rotationRange(30)).toBe(180);
  });
});

describe("timeLimit", () => {
  it("levels 1-5 give 8000ms", () => {
    expect(timeLimit(1, 0)).toBe(8000);
  });
  it("levels 26-30 give 3000ms", () => {
    expect(timeLimit(30, 0)).toBe(3000);
  });
  it("override replaces auto, clamped to 2000-10000", () => {
    expect(timeLimit(1, 5000)).toBe(5000);
    expect(timeLimit(1, 500)).toBe(2000);
    expect(timeLimit(1, 99999)).toBe(10000);
  });
});

describe("bodyPartsForLevel", () => {
  it("levels 1-5: hands only", () => {
    expect(bodyPartsForLevel(1)).toEqual(["hand"]);
  });
  it("levels 6-10: hands + feet", () => {
    expect(bodyPartsForLevel(6)).toEqual(expect.arrayContaining(["hand", "foot"]));
    expect(bodyPartsForLevel(6)).not.toContain("ear");
  });
  it("levels 16+: all body parts", () => {
    expect(bodyPartsForLevel(16)).toEqual(expect.arrayContaining(["hand", "arm", "foot", "ear"]));
  });
});

describe("nextLevel (2-up/2-down staircase)", () => {
  it("two correct in a row → up", () => {
    expect(nextLevel(5, [true, true])).toBe(6);
  });
  it("two wrong in a row → down", () => {
    expect(nextLevel(5, [false, false])).toBe(4);
  });
  it("mixed → same", () => {
    expect(nextLevel(5, [true, false])).toBe(5);
  });
  it("clamps at 1 (Review Focus #3)", () => {
    expect(nextLevel(1, [false, false])).toBe(1);
  });
  it("clamps at 30 (Review Focus #3)", () => {
    expect(nextLevel(30, [true, true])).toBe(30);
  });
  it("needs at least 2 results", () => {
    expect(nextLevel(5, [true])).toBe(5);
    expect(nextLevel(5, [])).toBe(5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/config.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `config.ts`**

Lookup tables from the spec:
- Rotation: `[15, 15, 15, 15, 15, 45, 45, 45, 45, 45, 90, 90, 90, 90, 90, 135, 135, 135, 135, 135, 150, 150, 150, 150, 150, 180, 180, 180, 180, 180]`
- Time: `[8000, 8000, 8000, 8000, 8000, 6000, 6000, 6000, 6000, 6000, 5000, 5000, 5000, 5000, 5000, 4000, 4000, 4000, 4000, 4000, 3500, 3500, 3500, 3500, 3500, 3000, 3000, 3000, 3000, 3000]`
- Body parts by band of 5 levels.

`nextLevel`: same 2-correct-up / 2-wrong-down as Picture Trail.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/config.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add games/its-left-its-right/src/config.ts games/its-left-its-right/test/config.test.ts
git commit -m "feat(its-left-its-right): difficulty tables and staircase

Rotation range, time limit, body-part filtering, and 2-up/2-down
staircase matching the spec's 30-level difficulty table."
```

---

### Task 3: Round generation

**Files:**
- Create: `games/its-left-its-right/src/rounds.ts`
- Create: `games/its-left-its-right/test/rounds.test.ts`

**Interfaces:**
- Consumes: `posesFor` from `assets.ts`, `rotationRange`, `bodyPartsForLevel` from `config.ts`
- Produces:
  - `interface RoundSpec { pose: Pose; side: Side; rotationDeg: number; rotationDir: "cw" | "ccw"; correctSide: Side }`
  - `interface RoundContext { level: number; ageBand: AgeBand; bodyParts?: BodyPart[]; maxRotation?: number; rotationBias?: "cw" | "ccw"; rng: () => number }`
  - `function generateRound(ctx: RoundContext): RoundSpec`

- [ ] **Step 1: Write the failing test**

In `test/rounds.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { generateRound, type RoundContext } from "../src/rounds.ts";

const seededRng = (seed: number) => {
  let s = seed | 0;
  return () => { s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); s = Math.imul(s ^ (s >>> 16), 0x45d9f3b); return ((s ^ (s >>> 16)) >>> 0) / 0x100000000; };
};

const ctx = (overrides: Partial<RoundContext> = {}): RoundContext => ({
  level: 1, ageBand: "4-6", rng: seededRng(42), ...overrides,
});

describe("generateRound", () => {
  it("returns a valid RoundSpec with side, rotation, and pose", () => {
    const r = generateRound(ctx());
    expect(r.side).toMatch(/^(left|right)$/);
    expect(r.correctSide).toBe(r.side);
    expect(r.rotationDeg).toBeGreaterThanOrEqual(0);
    expect(r.rotationDeg).toBeLessThanOrEqual(15); // level 1 cap
    expect(r.rotationDir).toMatch(/^(cw|ccw)$/);
    expect(r.pose.bodyPart).toBe("hand"); // level 1, band 4-6
  });

  it("respects maxRotation override", () => {
    const r = generateRound(ctx({ level: 30, ageBand: "13+", maxRotation: 10 }));
    expect(r.rotationDeg).toBeLessThanOrEqual(10);
  });

  it("respects CW/CCW 80/20 bias over many rounds", () => {
    const rng = seededRng(1);
    const dirs = Array.from({ length: 200 }, () => generateRound({ ...ctx(), level: 15, ageBand: "13+", rotationBias: "cw", rng }).rotationDir);
    const cwCount = dirs.filter(d => d === "cw").length;
    // 80% ± some variance: expect at least 120 and at most 190
    expect(cwCount).toBeGreaterThan(120);
    expect(cwCount).toBeLessThan(190);
  });

  it("picks from level-appropriate body parts", () => {
    const parts = new Set(Array.from({ length: 50 }, () => generateRound(ctx({ level: 1, ageBand: "13+" })).pose.bodyPart));
    expect(parts).toEqual(new Set(["hand"])); // level 1 = hands only
  });

  it("at level 20, all body parts eligible (with age 13+)", () => {
    const rng = seededRng(7);
    const parts = new Set(Array.from({ length: 200 }, () => generateRound({ ...ctx(), level: 20, ageBand: "13+", rng }).pose.bodyPart));
    expect(parts.size).toBeGreaterThanOrEqual(3); // statistically should hit 4
  });

  it("side is roughly 50/50 over many rounds", () => {
    const rng = seededRng(99);
    const sides = Array.from({ length: 200 }, () => generateRound({ ...ctx(), rng }).side);
    const leftCount = sides.filter(s => s === "left").length;
    expect(leftCount).toBeGreaterThan(60);
    expect(leftCount).toBeLessThan(140);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/rounds.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `rounds.ts`**

1. Get eligible poses: `posesFor(ageBand, bodyParts)` intersected with `bodyPartsForLevel(level)`.
2. Pick a random pose from the eligible set.
3. Side: 50/50 via `rng() < 0.5 ? "left" : "right"`. If the canonical SVG is right-side, `side === "left"` means flip.
4. Rotation angle: `rng() * rotationRange(level)`, clamped by `maxRotation` if provided.
5. Rotation direction: `rng() < 0.8` goes with `rotationBias ?? "cw"`, else the opposite.
6. `correctSide` equals `side`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/rounds.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add games/its-left-its-right/src/rounds.ts games/its-left-its-right/test/rounds.test.ts
git commit -m "feat(its-left-its-right): round generation with rotation bias

Picks pose, side, rotation angle and direction per round.
80/20 CW/CCW bias. Respects age band and level body-part rules."
```

---

### Task 4: Pure engine

**Files:**
- Create: `games/its-left-its-right/src/engine.ts`
- Create: `games/its-left-its-right/test/engine.test.ts`

**Interfaces:**
- Consumes: `RoundSpec` from `rounds.ts`, `Side` from `assets.ts`
- Produces:
  - `type Phase = "idle" | "showing" | "waiting" | "feedback" | "done"`
  - `type EngineEvent = { type: "show"; spec: RoundSpec; at: number } | { type: "ready"; at: number } | { type: "correct"; rt: number; at: number } | { type: "wrong"; at: number } | { type: "timeout"; at: number } | { type: "roundEnd"; record: RoundRecord; at: number }`
  - `interface RoundRecord { bodyPart: BodyPart; pose: string; correctSide: Side; chosenSide: Side | null; rotationDeg: number; rotationDir: "cw" | "ccw"; rt_ms: number | null; level: number; outcome: "correct" | "wrong" | "omission" }`
  - `class LateralityEngine { startRound(spec: RoundSpec, level: number, timeLimit: number, now: number): EngineEvent[]; imageReady(now: number): EngineEvent[]; answer(side: Side, now: number): EngineEvent[]; tick(now: number): EngineEvent[]; stop(): void; get active(): boolean; get phase(): Phase }`

- [ ] **Step 1: Write the failing test**

In `test/engine.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { LateralityEngine, type EngineEvent, type RoundRecord } from "../src/engine.ts";
import type { RoundSpec } from "../src/rounds.ts";

const spec: RoundSpec = {
  pose: { id: "thumbsup", bodyPart: "hand", minBand: "4-6", svgFile: "hand-thumbsup-r.svg", canFlip: true },
  side: "left",
  rotationDeg: 30,
  rotationDir: "cw",
  correctSide: "left",
};
const kinds = (es: EngineEvent[]) => es.map(e => e.type);

describe("LateralityEngine", () => {
  it("startRound emits show; imageReady emits ready and starts the timer", () => {
    const e = new LateralityEngine();
    expect(kinds(e.startRound(spec, 5, 8000, 0))).toEqual(["show"]);
    expect(e.phase).toBe("showing");
    expect(kinds(e.imageReady(500))).toEqual(["ready"]);
    expect(e.phase).toBe("waiting");
  });

  it("correct answer emits correct + roundEnd with RT", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    const out = e.answer("left", 1200);
    expect(kinds(out)).toEqual(["correct", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.rt_ms).toBe(700); // 1200 - 500
    expect(rec.outcome).toBe("correct");
    expect(rec.correctSide).toBe("left");
    expect(rec.chosenSide).toBe("left");
  });

  it("wrong answer emits wrong + roundEnd", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    const out = e.answer("right", 1200);
    expect(kinds(out)).toEqual(["wrong", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.outcome).toBe("wrong");
    expect(rec.chosenSide).toBe("right");
  });

  it("timeout emits timeout + roundEnd when hidden timer expires", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    expect(kinds(e.tick(8499))).toEqual([]); // not yet
    const out = e.tick(8500); // 500 + 8000
    expect(kinds(out)).toEqual(["timeout", "roundEnd"]);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.outcome).toBe("omission");
    expect(rec.rt_ms).toBeNull();
    expect(rec.chosenSide).toBeNull();
  });

  it("tick before imageReady never fires timeout (Review Focus #1)", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    // imageReady not called yet — engine is in "showing" phase
    expect(kinds(e.tick(20000))).toEqual([]);
    expect(e.phase).toBe("showing");
  });

  it("answer during showing phase is ignored", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    expect(e.answer("left", 100)).toEqual([]);
  });

  it("stop() cancels the round", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 5, 8000, 0);
    e.imageReady(500);
    e.stop();
    expect(e.active).toBe(false);
    expect(e.tick(20000)).toEqual([]);
  });

  it("roundEnd record has all fields from spec", () => {
    const e = new LateralityEngine();
    e.startRound(spec, 12, 5000, 0);
    e.imageReady(100);
    const out = e.answer("left", 600);
    const rec = (out.find(x => x.type === "roundEnd") as any).record as RoundRecord;
    expect(rec.bodyPart).toBe("hand");
    expect(rec.pose).toBe("thumbsup");
    expect(rec.rotationDeg).toBe(30);
    expect(rec.rotationDir).toBe("cw");
    expect(rec.level).toBe(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/engine.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `engine.ts`**

State machine: `idle` → `showing` (after `startRound`) → `waiting` (after `imageReady`) → `feedback`/`done` (after `answer` or `tick` timeout). Pure: `now` is passed in. No `Date.now()`, no `setTimeout`. `imageReady(now)` records `readyAt` and starts the deadline at `readyAt + timeLimit`. `tick(now)` checks deadline only in `waiting` phase. `answer(side, now)` works only in `waiting` phase.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add games/its-left-its-right/src/engine.ts games/its-left-its-right/test/engine.test.ts
git commit -m "feat(its-left-its-right): pure deterministic engine

State machine: idle → showing → waiting → feedback.
Timer starts on imageReady(), not on round start.
Reports RoundRecord with all clinical fields."
```

---

### Task 5: Metrics computation

**Files:**
- Create: `games/its-left-its-right/src/metrics.ts`
- Create: `games/its-left-its-right/test/metrics.test.ts`

**Interfaces:**
- Consumes: `RoundRecord` from `engine.ts`
- Produces:
  - `function computeMetrics(records: RoundRecord[]): Record<string, number | null>`
  - Returns: `accuracy`, `omission_rate`, `wrong_rate`, `rt_correct_ms`, `left_accuracy`, `right_accuracy`, `hand_accuracy`, `rotation_effect_ms`, `best_streak`, `highest_level`

- [ ] **Step 1: Write the failing test**

In `test/metrics.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { computeMetrics } from "../src/metrics.ts";
import type { RoundRecord } from "../src/engine.ts";

const rec = (overrides: Partial<RoundRecord> = {}): RoundRecord => ({
  bodyPart: "hand", pose: "thumbsup", correctSide: "left", chosenSide: "left",
  rotationDeg: 30, rotationDir: "cw", rt_ms: 500, level: 5, outcome: "correct",
  ...overrides,
});

describe("computeMetrics", () => {
  it("computes accuracy, omission_rate, wrong_rate", () => {
    const records = [rec(), rec({ outcome: "wrong", chosenSide: "right" }), rec({ outcome: "omission", chosenSide: null, rt_ms: null })];
    const m = computeMetrics(records);
    expect(m.accuracy).toBeCloseTo(1 / 3);
    expect(m.wrong_rate).toBeCloseTo(1 / 3);
    expect(m.omission_rate).toBeCloseTo(1 / 3);
  });

  it("computes median RT for correct answers", () => {
    const records = [rec({ rt_ms: 400 }), rec({ rt_ms: 600 }), rec({ rt_ms: 800 })];
    const m = computeMetrics(records);
    expect(m.rt_correct_ms).toBe(600);
  });

  it("computes left_accuracy and right_accuracy", () => {
    const records = [
      rec({ correctSide: "left", outcome: "correct" }),
      rec({ correctSide: "left", outcome: "wrong", chosenSide: "right" }),
      rec({ correctSide: "right", outcome: "correct" }),
    ];
    const m = computeMetrics(records);
    expect(m.left_accuracy).toBeCloseTo(0.5);
    expect(m.right_accuracy).toBe(1);
  });

  it("computes best_streak and highest_level", () => {
    const records = [rec({ level: 3 }), rec({ level: 4 }), rec({ outcome: "wrong", level: 3, chosenSide: "right" }), rec({ level: 3 })];
    const m = computeMetrics(records);
    expect(m.best_streak).toBe(2);
    expect(m.highest_level).toBe(4);
  });

  it("returns null for rt_correct_ms with no correct answers", () => {
    const m = computeMetrics([rec({ outcome: "wrong", chosenSide: "right" })]);
    expect(m.rt_correct_ms).toBeNull();
  });

  it("returns nulls for empty input", () => {
    const m = computeMetrics([]);
    expect(m.accuracy).toBeNull();
  });

  it("computes rotation_effect_ms (median RT high-rotation minus low-rotation)", () => {
    const records = [
      rec({ rotationDeg: 10, rt_ms: 400 }),
      rec({ rotationDeg: 15, rt_ms: 420 }),
      rec({ rotationDeg: 100, rt_ms: 700 }),
      rec({ rotationDeg: 120, rt_ms: 750 }),
    ];
    const m = computeMetrics(records);
    // median low = 410, median high = 725 → effect = 315
    expect(m.rotation_effect_ms).toBe(315);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/metrics.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `metrics.ts`**

- `accuracy`: correct / total
- `omission_rate`: omissions / total
- `wrong_rate`: wrongs / total
- `rt_correct_ms`: median RT of correct answers
- `left_accuracy`: correct left / total left
- `right_accuracy`: correct right / total right
- `hand_accuracy`: correct hands / total hands
- `rotation_effect_ms`: split correct-answer RTs into low-rotation (< 45°) and high-rotation (≥ 45°), take median of each, return difference. Null if either group is empty.
- `best_streak`: longest consecutive correct run
- `highest_level`: max level reached

Use a `median()` helper (same approach as Picture Trail).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/metrics.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add games/its-left-its-right/src/metrics.ts games/its-left-its-right/test/metrics.test.ts
git commit -m "feat(its-left-its-right): metrics computation

Accuracy, omission/wrong rates, median RT, per-side accuracy,
hand accuracy, rotation effect, best streak, highest level."
```

---

### Task 6: Manifest, strings, and manifest test

**Files:**
- Create: `games/its-left-its-right/src/manifest.ts`
- Create: `games/its-left-its-right/src/strings.ts`
- Create: `games/its-left-its-right/test/manifest.test.ts`

**Interfaces:**
- Consumes: `GameManifest` from `@emb/game-sdk`
- Produces:
  - `const manifest: GameManifest` — with id `"its-left-its-right"`, maxLevel 30, all metrics, paramsSchema
  - `const strings: { en: Record<string, string>; he: Record<string, string> }`

- [ ] **Step 1: Write the failing test**

In `test/manifest.test.ts`:
```typescript
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.ts";
import { strings } from "../src/strings.ts";

describe("manifest", () => {
  it("has the spec's id, maxLevel, and age range", () => {
    expect(manifest.id).toBe("its-left-its-right");
    expect(manifest.maxLevel).toBe(30);
    expect(manifest.ageRange).toEqual([4, 16]);
  });

  it("declares region use: background, direction, and target location", () => {
    expect(manifest.regionUse).toEqual({
      background: { temperature: "bg_temperature", type: "background" },
      direction: true,
      targetLocation: true,
    });
  });

  it("declares life-loss events for wrong answer and timeout", () => {
    expect(manifest.lifeLossEvents.map(e => e.id)).toEqual(["wrong_answer", "no_answer"]);
  });

  it("has the spec's metrics", () => {
    const keys = manifest.metrics.map(m => m.key);
    expect(keys).toEqual([
      "accuracy", "omission_rate", "wrong_rate", "rt_correct_ms",
      "left_accuracy", "right_accuracy", "hand_accuracy",
      "rotation_effect_ms", "best_streak", "highest_level",
    ]);
  });

  it("has paramsSchema with spec's settings", () => {
    const p = manifest.paramsSchema.properties;
    expect(Object.keys(p).sort()).toEqual(["background", "bg_temperature", "body_parts", "direction", "max_rotation", "time_limit_ms"]);
    expect(p.time_limit_ms).toMatchObject({ minimum: 0, maximum: 10000, default: 0 });
    expect(p.max_rotation).toMatchObject({ minimum: 0, maximum: 180, default: 0 });
    expect(p.body_parts!["x-ui"]!.widget).toBe("multiselect");
  });

  it("asset packs: shared is real, warm/cold are stubs", () => {
    expect(manifest.assetPacks.shared).toBe("packs/shared/pack.json");
  });
});

describe("strings", () => {
  it("English and Hebrew have the same keys", () => {
    expect(Object.keys(strings.he).sort()).toEqual(Object.keys(strings.en).sort());
  });

  it("child-facing text uses only game-based-activity wording", () => {
    const text = JSON.stringify([manifest.name, manifest.summary, strings]);
    expect(text).not.toMatch(/assessment|treatment|diagnos|therapy|brain|אבחון|טיפול|מוח/i);
  });

  it("has left/right button labels in both locales", () => {
    expect(strings.en.left).toBe("Left");
    expect(strings.en.right).toBe("Right");
    expect(strings.he.left).toBe("שמאל");
    expect(strings.he.right).toBe("ימין");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/manifest.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement `strings.ts`**

Keys from the spec: `instructions.title`, `instructions.text`, `start`, `left`, `right`, `correct`, `wrong`, `practice`. Hebrew as specified.

- [ ] **Step 4: Implement `manifest.ts`**

Follow the Picture Trail manifest pattern. Key differences:
- `id: "its-left-its-right"`
- `regionUse`: background + direction + targetLocation (biases image position toward a screen region)
- `lifeLossEvents`: `wrong_answer` and `no_answer`
- `paramsSchema`: `time_limit_ms` (0 = auto, 2000–10000), `body_parts` (multiselect), `max_rotation` (0 = auto, 0–180), `bg_temperature`, `background`, `direction`
- `metrics`: the 10 metrics from the spec
- `taxonomy: { skills: ["laterality", "mental_rotation", "reaction_time", "spatial_awareness"], regions: [] }`
- `capabilities: { modes: ["timed", "lives", "timed_lives"], practice: true, rng: "seeded", monochrome: false }`
- `assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" }`

- [ ] **Step 5: Run test to verify it passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test -- test/manifest.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add games/its-left-its-right/src/manifest.ts games/its-left-its-right/src/strings.ts games/its-left-its-right/test/manifest.test.ts
git commit -m "feat(its-left-its-right): manifest and strings

SDK manifest with laterality metrics, paramsSchema, and
en/he child-facing text."
```

---

### Task 7: SVG body-part assets

**Files:**
- Create: `games/its-left-its-right/assets/` — one SVG per pose (18 files)

**Interfaces:**
- Consumes: pose catalogue from `assets.ts` for file naming
- Produces: SVG files referenced by `Pose.svgFile` in the catalogue

- [ ] **Step 1: Create hand SVGs (8 poses)**

Create 3D-cartoon-style SVG hand images (pink skin, gray sleeve with white cuff and buttons) for: `hand-thumbsup-r.svg`, `hand-pointing-r.svg`, `hand-openpalm-r.svg`, `hand-pinch-r.svg`, `hand-peace-r.svg`, `hand-fist-r.svg`, `hand-wave-r.svg`, `hand-grab-r.svg`.

Each 200×200 viewBox, transparent background, right-hand canonical orientation. The style must be consistent: 3D cartoon with soft shading, pink (#F5B7B1 / #E8967A) skin tones, gray (#7B8794) textured sleeve with white (#FFFFFF) cuff trim and two dark (#3D4852) buttons.

- [ ] **Step 2: Create arm SVGs (4 poses)**

`arm-extended-r.svg`, `arm-bent-elbow-r.svg`, `arm-reaching-up-r.svg`, `arm-reaching-down-r.svg`. Same style, 200×200.

- [ ] **Step 3: Create foot SVGs (3 poses)**

`foot-top-view-r.svg`, `foot-side-view-r.svg`, `foot-sole-r.svg`. Same style, 200×200.

- [ ] **Step 4: Create ear SVGs (3 poses)**

`ear-profile-r.svg`, `ear-angled-r.svg`, `ear-from-behind-r.svg`. Same style, 200×200.

- [ ] **Step 5: Verify all SVGs load without errors**

Run a quick Node script to parse each SVG:
```bash
node -e "const fs=require('fs'),path=require('path'),d='games/its-left-its-right/assets';for(const f of fs.readdirSync(d).filter(x=>x.endsWith('.svg'))){const s=fs.readFileSync(path.join(d,f),'utf8');if(!s.includes('<svg'))throw new Error(f+' is not valid SVG');console.log('OK',f)}"
```
Expected: all 18 files print OK.

- [ ] **Step 6: Commit**

```bash
git add games/its-left-its-right/assets/
git commit -m "feat(its-left-its-right): SVG body-part assets

18 right-side canonical poses: 8 hands, 4 arms, 3 feet, 3 ears.
3D cartoon style with pink skin and gray sleeve."
```

---

### Task 8: Pixi.js renderer

**Files:**
- Create: `games/its-left-its-right/src/index.ts`

**Interfaces:**
- Consumes: `LateralityEngine` from `engine.ts`, `generateRound` from `rounds.ts`, `computeMetrics` from `metrics.ts`, `posesFor` from `assets.ts`, `rotationRange`, `timeLimit`, `nextLevel`, `bodyPartsForLevel` from `config.ts`, `strings` from `strings.ts`, `manifest` from `manifest.ts`
- Consumes from SDK: `GameModule`, `InitContext`, `GameDefinition`, `SessionApi`, `TrialEvent`
- Produces: `default export: GameDefinition` (the game's entry point)

- [ ] **Step 1: Implement `index.ts`**

Follow Picture Trail's renderer pattern. Key structure:

1. **`init(ctx: InitContext)`**: create Pixi Application, load all SVGs as textures (from `ctx.assets`), build DOM buttons (Left/Right), set up engine.

2. **Buttons**: Two large buttons (min 80×60px) fixed at screen bottom. Left at `left: 0`, Right at `right: 0`. Physical positioning, NOT mirrored in RTL. Use `strings[lang].left` / `strings[lang].right` for labels. Distinct colours (e.g. blue-left, orange-right).

3. **Game loop** (`start()`): on "Tap to start" → `session.qualifyingInteraction()`. Then `nextRound()`:
   - `generateRound(ctx)` → `engine.startRound(spec, level, limit, now)`
   - On `show` event: create sprite from pose texture, apply rotation (`sprite.rotation = rotationDeg * Math.PI / 180 * (rotationDir === "cw" ? 1 : -1)`), apply flip if `side !== canonical` (`sprite.scale.x = -1`), fly in from direction, animate to centre.
   - On animation complete: `engine.imageReady(now)` → buttons become active.
   - On button tap: `engine.answer(side, now)`.
   - On `correct`/`wrong`/`timeout`: brief feedback text, then `session.trial(trialEvent)` + life-loss events → `nextRound()`.

4. **Trial events**: map engine `RoundRecord` to SDK `TrialEvent`:
   - `outcome`: `"correct"` → `"correct"`, `"wrong"` → `"error"`, `"omission"` → `"timeout"` (spec TrialOutcome mapping).
   - `tags`: `{ bodyPart, pose, rotationDeg, rotationDir, correctSide, chosenSide }`.

5. **Tick loop**: `app.ticker.add(() => engine.tick(performance.now()))`.

6. **Fly-in animation**: image enters from `params.region?.direction` side, settles in centre. Use Pixi `gsap`-style tweening or manual lerp over ~400ms.

7. **End**: `session.onEnd(() => { ... })` — compute metrics, no cleanup needed.

8. **Keyboard**: Left arrow or "L" → left button, Right arrow or "R" → right button.

9. **mulberry32 RNG** from `ctx.rng` (seeded).

10. **Default export**: `{ manifest, create, strings }` as `GameDefinition`.

- [ ] **Step 2: Verify typecheck passes**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right exec tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add games/its-left-its-right/src/index.ts
git commit -m "feat(its-left-its-right): Pixi.js renderer

Wires engine to SDK. Fly-in animation, runtime rotation,
horizontal flip, physical Left/Right buttons, keyboard support."
```

---

### Task 9: Integration — game-runtime and demo app

**Files:**
- Create: `packages/game-runtime/frames/its-left-its-right.ts`
- Modify: `packages/game-runtime/package.json` — add `@emb/game-its-left-its-right` dependency
- Modify: `apps/web/src/games/registry.ts` — add entry

**Interfaces:**
- Consumes: default export from `@emb/game-its-left-its-right`, `boot` from game-runtime
- Produces: a new frame bundle importable by the demo app

- [ ] **Step 1: Create `packages/game-runtime/frames/its-left-its-right.ts`**

```typescript
import game from "@emb/game-its-left-its-right";
import { boot } from "../src/runtime.ts";
boot(game);
```

- [ ] **Step 2: Add dependency to `packages/game-runtime/package.json`**

Add `"@emb/game-its-left-its-right": "workspace:*"` to `dependencies`.

- [ ] **Step 3: Add entry to `apps/web/src/games/registry.ts`**

```typescript
import { manifest as itsLeftItsRight } from "@emb/game-its-left-its-right/manifest";
```
And add to `GAMES` array:
```typescript
{ manifest: itsLeftItsRight, loadFrame: () => import("@emb/game-runtime/frames/its-left-its-right.js?raw").then((m) => m.default) },
```

- [ ] **Step 4: Run `pnpm install` to link the new workspace package**

Run: `cd /home/claude/emazebrain-v2 && pnpm install`

- [ ] **Step 5: Build game-runtime and demo to verify**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-runtime build && pnpm --filter @emb/web build:demo`
Expected: builds succeed, no errors

- [ ] **Step 6: Run all game tests to verify nothing broke**

Run: `cd /home/claude/emazebrain-v2 && pnpm --filter @emb/game-its-left-its-right test && pnpm typecheck`
Expected: all tests pass, typecheck clean

- [ ] **Step 7: Commit**

```bash
git add packages/game-runtime/frames/its-left-its-right.ts packages/game-runtime/package.json apps/web/src/games/registry.ts pnpm-lock.yaml
git commit -m "feat(its-left-its-right): integrate with runtime and demo app

Frame bundle, workspace dependency, and registry entry.
Game appears in the demo app's library."
```

---

### Task 10: Demo artifact update

**Files:**
- Modify: demo artifact (republish to include the new game)

**Interfaces:**
- Consumes: built demo app at `apps/web/dist-demo/`
- Produces: updated demo artifact at existing URL

- [ ] **Step 1: Build and republish the demo artifact**

Build: `pnpm --filter @emb/game-runtime build && pnpm --filter @emb/web build:demo`
Republish to artifact URL `https://claude.ai/artifact/8HiaRBrkXD9yUJLKEFSrwM`.

- [ ] **Step 2: Verify the game appears in the demo library and is playable**

Open the demo, find "It's Left, It's Right" in the library, start a game, verify:
- Image appears with rotation
- Left/Right buttons respond
- Correct/wrong feedback works
- Timer timeout works

- [ ] **Step 3: Commit any remaining changes**

```bash
git add -A
git commit -m "chore: demo artifact update with It's Left, It's Right"
```
