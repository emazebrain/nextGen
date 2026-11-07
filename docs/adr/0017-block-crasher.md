# ADR 0017 — Block Crasher rebuilt natively: v1 layouts with real per-level speeds, specials lean by hemisphere

- Status: Accepted
- Date: 2026-11-06
- Design doc: §8.4 Block Crasher, §8.1 (lives), §11.6 (wording and feedback), §17.1 (native parameters)
- Source: v1 `src/pages/BlockCrasher.jsx`, `src/lib/blockCrasherLevels.js`, `src/lib/specialBricks.js`, `src/docs/games/block-crasher.md`

## Context

v1's Block Crasher was a canvas game inside a React page that sent its own results and ran its own countdown and
three lives. v2 games only draw and report; Session Rules owns time and lives. The design doc already specified the
mechanics, the difficulty table and the warm and cold looks. The product owner chose: the hemisphere sets the
palette and where most special bricks sit, v1's ten layouts, and art drawn in code until the commissioned assets
arrive.

## Decisions

**Engine.** A pure, deterministic engine (`engine.ts`) on v1's 800 × 600 board, stepped at 240 Hz so a fast ball
never passes through a brick. v1's speeds (px per 60 Hz frame), paddle angles (±63°), brick sizes and scores are
kept: 10 per brick, 5 for a hit on a tough brick, 50 per cleared board. Two fixes: a ball can no longer run almost
flat between the walls (its vertical speed never falls below a quarter of its speed), and the paddle hit test is
per sub-step.

**Levels and difficulty.** v1's ten layouts (Sunrise to Ultimate Maze, shown as "Grand Maze"). The §8.4 table sets
the start level (1 / 4 / 6 / 8 / 10) and the ball speed and paddle width at that level. Each later level adds v1's
own per-level step, which v1 stored but never applied: difficulty 1 climbing to level 10 reaches v1's level-10
values (6.5 px/frame, 80 px). `start_level` overrides the start; `speed_scale` scales the ball.

**Special bricks.** v1's eight specials and effects: exploding (clears bricks within 1.5 brick widths), slow ball
(× 0.6 for 10 s), rocket (clears the column), small paddle (× 0.7 for 10 s), big paddle (× 1.5 for 10 s), two more
balls (up to 10), a hidden brick (shown by its first hit) and a heavy ball (falls faster for 5 s). Their share
follows the §8.4 table (none, then 8 %, 12 %, 15 %, 20 %); difficulties 2–3 use v1's pair for the level, 4–5 all
eight. Specials are told apart by an embossed shape, not colour alone. `block_crasher.specials` turns them off;
`block_crasher.special_rate` sets the share (5–25 %, or by difficulty).

**Hemisphere (no new parameter).** Left → warm "Canyon Fort" (sunrise sky, mesas and a fort; sandstone and clay
bricks; a wooden raft paddle with brass caps; a sun-pebble ball). Right → cold "Glacier Castle" (moonlit sky,
mountains and a castle; ice and crystal bricks; an ice-sled paddle; a snowball). Three in four special bricks sit on
the half of the board that hemisphere sees (left → right half). Ordinary bricks keep v1's layouts.

**Lives (§8.1).** When the last ball in play leaves the bottom edge (with several balls, only when none remain), the
game reports `ball_lost`; Session Rules decides what it costs, with the manifest's 1 s grace after the re-serve. In
lives modes the child serves again with a tap or key. In timed mode a lost ball costs 50 points (never below 0) and
the ball serves itself after 1 s (§8.4). Effects end when a ball is lost. A cleared board shows the next one, which
serves itself after 3 s if the child has not served. Clearing level 10 reports `content_exhausted` (max level).

**Magnet paddle (`block_crasher.paddle_assist`, new in v2).** 1: the paddle catches the ball; a tap or key lets it
go, aimed by where it sits on the paddle, and it lets go by itself after 2 s. 2: as 1, and a falling ball within
140 px of the paddle is drawn towards it. The setting is stored with each result, because it changes the motor
measures.

**Practice.** 30 s on one row at difficulty-1 speed, no specials, unlimited balls: a lost ball serves itself, and a
cleared row refills.

**Input and accessibility.** A mouse moves the paddle by hovering (v1); touch and pen by dragging anywhere; arrow
keys or A/D hold to move. A tap, Space, Enter or Up serves. The first serve starts the session clock. A visually
hidden status line tells screen readers the level and how many bricks are left when each board starts. Messages
sit under the board when there is room (phones in portrait). Reduced motion turns off the ball trail, the paddle
squash and the brick particles.

**Backgrounds.** Five scenes per look, as in the §8.4 asset table, each in three parallax layers (far, middle,
near) drawn in code: warm sunrise mesa, red rock arches, desert market, lava-glow cave and sunset fort; cold dawn
fjord, ice arches, frozen harbour, aurora cave and moonlit castle. Two levels share a scene (levels 1–2 → the first
… 9–10 → the fifth), and a new scene fades in when its first board starts. The layers shift up to 6, 16 and 30 px
as the paddle crosses the board; embers rise in the lava cave, lanterns flicker in the market, snow falls on the
ice arches and the castle, and the aurora shimmers. Under reduced motion nothing moves and scenes change at once.
Monochrome turns every scene grey. Each level's history row names its scene.

**Sound.** Synthesised with Web Audio (no files, no network): wood-block hits and a marimba level-up (warm), glass
taps and a celesta level-up (cold); a lost ball gives a soft falling note, never a buzzer.

**Measures.** `paddle_miss_rate`, `avg_intercept_gap_px` (board px from the paddle centre at contact),
`intercept_ms_median` (from when a ball starts coming down to the paddle contact), `movement_reversals` and per
minute (direction changes of at least 1.5 px), `idle_seconds` (still for over a second while the ball is in play),
bricks and tough bricks destroyed, `special_bricks_triggered`, `powerup_efficiency` (bricks cleared by exploding and
rocket bricks per special triggered), misses and paddle hits by board half with `side_miss_asymmetry`,
`magnet_catches`, levels completed and highest level. One trial event per ball reaching the paddle line (hit, or a
miss as an omission); one level-history row per board.

## Consequences

- The start-level speeds and paddle widths are the §8.4 assumptions; the per-level steps are v1's, not pilot-fitted.
- The magnet paddle makes `avg_intercept_gap_px` and the miss rate not comparable with sessions without it; reports
  should compare like with like.
- The five scenes per look from the asset table are drawn in code (`scenes.ts`), three parallax layers each, until
  the commissioned art replaces them.
