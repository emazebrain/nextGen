# ADR 0013 — Orbital Order on the SDK: segments that actually run, side lean, rule sign on request

- Status: Accepted
- Date: 2026-11-04
- Design doc: §8.4 Orbital Order, §8.1 (Session Rules), §8.2 (`trial_window_ms`), §17.1 (native parameters)
- Source: v1 `src/lib/orbitalOrder/*` (timewellspenthavlaz/emazebrain)

## Context

Orbital Order is the second MVP game after Peek Peek (§15 Phase 1). The product owner chose: numbers stay visible
on the planets (as in v1), a gentle drift (as in v1, not full orbits), and the hemisphere deciding both the palette
and a side lean, like Peek Peek.

## Decisions

**Game logic is pure.** `games/orbital-order/src/config.ts`, `rules.ts`, `engine.ts` and `metrics.ts` take `now`
and the host's seeded `rng`; nothing reads a clock. The renderer (`index.ts`) owns a pause-adjusted clock and
passes it in.

**Segments (§8.4) run as written.** practice (3, unscored, lenient: a wrong tap shows the right planet and the child
carries on) → motor baseline (5 single taps on a glowing planet, unscored) → probe (5, scored, always difficulty 3,
even placement) → rule blocks (5–8 trials per rule, then a switch). **v1 bug fixed:** v1 jumped straight to the
rule blocks, so its practice, motor baseline and probe never ran and `probe_accuracy` and the baseline tap
latency were always empty. The comprehension gate from v1 is kept: fewer than 2 of 3 practice trials right → the
rule blocks run at difficulty 1.

**Time and lives (§8.1).** The session clock starts on the first probe tap (`qualifyingInteraction`), never during
practice or the motor baseline. The per-target response window is the game's own trial mechanic: the difficulty
table (5.4 s … 3.0 s), or `trial_window_ms` when the step sets one. It runs only in scored segments, pauses while
the rule sign is reopened, and does not run before the session clock has started. A wrong tap and a window
running out are reported as `wrong_tap` and `trial_timeout`; Session Rules decides what a life costs. In lives mode
the session completes after `max_rule_trials` rule trials (default 24, `contentExhausted("trial_cap")`); timed
modes have no cap. `lives = auto` is not supported (the API returns `lives_auto_not_supported`).

**Hemisphere (no new parameter).**
- Look: left → warm "Sun Orchard" (sunset sky, orbit rings, ember trail); right → cold "Star Ocean" (deep space,
  aurora, stardust trail). `orbital_order.neon` gives each a night-sky variant with glowing planets.
- Placement: in rule blocks the first half of each chain leans (p = 0.75) towards the side that hemisphere sees:
  left → right side, right → left side. Practice, the motor baseline and the probe stay even, so their numbers are
  a clean baseline. The renderer pushes overlapping planets apart sideways only, so the lean survives layout.

**Colours.** Every colour carries v1's rim pattern (solid, double, notched, dashed, thick, dotted, quadrant,
inner), so the skip colour is also a skip pattern for children with a colour-vision difference; the rule sign
shows the same pattern. **Changed from v1:** v1 drew 5 of the 8 colours at random, and the v2 palettes have close
neighbours (several oranges, several blues). The session's 5 colours are now picked greedily for the largest
minimum CIE76 distance from a random first colour; a test checks every pair stays clearly apart.

**Rule sign (`orbital_order.rule_visible`).** `on_request` (default): the sign shows during the reveal, then
hides; a "?" brings it back for 1.6 s, and each recheck is counted (`rule_recheck_rate`). `always`: the sign stays.
On a rule switch the sign says "New rule!" and outlines the part that changed. The order icon is mirrored in
Hebrew so the steps rise in reading order. Feedback is soft: no red and no buzzer; a ✕ on the tapped planet and a
breathing ring on the one that comes next.

**Planet buttons (accessibility and tests).** Beside the canvas the game keeps a visually hidden group of
buttons, one per planet, named by glyph, colour and rim ("9, pink, thick rim"; "…, tapped 2"; "…, glowing" in the
motor baseline), top to bottom. Pressing one is the same as tapping that planet. Screen-reader and switch users can
play, and end-to-end tests drive the game through them (they play practice through to the scored part). The skip
colour on the rule sign has the same words in hidden text. To make this reachable the runtime no longer marks the
whole stage `aria-hidden`; each game hides its own canvas instead, and its DOM messages are now announced.

**Metrics.** As §8.4 lists, plus `order_error_share`, `timeout_share`, `fatigue_slope`, `rule_recheck_rate`,
`baseline_tap_latency_ms`, `probe_first_tap_latency_ms`, `comprehension_gate` and `best_streak`. **v1 bug fixed:**
`max_chain` now counts the longest run of correct taps in any trial, including chains that broke; v1 counted only
finished chains, so a child who always slipped on the last planet scored 0. One level-history row is written per
rule block and one for the probe.

**Native parameters (§17.1).** `glyph_type` (digits | letters), `rule_visible` (on_request | always),
`motor_baseline` (default on), `max_rule_trials` (8–60, default 24), `neon` (default off). The library preview
offers glyphs and the night look.

## Consequences

- Art is drawn in code until the commissioned illustrations arrive (§8.5); the manifest lists the asset packs.
- The heart cost of a timeout versus a wrong tap is not pilot-fitted; both cost one life for now.
- `countdown_timer` from v1 maps to `trial_window_ms` (design doc v1 → v2 note); no migration of v1 settings.
