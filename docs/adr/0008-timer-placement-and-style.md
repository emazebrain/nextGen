# ADR 0008 — Timer placement and style follow the hemisphere

- Status: Accepted
- Date: 2026-11-02
- Design doc: §8.1 (Timer rules), §7.8 (RTL), open question "Timer on the same side as the trained hemisphere (v1) or the opposite side?"

## Decision

The product owner resolved the open question: **the timer goes in the top corner opposite the trained hemisphere, and its look follows the hemisphere's palette.**

| Hemisphere (builder choice) | Corner | Timer | Colours |
| --- | --- | --- | --- |
| Left | Top right | Digital clock, four digits (MM:SS) in seven-segment style | Warm: amber digits on a dark brown face; digits turn yellow in the last seconds |
| Right | Top left | A bar that empties as time runs out | Cold: blue-teal fill on a dark navy track; the fill turns lavender in the last seconds |

- The corner is physical and never mirrored in RTL, as before. Hearts take the other top corner.
- The rule lives in one pure function, `timerLayout(hemisphere)` in `@emb/session-rules`, used by the builder, the API and the game runtime, so they can't disagree.
- The builder no longer offers left/right for the timer. It offers **Show / Hide**, and says where the timer will appear and how it looks.
- The warning in the last seconds still pulses at 1 Hz, with no pulse under reduced motion.
- Screen readers get the remaining time from a hidden text label in both styles (`role="timer"`).

## Data (expand/contract)

`timer_position` keeps its `left | right | hidden` values, so there is no migration. From now on:

- On save, the API stores the corner derived from the hemisphere (`timerPositionFor`), whatever side the client sent. Only shown or hidden comes from the client.
- At launch, the API derives the corner again, so steps saved under the v1 same-side rule show the timer in the new corner.
- Contract step, later: replace `timer_position` with a boolean `timer_shown` once no client sends a side.

## Consequences

- v1 placed the timer on the same side as the hemisphere. Any v1 data migrated later must be read through `timerLayout`, never as a side.
- Hiding the timer changes nothing about session length: the session still ends when time is up.
