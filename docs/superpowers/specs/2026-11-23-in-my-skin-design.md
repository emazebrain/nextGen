# In My Skin — game design

Status: approved and built 2026-11-23. See "As built" at the end for where the build differs from the text above.

## Intent and why

"In My Skin" is a timing game-based activity. A colour picture travels across the screen toward a grey copy of itself (the outline). The child presses a large stop button at the moment the picture sits on its outline. It gives graded practice at watching a moving object and timing one action to it, and it records how early, late or exact each stop was, so a therapist can follow timing accuracy and consistency over weeks.

It is a game-based activity (§11.6): it never claims to treat, assess or diagnose.

## Goals

1. A fully playable game on the existing architecture (pure engine, Pixi renderer, `@emb/game-sdk`, `@emb/session-rules`).
2. Movement driven by the brain-region settings: the eight directions and, for the first time, the six movement types.
3. Results that describe timing: early / on time / late / never, the size and direction of the error, and consistency.
4. Difficulty expressed as how long the child has to get it right.
5. Pictures chosen by category according to the hemisphere set on the protocol step.

## Non-goals

- Real-life faces and real-life photographs in the first version (no licensed source yet; see Pictures).
- Curved or accelerating paths: every leg is a straight line at constant speed or constant jump rhythm.
- A database migration. Movement types stay stored as numbers; only their names are new.

## Anti-goals

- A stop that is judged differently for two pictures with the same timing error.
- The game running its own timer or life counter, or making network requests.
- A picture shown mirrored when mirroring makes it wrong (letters, numbers, signs).
- Wording that calls the game an assessment, treatment or diagnosis.

## Constraints

CLAUDE.md invariants 5, 6, 8, 9, 10: Session Rules own time and lives; the game imports only the SDK; results are idempotent by `session_id`; wording; i18n in English and Hebrew with physical (unmirrored) placement of game controls.

## How a round works

1. The outline (grey copy) appears at its place on the path. The colour picture enters from the edge.
2. The picture travels along a straight line through the outline.
3. **If the child presses Stop:** the picture freezes for 0.5 s with right/wrong feedback, then both disappear and the next round starts.
4. **If nobody presses Stop:** the picture finishes the leg and starts the next one. After the third leg the round ends as "no stop" and counts as wrong.
5. Only the Stop button counts. Taps elsewhere do nothing but are counted, so poor aiming is not mistaken for poor timing.

A round uses one picture. The picture and its outline are the same size and orientation.

### Movement

**Direction** (from the brain-region settings, as in other games): `ltr`, `rtl`, `ttb`, `btt`, `tldbr`, `trdbl`, `bldtr`, `brdtl`.

**Movement type** (stored as a number with each brain region; named here for the first time):

| No. | Name | Leg 1 | Leg 2 | Leg 3 |
|---|---|---|---|---|
| 0 | continuous | glide A→B | glide A→B (re-enters at A) | glide A→B |
| 1 | intervals | jump A→B | jump A→B | jump A→B |
| 2 | continuous-continuous | glide A→B | glide B→A | glide A→B |
| 3 | continuous-intervals | glide A→B | jump B→A | glide A→B |
| 4 | intervals-continuous | jump A→B | glide B→A | jump A→B |
| 5 | intervals-intervals | jump A→B | jump B→A | jump A→B |

- **Glide:** smooth movement at constant speed.
- **Jump (intervals):** the picture appears at 8–12 evenly spaced spots in turn, blinking off between them. One spot is always exactly on the outline.

When a brain region allows several types or directions, one is drawn per round with the seeded generator, as other games draw their direction.

### Facing

A picture marked *mirrorable* faces the way it travels: it is flipped horizontally when the leg runs right-to-left (including the diagonal directions that run leftward), and flips again on a return leg. The outline is flipped with it, so they always match. Vertical movement never flips. Letters, numbers, arithmetic signs, road signs and arrows are never mirrored.

### Where the outline sits

The outline's place along the path changes from round to round, between 35% and 75% of the way, so the child cannot tap on a learned beat. The target-location setting of the brain region biases it toward that side of the screen.

### The Stop button

One large button (at least 96 × 96 px) fixed at the bottom of the screen, on the side **opposite** the hemisphere set on the step: right hemisphere → bottom-left, left hemisphere → bottom-right. The placement is physical and is not mirrored in Hebrew. It shows a stop sign and the word "Stop" / "עצור".

## What counts as right

The brief asked for "at least 85% of the outline covered". Coverage depends on the picture's shape: a thin or branching shape loses coverage much faster than a solid one for the same error, so the same stop would be right for a ball and wrong for a giraffe. The rule is therefore stated as distance, which is the same thing for a solid shape and fair for every shape:

- **Glide:** right when the picture's centre is within **15% of the picture's length along the travel line** of the outline's centre.
- **Jump:** right when the stop comes while the picture is showing on the outline's spot.

Each stop is also classified:

| Class | Glide | Jump |
|---|---|---|
| early | stopped before reaching the right zone | stopped one or more spots before |
| on time | inside the zone | on the outline's spot |
| late | stopped after leaving the zone | stopped one or more spots after |
| no stop | three legs passed | three legs passed |

The true pixel coverage at the stop is measured and recorded as well, for the "20%, 50%, 80%, 100% covered" view the brief asks for, but it does not decide right or wrong.

## Difficulty

The assignment's difficulty (1–5) sets the starting level; inside a session the level (1–30) moves by the same staircase as the other games: two on-time stops in a row go up one level, two wrong in a row go down one.

What a level controls is **how long the child has to get it right**. Size and speed follow from that.

| Levels | Picture size (share of the travel line) | One glide leg lasts | Right zone lasts about | Jump: spots / time on each spot |
|---|---|---|---|---|
| 1–5 | 34% | 6.5 s | 500 ms | 8 / 650 ms |
| 6–10 | 30% | 5.5 s | 380 ms | 9 / 550 ms |
| 11–15 | 26% | 4.8 s | 300 ms | 10 / 450 ms |
| 16–20 | 22% | 4.2 s | 230 ms | 10 / 380 ms |
| 21–25 | 18% | 3.6 s | 165 ms | 11 / 320 ms |
| 26–30 | 14% | 3.0 s | 110 ms | 12 / 260 ms |

Within a band the values step evenly from level to level. In a jump leg the picture is visible for 70% of the time on each spot. These numbers are a starting point to tune after children have played it.

## Session rules

- **Modes:** timed, lives, timed + lives (recommended: timed + lives, 5 minutes).
- **Life-loss events:** `stopped_early`, `stopped_late`, `no_stop`. Each wrong round reports one.
- **Trial events:** one `trial` per round with correct = on time.
- **Qualifying interaction:** the "Tap to start" button; the session timer starts there, never on load.
- **Practice:** one easy round first (level 1 values, glide), which costs no life and is not scored. Configurable like other games.
- **Content exhausted:** not applicable; pictures repeat after the category's set has been shown once.

## Pictures

Each picture has an id, a category, a mirrorable flag and a transparent-background image. The grey outline is produced from the colour picture at run time (desaturated and slightly lightened), so no picture is drawn twice. A picture is only accepted into the set if its grey version is clearly different from its colour version.

Categories and the hemisphere they are used for, as specified by the product owner:

| Category | Hemisphere | First version | Source |
|---|---|---|---|
| 2D objects | Left | yes | Fluent Emoji, flat style |
| 3D objects | Right | yes | Fluent Emoji, 3D style |
| Cartoon faces | Left | yes, curated to avoid a toddler look | Fluent Emoji 3D |
| Real-life faces | Right | **no** | needs licensed photographs with releases |
| Letters (English and Hebrew) | Left | yes | drawn in code |
| Numbers | Left | yes | drawn in code |
| Numeric operations (+ − × ÷) | Left | yes | drawn in code |
| Geometric shapes | Right | yes | drawn in code |
| Cartoons in general | Left | yes | Fluent Emoji 3D |
| Real life in general | Right | **no** | needs licensed photographs |
| Sports equipment | Right | yes | Fluent Emoji 3D |
| Road signs | Right | yes | drawn in code |
| Arrows | Right | yes | drawn in code |
| Everyday items | Left | yes | Fluent Emoji 3D |

Microsoft Fluent Emoji is MIT-licensed; the game's `NOTICE.md` and credits string carry the attribution, as Picture Trail does for its artwork. About twelve pictures per category to start. Pictures load as packs per category so a device only holds what its protocols use.

By default a round draws from the categories that match the step's hemisphere. The therapist can narrow this to chosen categories.

## Therapist settings (`paramsSchema`)

| Setting | Values | Default |
|---|---|---|
| Categories | automatic (by hemisphere), or a chosen subset | automatic |
| Background colours | by side / warm / cool | by side |
| Background | plain / patterned | plain |
| Direction | automatic (from the brain region) | automatic |
| Movement type | automatic (from the brain region), or one of the six | automatic |

## Brain-region integration

`regionUse`: background (temperature and type), direction, target location, and **motion** — the first game to read the movement type. The contracts package gains the six names for the stored numbers, and the brain-region settings screen shows the names instead of numbers.

## Results

### Per round (in the result's level detail)

Picture id and category; level; direction; movement type; which leg the stop came on (1–3) and whether that leg was a glide or a jump; class (early / on time / late / no stop); signed timing error in ms (negative = early); offset as a share of the picture's length (glide) or in spots (jump); coverage at the stop; taps outside the button.

### Per session (`metrics`)

| Key | Meaning | Better |
|---|---|---|
| `accuracy` | share of rounds stopped on time | higher |
| `early_rate`, `late_rate`, `no_stop_rate` | share of rounds in each wrong class | lower |
| `timing_error_ms` | mean size of the timing error, stopped rounds | lower |
| `timing_bias_ms` | mean signed error: negative tends early, positive tends late | nearer zero |
| `timing_spread_ms` | how much the error varies (standard deviation) | lower |
| `coverage_mean` | mean coverage at the stop | higher |
| `first_leg_rate` | share of on-time stops made on the first leg | higher |
| `glide_accuracy`, `jump_accuracy` | on-time share by kind of leg | higher |
| `stray_taps` | taps that missed the button | lower |
| `highest_level`, `best_streak` | as in other games | higher |

The standard envelope carries `accuracy`. Response time (`rt_median_ms`) is left empty: this game measures anticipation, not reaction, and a response time would mislead.

### Progress over time

The Progress page already compares each child with their own earlier sessions of the same game at the same difficulty. For this game the measures worth following are `timing_error_ms` and `timing_spread_ms`, which stay meaningful as the level changes, alongside `accuracy`. `timing_bias_ms` shows whether a child consistently stops early or late. Skills: `anticipation_timing`, `visual_tracking`, `impulse_control`.

## Approaches considered

1. **Judge by distance, record coverage** — chosen. Fair across shapes, and the brief's coverage figure is still collected.
2. **Judge by pixel coverage ≥ 85%** — rejected as the rule: unfair across shapes, and undefined for jump legs. Kept as a recorded measure.
3. **Difficulty by picture size only** (as first briefed) — rejected: with speed unspecified, size alone does not fix how hard a round is. Size is one input to the time the child has.

## Where it lives

- `games/in-my-skin/` — engine, rounds, metrics, manifest, strings, pictures, tests, `NOTICE.md`.
- `packages/game-runtime/frames/in-my-skin.ts`, the web registry, and **the API's game list** (`apps/api/src/games.ts`; the registry test added on 2026-11-23 fails if this is forgotten).
- `packages/contracts` — names for the six movement types; the brain-region settings UI shows them.

## Open

- **Pictures.** The product owner will supply the final pictures (decided 2026-11-23, after seeing the first set). The pictures in the repository are placeholders so the game can be played; no more are to be made here. `games/in-my-skin/PICTURES.md` says what to supply and how they are added.
- Real-life faces and real-life photographs: part of the same delivery.
- The level table and the blink timing are to be tuned after first play.

## As built

- **Letters follow the patient's language** (product owner, 2026-11-23): Hebrew letters when the patient's language is Hebrew, Latin letters otherwise. One "letters" category.
- **A wrong stop costs a life only in modes that have lives** (product owner, 2026-11-23). The game reports `stopped_early`, `stopped_late` or `no_stop` for every wrong round; Session Rules applies it in lives modes and ignores it in a timed-only session.
- **Level table.** Picture size is a share of the play field's short side, not of the travel line, and the glide speed is derived from the time in the right zone (zone = 30% of the picture's length), so the time a child has is exact at every screen size:

  | Levels | Picture size | Right zone lasts | Jump: spots / time on each |
  |---|---|---|---|
  | 1 | 44% | 420 ms | 8 / 650 ms |
  | 6 | 40% | 340 ms | 9 / 550 ms |
  | 11 | 36% | 270 ms | 10 / 450 ms |
  | 16 | 32% | 210 ms | 10 / 380 ms |
  | 21 | 28% | 160 ms | 11 / 320 ms |
  | 26 | 24% | 115 ms | 12 / 260 ms |
  | 30 | 22% | 103 ms | 12 / 244 ms |

  The platform's speed scale (0.5–1) slows both kinds of movement.
- **Jump legs:** a stop anywhere in the outline spot's time slot is on time, including the short blink-off at its end.
- **Timing measures come from glide stops only.** `timing_error_ms`, `timing_bias_ms` and `timing_spread_ms` are not defined for a jump stop, which is judged by spot; `jump_accuracy` covers those.
- **`timing_bias_ms` is nearer-zero-is-better**, which the metric definition cannot express; it is marked lower-is-better. Read its sign, not its trend.
- **Pictures setting:** automatic, or one category (the settings form has no multi-select).
- **Practice** is two glide rounds at level 1.
- **No brain region on the step:** continuous movement, left-to-right or right-to-left.
- **The outline keeps clear of the Stop button**, and the preview's Close button moved to the bottom centre so it no longer covers a game's corner buttons.
- **Skills:** `anticipation_timing`, `visual_tracking`, and the existing `inhibition` and `sustained_attention`.
- Movement-type names are exported from `packages/contracts` (`MOVEMENT_TYPES`); the protocol builder's region summary now lists "movement type" for games that use it. No screen showed the raw numbers, so there was nothing else to rename.
