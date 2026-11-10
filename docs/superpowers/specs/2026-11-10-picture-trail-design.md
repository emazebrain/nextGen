# Picture Trail (working name) — picture-line memory game — design

- Date: 2026-11-10
- Status: Approved for building by the product owner ("Start building the game", 2026-11-10, after the gameplay playback)
- Product owner: Barak
- Builds on: ADR 0020 (brain-region filters), ADR 0009 (backgrounds), ADR 0011/0012 (hemisphere look, Peek Peek), §8.1 Session Rules, §8.3 SDK, §11.6 wording
- Clinical brief (open questions for the advisor): Claude Doc "New picture-line memory game: brief for clinical review"

## Intent

A game-based activity in two phases. Pictures appear one at a time along a straight line across the screen; then a
second run of pictures follows on the same line, and the child taps the one picture that was in the first run. The
therapist's brain-region filter decides the line's direction, where most pictures sit, and the background, so the
activity can vary objects, colours, background, orientation and direction by the region chosen.

## Product owner decisions

- Two phases: question, then answer, with no delay or splash between them.
- Pictures are spread evenly along the line, from one screen edge to the other; the number per phase follows the level.
- Eight directions: left↔right, top↔bottom and the four diagonals. The answer run uses the same line and direction.
- Every answer picture is new except one, taken from the question run.
- Question phase: **each picture disappears when the next one appears** (option 2).
- Answer phase: **pictures also appear one at a time and each disappears**; the child taps while the matching picture
  is on screen. A tap on another picture costs a life; letting the match pass counts as a miss (option 1).
- Pictures fit the child's age; with no age, 12 years.
- Timer, lives, backgrounds, picture types and everything else work as in the other games. Modern, bright look.
- On screen it is a game-based activity; no brain or clinical wording (§11.6).

## Gameplay

**Start.** After the standard instructions (and practice, when on), a "Tap to start" button. That tap is the qualifying
interaction: Session Rules start the clock there (invariant 5), never on load.

**One round.**
1. Question run: N pictures appear in turn at N evenly spaced points on the line, each for the *show time*, then gone.
   A short gap (one quarter of the show time) separates pictures.
2. With no pause, the frame changes colour (the cue) and the answer run starts: N pictures, each in turn at the same N
   points, same direction. Exactly one is the *match* (a picture from the question run); the others are new.
3. A tap while the match is showing → correct. A tap while another picture shows → wrong picture (life lost via
   `lifeLossEvent("wrong_picture")`); the run continues so the child can still find the match. The match passes
   untapped → miss (`lifeLossEvent("missed_match")`). Taps between pictures are ignored. The round ends when the match
   is tapped or the answer run ends.
4. Brief feedback (≈600 ms; shorter with reduced motion), then the next round.

**Which picture, where (our calls).**
- The match is a random picture from the question run.
- Its slot in the answer run is random, biased by the target location (below). Its slot in the question run is random
  and recorded, so results can show whether position or recency matters.
- No picture repeats within a round; the session avoids reusing pictures until the age set is used up.

**Line geometry.**
- The line runs between two edges with a margin of half a picture plus 24 px. Horizontal and vertical lines run
  between opposite edges, diagonals between opposite corners. Points are evenly spaced, both ends included.
- The picture size is the spacing minus a gap. It is capped at 160 px and floored at 64 px. When the floor would be
  broken, N is capped for that direction and screen. The cap is reported, never silent.
- Target location: the line is shifted *perpendicular* to its direction toward the target location's component on
  that axis, by 22% of the screen. For example, N moves a left-to-right line into the upper part of the screen; a
  diagonal through the centre shifts toward the named corner side. The *along-line* component biases the match's
  answer slot into the half of the line nearest the target. A target with no component on an axis (N for a
  vertical line) leaves that axis centred and unbiased.

**Direction and target with a brain-region filter (ADR 0020).**
- Directions: the `motion` entries whose `movement_types` include 0; if none, the first entry. Each round picks one
  direction from that list, and one target location from `target_locations`, using the seed.
- Background: `bg_temperature` and `bg_types` through `regionUse.background` (host-filled params `bg_temperature`,
  `background`), like Catch Me. The palette follows the hemisphere the row runs as.
- Rotation and movement type are not used (`regionUse: { background, direction: true, targetLocation: true }`).

**Without a filter (side only).** The right hemisphere uses left-to-right; the left hemisphere uses right-to-left. The
target location is centred (no shift, no bias). The direction parameter `direction` (below) can override this.

## Levels, difficulty, pace

- 30 levels, 6 per band of N: levels 1–6 N=3, 7–12 N=4, 13–18 N=5, 19–24 N=6, 25–30 N=8.
- Show time by age band (base): 4–6 → 1300 ms, 7–9 → 1100 ms, 10–12 → 950 ms, 13+ → 850 ms. Within a band of N the
  show time shortens by 4% per level (×0.96^(position in band)). Multiplied by the platform `speed_scale` ÷ 1 (0.5–1.0
  slows; it is a speed scale, so show time ÷ speed_scale).
- Staircase within a session: two correct rounds in a row → up one level; two non-correct rounds in a row → down one
  level (not below 1). Level 30 cleared twice → `contentExhausted("max_level")`.
- Difficulty 1–5 sets the start level (1, 4, 8, 14, 20) when `start_level` is `from_difficulty`. From difficulty 4,
  levels ≥ 13 use look-alike pictures: at least half of the new answer pictures share the match's category.
- Session lives: Session Rules own them; the game reports the two life-loss events only.

## Pictures

- Our call: **Twemoji** SVG artwork (CC-BY 4.0, attribution in the game's credits and NOTICE), bundled into the game
  frame (games make no network requests). It is a placeholder pack until commissioned art arrives, the same approach
  as Peek Peek. Each picture has an id, a category (animal, food, vehicle, toy, sport, nature, object, music, tool,
  place) and a minimum age band.
- Age sets: 4–6 has at least 48 simple, familiar pictures; each older band adds at least 24 more, so 13+ has at least
  120. A band includes the pictures of all younger bands. No flags, faces, people, hand gestures, religious or national
  symbols, food a culture may avoid (pork), alcohol or weapons.
- Black and white: pictures render in greyscale (a luminance filter) and the cue uses a pattern change, not only colour.

## Age

New platform parameter `age_band: "4-6" | "7-9" | "10-12" | "13+"`, computed by the API from the patient's date of
birth at launch and in offline packages (bands only, never the date). Default `"10-12"` (12 years). Signed in the ticket
like other params; not structural (a birthday between packages is not a step change).

## Settings (paramsSchema)

- `direction`: `auto` (default: from the filter, else from the side) or a fixed direction, for steps with no region
  filter. Under a filter the table decides, and the builder shows it as set by the brain region (same lock as backgrounds).
- `bg_temperature`: `auto` / `warm` / `cold`; `background`: `solid` / `textured`. Host-filled under a filter.
- `lures`: `auto` (from difficulty 4) / `on` / `off`.
- `show_ms`: 0 = automatic, or 500–2500 ms.

## Results

Per round, a `trial` event:
- outcome `correct`, `commission` (a wrong picture was tapped and the match was not) or `omission`;
- `responseMs` from the match's onset;
- tags: direction, target location, N, the match's question slot and answer slot, the age band, whether lures were
  used, and how many wrong taps the round had.

Per level, a `levelComplete` row. Session metrics (computed in a pure `metrics.ts`):

| key | meaning | unit |
| --- | --- | --- |
| accuracy | correct rounds ÷ rounds | ratio |
| miss_rate | rounds with no tap at all (the match passed untapped) ÷ rounds | ratio |
| wrong_tap_rate | wrong-picture taps ÷ pictures shown in answer runs | ratio |
| rt_correct_ms | median response time on correct rounds | ms |
| span | largest N with at least two correct rounds | count |
| best_streak | longest run of correct rounds | count |
| highest_level | highest level reached | count |

Each round's direction is recorded, so accuracy by direction can be analysed later.

## Look

- Bright and modern: a soft gradient sky (warm or cold palette per ADR 0011), rounded picture cards with a light
  shadow, and a soft "pop" when each picture appears (a fade with reduced motion).
- Feedback: a confetti burst on correct; a gentle shake and grey-out on wrong.
- The frame cue between phases is a coloured border. In black and white it is a dashed border.
- Textured backgrounds use a subtle pattern (dots or waves).
- The HUD, timer and lives come from the shared runtime. The timer side is physical (not mirrored). All text is in
  English and Hebrew.

## Non-goals

Rotation and movement types, filter-first browsing, commissioned art, per-direction metrics in the admin charts.

## Left to the builder

File structure inside the game package, pixel details of the look, the exact Twemoji subset (within the rules above),
practice round design (two rounds of N=2 at 1.5× show time with a hint ring on the match).
