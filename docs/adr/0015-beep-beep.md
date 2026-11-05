# ADR 0015 — Beep Beep on the SDK: a generated board pack, exit side by hemisphere, v1 fixes

- Status: Accepted
- Date: 2026-11-05
- Design doc: §8.4 Beep Beep, §8.1 (lives), §8.2 (`trial_window_ms`), §17.1 (native parameters)
- Source: v1 `src/lib/beepBeep/*`, `src/components/beepBeep/*`, `src/pages/BeepBeep.jsx` (timewellspenthavlaz/emazebrain)

## Context

Beep Beep is a Rush Hour–style planning game. v1 downloaded 250 hand-made boards from a file hosted on base44
at start-up. v2 games have no network (§8.3), and that file is not reachable from the build environment. The
product owner chose: generate our own boards, the hemisphere sets the palette and the exit side, and placeholder
art drawn in code.

## Decisions

**A generated, shipped board pack.** `scripts/generate-pack.ts` builds `src/pack.json` offline and
deterministically (fixed seeds): random layouts per grid size (4×4 to 7×7, walls from 5×5 up), then a local
search that nudges the deepest layouts, every one solved exactly. Boards are filed by (grid size, shortest
solution), 10 per bucket: 4×4 depths 2–5, 5×5 3–11, 6×6 6–15, 7×7 9–18 (330 boards, 62 kB). Every shipped board
has at most 30 000 reachable states, so the game solves it in a blink on a tablet. Tests re-solve every board and
check its stated depth, the layout rules (the hero is the only horizontal piece on the exit row; nothing overlaps),
and that every level × difficulty has at least 3 boards so a failure always gets a fresh one.

**Levels.** The grid follows the level (§8.4). v1's pack was hand-graded and its grading is lost, so v2 states a
target shortest solution per level (rising within each grid size, stepping back a little on a new size), nudged
by difficulty (−1 at 1, +1 at 4 and 5). Start levels by difficulty follow the §8.4 table (1, 6, 11, 23, 39). The
board for a level is drawn from its bucket with the session's seeded `rng`.

**Solver.** v1 ran a fresh breadth-first search after every move. v2 solves a board once when it appears (all
reachable states, then distances from every goal state at once) and looks distances up afterwards: move quality
(closer / same / further), the hint's next move, and "show the right move" are instant.

**Time and lives (§8.1).** The clock starts on the first move. In lives modes, using up the move budget
(max(optimal + 2, ⌈optimal × factor⌉)) reports `move_budget`; with a per-board time limit (`trial_window_ms`,
30–300 s) running out reports `board_time`. Either way the right next move is shown for a moment (if
`show_answer_on_miss`), then a fresh board of the same size and depth. Timed mode counts moves without a budget
(v1's lives = 0). Clearing the last level reports `max_level`.

**Hemisphere (no new parameter).** Left → warm "Desert Rally" (sand car park, red buggy with a face, cars, taxis,
trucks, cacti, an arch with flags), exit on the right. Right → cold "Harbor Rush" (dock planks with a rope edge,
blue tugboat with a face, boats, barges, crates, a lighthouse), exit on the left. v1's `orientation` parameter is
gone; boards are stored with the exit on the right and mirrored on screen. Keyboard arrows stay physical.

**Help.** The four-step hint ladder from v1 (what's in the way → which piece → where it goes → it moves), an idle
glow on the blockers after 20 / 30 / 45 s at difficulties 1–3 (off at 4–5, §8.4), Undo and Start-again as 64 px
buttons in the thumb zone. Practice is one 3-move board with the next move always shown by an arrow. Hint moves
don't count as the child's own planning.

**Accessibility and tests.** A visually hidden group of buttons, one per vehicle ("Blue tugboat, goes left and
right"); focusing one selects it and the arrow keys slide it a cell. U, R and H are undo, start again and hint.

**v1 bugs fixed.**
- A replacement board after a failure kept the failed board's shortest solution and budget in the results. Each
  board attempt is now its own record.
- Moves made before a reset were dropped from the move-quality measures, and only cleared boards counted. Now
  every move counts, on failed boards too.
- First-move latency restarted at a reset; it now runs from when the board appeared.
- Hiding the tab ended the session as abandoned; v2 pauses (runtime).

**Native parameters (§17.1).** `hint_button`, `show_answer_on_miss`, `undo` (all default on) and `hint_after_s`
(0–120, 0 = the per-difficulty idle hint). `exit_side` is not added: the hemisphere decides (design doc updated).

## Consequences

- The pack can be regenerated (`pnpm --filter @emb/game-beep-beep generate`); changing it changes which boards a
  seed picks, so it is versioned with the game.
- The per-level target depths are a reasonable curve, not pilot-fitted; v1's hand-grading may differ.
