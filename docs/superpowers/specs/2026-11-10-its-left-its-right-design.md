# It's Left, It's Right — Game Design

## Intent and Why

Children with neurological conditions often struggle with laterality discrimination — telling left from right on their own body and on images of others. "It's Left, It's Right" is a game-based activity that gives children repeated, graded practice at this skill using 3D-rendered body-part images (hands, arms, feet, ears) shown in various positions and rotations. The game collects reaction-time and accuracy data broken down by body part, rotation angle, and side bias so the therapist can track progress.

This is a **game-based activity** (§11.6) — it never claims to treat, assess, or diagnose.

## Goals

1. Ship a fully playable laterality game following the existing game architecture (pure engine, Pixi.js renderer, game-sdk, session-rules).
2. Support the same brain-region filter table as Picture Trail, with background colours, textures, and direction driven by therapist settings.
3. Collect clinically relevant metrics: accuracy, reaction time, per-body-part performance, rotation-angle effect, and left/right bias patterns.
4. Scale difficulty through rotation angle range, time pressure, body-part complexity, and unusual viewing angles.
5. Support age-banded content: simpler body parts (hands in clear poses) for younger children, all body parts and harder perspectives for older.

## Non-Goals

- Multiplayer or competitive mode.
- 3D rendering at runtime (we use pre-rendered 3D SVG assets, rotated in 2D).
- Creating the body-part illustrations programmatically (the product owner provides SVG/EPS files).
- Database migrations or API changes — this is a game package only.

## Anti-Goals (failure if these happen)

- The game claims to diagnose, treat, or assess.
- Patient data leaks into assets, logs, or the game package.
- The game runs its own timer or life counter (session-rules owns those).
- The game makes network requests (only `@emb/game-sdk` is imported).

## Constraints (from CLAUDE.md and the design doc)

- Games import only `@emb/game-sdk`. No network access.
- Session Rules own time and lives (§8.1). Timer starts on first qualifying interaction.
- RTL and i18n from day one: CSS logical properties, ICU messages in en and he. Game timer side is physical, not mirrored.
- Wording: "game-based activity", never "assessment", "treatment", or "diagnosis".
- No real patient data outside production.
- Idempotent result ingest via device-generated UUIDv7 `session_id`.

## Approaches Considered

### A. Runtime rotation of canonical assets (chosen)

Each body-part SVG is provided in a single canonical orientation (one side only). The engine picks a rotation angle at runtime via Pixi.js transform. The opposite side (left ↔ right) is created by horizontally flipping the SVG. Difficulty controls the rotation range: easy levels use 0°–30°, hard levels go up to 180°.

**Pros:** Minimal asset count (1 SVG per body-part per pose), continuous difficulty scaling, exact rotation angle recorded for analysis.
**Cons:** 2D rotation of a 3D-rendered image can look unnatural at extreme angles.
**Mitigation:** Cap rotation at 180° (no upside-down), and the 3D cartoon style holds up well under 2D rotation because the images lack strong environmental lighting cues.

### B. Pre-rotated asset variants (rejected)

Each body part provided at several fixed rotation angles. More artistic control but requires N × M assets per pose and locks rotation to fixed steps. The product owner would need to produce hundreds of images.

### C. Real-time 3D rendering (rejected)

Load 3D models and render at runtime. Would give perfect rotation but requires a 3D engine (Three.js), vastly increases bundle size, and the game SDK's Pixi.js renderer doesn't support it.

## How It Works

### Game Flow

1. **Instruction screen** — "Is it left or right?" with a practice image and the two buttons.
2. **Practice round** (optional, configurable) — one easy question, no life cost.
3. **Game rounds** — each round:
   a. A single body-part image appears in the centre of the screen.
   b. The image may be rotated by the engine based on difficulty.
   c. The child taps "Left" or "Right".
   d. Correct → short positive feedback, next round.
   e. Wrong → life loss event reported to session-rules, next round.
   f. No answer within the hidden time limit → miss event, next round.
4. **End** — session-rules ends the game (timer expires or lives exhausted).

### Body Parts and Poses

| Body Part | Age Band | Poses | Notes |
|-----------|----------|-------|-------|
| Hand | all (4–16) | thumbs up, pointing, open palm, pinch, peace sign, fist, wave, grab | Most recognisable; used at all levels |
| Arm | 7+ | extended, bent elbow, reaching up, reaching down | Harder because fewer distinctive features |
| Foot | 7+ | top view, side view (with shoe), sole | Moderate difficulty |
| Ear | 10+ | profile, slightly angled, from behind | Hardest — fewest left/right cues |

Each pose is stored as one SVG (arbitrarily left or right). The engine creates the other side by horizontal flip (`scaleX: -1`).

### Asset Format

- Individual SVG files, one per pose, transparent background.
- Naming: `{bodyPart}-{pose}-{side}.svg` (e.g., `hand-thumbsup-r.svg`).
- The "other side" is generated at runtime by flipping, not stored.
- Assets bundled in the game package under `assets/` and loaded by the renderer via Pixi.js SVG/texture support.
- The 3D cartoon style (pink skin, gray sleeve with buttons) is consistent across all body parts.

### Difficulty Progression

Difficulty level (1–30) controls four axes simultaneously:

| Level Range | Rotation Range | Time Limit | Body Parts | View Angles |
|-------------|---------------|------------|------------|-------------|
| 1–5 | 0°–15° | 8 000 ms | Hands only | Front-facing |
| 6–10 | 0°–45° | 6 000 ms | Hands + feet | Front + side |
| 11–15 | 0°–90° | 5 000 ms | All except ears | Front + side + angled |
| 16–20 | 0°–135° | 4 000 ms | All body parts | All views |
| 21–25 | 0°–150° | 3 500 ms | All body parts | All views + behind |
| 26–30 | 0°–180° | 3 000 ms | All body parts | All views + behind |

The staircase (level up/down) follows the same 2-correct-up / 2-wrong-down rule as Picture Trail.

### Hidden Per-Question Timer

Each question has a hidden countdown. If it expires with no answer:
- A "miss" life-loss event is reported to session-rules.
- The round is recorded as an omission.
- The next round starts.

The child sees no countdown. The timer starts when the image appears (not on screen load). The time limit is set by the difficulty table above and can be overridden by the therapist via `paramsSchema`.

### Buttons

Two large buttons fixed at the bottom of the screen:
- **"Left"** — bottom-left corner (`inset-inline-start`), in en and he.
- **"Right"** — bottom-right corner (`inset-inline-end`), in en and he.

The buttons are physical (not mirrored in RTL) — "Left" is always on the screen's left, "Right" always on the screen's right. This is the same principle as the game timer. The Hebrew labels are "שמאל" and "ימין".

The buttons are large enough for easy tapping (minimum 80×60px), visually distinct (different colours), and always visible.

### Brain-Region Integration

Same table as Picture Trail (§3 of the clinical brief). The therapist's brain-region filter sets:
- **Background colour** (warm/cold) and **type** (solid/textured) — same as Picture Trail.
- **Direction** — the image flies in from the specified direction and settles in the centre of the screen. This follows the same direction animation logic as Picture Trail (the stimulus enters from the direction side).
- **Target location** — biases image placement toward a screen region.
- **Rotation** — CW/CCW strong bias (80/20): 80% of rotation angles follow the therapist's specified direction (CW or CCW), 20% are the opposite. This gives meaningful clinical control while keeping natural variety. (Builder's call — can be tuned.)

### Asset Packs

All body-part SVGs go in the `"shared"` asset pack since they don't vary by colour palette — only the background changes between warm/cold. The `"warm"` and `"cold"` pack keys point to empty stubs. (Builder's call.)

### Display Phase and Timer

Buttons are live as soon as the image is fully visible (the pop-in animation completes). The hidden per-question timer and the RT clock both start at that moment. The engine's `showing` → `waiting` transition is the pop-in animation only — there is no deliberate delay between image appearance and input acceptance. (Builder's call.)

### TrialOutcome Mapping

- Wrong left/right answer → `"error"` (active choice, wrong answer)
- Hidden timer expiry with no answer → `"timeout"`

These map to the SDK's `TrialOutcome` type. (Builder's call.)

### Metrics Collected

Per round (stored in round records):
- `bodyPart`: hand | arm | foot | ear
- `pose`: the specific pose id
- `correctSide`: "left" | "right"
- `chosenSide`: "left" | "right" | null (omission)
- `rotationDeg`: the rotation angle applied (0–180)
- `rotationDir`: "cw" | "ccw"
- `rt_ms`: reaction time from image appearance to tap (null on omission)
- `level`: difficulty level
- `outcome`: "correct" | "wrong" | "omission"

Summary metrics (computed from rounds):
| Key | Label (en) | Label (he) | Unit | Lower is Better | Skills |
|-----|-----------|-----------|------|-----------------|--------|
| `accuracy` | Correct answers | תשובות נכונות | ratio | no | laterality |
| `omission_rate` | No answer | בלי תשובה | ratio | yes | laterality |
| `wrong_rate` | Wrong answers | תשובות שגויות | ratio | yes | laterality |
| `rt_correct_ms` | Time to answer (correct) | זמן תשובה (נכונה) | ms | yes | reaction_time |
| `left_accuracy` | Left-side accuracy | דיוק צד שמאל | ratio | no | laterality |
| `right_accuracy` | Right-side accuracy | דיוק צד ימין | ratio | no | laterality |
| `hand_accuracy` | Hand accuracy | דיוק ידיים | ratio | no | laterality |
| `rotation_effect_ms` | Rotation effect on time | השפעת סיבוב על זמן | ms | — | mental_rotation |
| `best_streak` | Best streak | רצף הצלחות | count | no | — |
| `highest_level` | Highest level | השלב הגבוה ביותר | count | no | — |

### Manifest

```
id: "its-left-its-right"
name: { en: "It's Left, It's Right", he: "שמאל או ימין" }
capabilities: { modes: ["timed", "lives", "timed_lives"], practice: true, rng: "seeded", monochrome: false }
maxLevel: 30
ageRange: [4, 16]
minutes: 5
taxonomy: { skills: ["laterality", "mental_rotation", "reaction_time", "spatial_awareness"], regions: [] }
```

### paramsSchema (therapist-configurable)

- `time_limit_ms`: 0 (auto) or 2000–10000 ms — override per-question time limit.
- `body_parts`: multi-select of [hand, arm, foot, ear] — restrict which appear.
- `max_rotation`: 0–180° — cap on rotation angle regardless of level.
- `bg_temperature`: auto | warm | cold.
- `background`: solid | textured.

### i18n Strings

```
en:
  instructions.title: "It's Left, It's Right"
  instructions.text: "Look at the picture. Is it the left or the right?"
  start: "Tap to start"
  left: "Left"
  right: "Right"
  correct: "Nice!"
  wrong: "Not quite!"
  practice: "Practice"

he:
  instructions.title: "שמאל או ימין"
  instructions.text: "הסתכלו על התמונה. זה שמאל או ימין?"
  start: "הקישו כדי להתחיל"
  left: "שמאל"
  right: "ימין"
  correct: "!יפה"
  wrong: "!לא בדיוק"
  practice: "תרגול"
```

### File Structure

```
games/its-left-its-right/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
    manifest.ts        — SDK manifest
    config.ts          — difficulty tables, timing, level progression
    engine.ts          — pure deterministic engine (no clock, no I/O)
    engine.test.ts     — unit tests for engine
    index.ts           — Pixi.js renderer, wires engine to SDK
    strings.ts         — en/he UI text
    metrics.ts         — compute summary metrics from round records
    metrics.test.ts    — unit tests for metrics
    assets.ts          — asset catalogue (body part metadata, poses, sides)
    assets.test.ts     — unit tests for asset selection logic
  assets/
    hand-thumbsup-r.svg
    hand-pointing-r.svg
    hand-openpalm-r.svg
    hand-pinch-r.svg
    ... (more as provided)
```

### Engine Design (pure, deterministic)

```typescript
// State machine: idle → showing → waiting → feedback → showing | done
type Phase = "idle" | "showing" | "waiting" | "feedback" | "done";

interface RoundState {
  bodyPart: BodyPart;
  pose: string;
  correctSide: "left" | "right";
  rotationDeg: number;
  rotationDir: "cw" | "ccw";
  shownAt: number;       // timestamp image appeared
  answeredAt?: number;
  chosenSide?: "left" | "right";
  outcome?: "correct" | "wrong" | "omission";
}

// Events emitted:
// show(asset, rotation) — renderer displays image
// feedback(correct/wrong/omission) — renderer shows brief feedback
// roundEnd(RoundState) — host records
// correct / wrong / miss — session-rules life events
```

The engine is pure: the caller passes `now` to `tick()` and `tap()`. No `Date.now()`, no `setTimeout`. Fully unit-testable.

## What's Left to the Builder

- Exact Pixi.js rendering: image centering, rotation transform, button layout, feedback animations.
- SVG loading strategy: inline `<svg>` via Pixi SVG support, or rasterize to texture at load time for performance.
- The exact staircase constants may need tuning after playtesting.
- Additional body-part SVGs (arms, feet, ears) will be provided by the product owner and slotted into `assets/`.
- Integration with the demo app for testing (same pattern as Picture Trail).

## Credits

Body-part illustrations provided by the product owner. The art style is a 3D cartoon with pink skin tone, gray sleeve with white trim and buttons.
