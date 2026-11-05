# ADR 0014 — Tunnel Rush on the SDK: side lean, collisions through Session Rules, v1 fixes

- Status: Accepted
- Date: 2026-11-05
- Design doc: §8.4 Tunnel Rush, §8.1 (lives, grace in continuous games), §9.3 (renderer spike), §17.1 (native parameters)
- Source: v1 `src/lib/tunnelRush/*`, `src/components/tunnelRush/*`, `src/pages/TunnelRush.jsx` (timewellspenthavlaz/emazebrain)

## Context

Tunnel Rush is the third MVP game (§15 Phase 1). The Phase 0 spike settled the renderer: PixiJS pseudo-3D,
redrawn every frame. The product owner chose: the hemisphere sets the palette and a side lean, both of v1's
steering styles, and placeholder art drawn in code.

## Decisions

**Game logic is pure.** `games/tunnel-rush/src/config.ts`, `engine.ts` and `metrics.ts` take seconds and the host's
seeded `rng`; nothing reads a clock or `Math.random`. Ported as in v1: lanes 6/8/10/12, single-lane objects that
hit only if their lane faces the ship on arrival, jumps of 1…maxJump lanes so every object is reachable,
adaptive speed inside the difficulty band (clean dodge +1 step, bump −2.5 steps and half speed for 0.5 s),
progressive levels every 8 objects up to 10, ambient spin (cw, ccw, alternate every 6 s), hybrid score.
Difficulty 1–5 follows the §8.4 table (2 and 4 interpolated from v1's three presets).

**Time and lives (§8.1).** The session clock starts on the first steer. A collision is reported as
`collision`; Session Rules decides. Continuous games need "no second loss right after a loss": the SDK manifest
gets an optional `capabilities.lifeLossGraceMs` (Tunnel Rush: 1000), and the runtime passes it to Session Rules,
which already ignored losses inside a grace window. In timed mode a bump keeps v1's behaviour: a score cost, a
short slowdown, and the run continues. The recommended mode is timed, 120 s.

**Practice.** 20 s at difficulty 1, even placement, no spin, unscored. It runs on wall-clock time so a slow frame
rate never stretches it.

**Hemisphere (no new parameter).**
- Look: left → warm "Volcano Run" (v1's tunnel in lava tones, lava-rock badges, phoenix glider, embers); right →
  cold "Ice Comet Run" (v1's cyan corridor, ice-crystal badges, v1's ship, snow streaks).
- Placement: about 3 in 4 objects that appear beside the ship appear on the side the hemisphere sees (left →
  the ship's right, right → the ship's left; 77–85 % in simulation for 6–12 lanes). The side is relative to the
  ship, so in "move" mode it follows the ship round the tunnel. Practice stays even.

**Steering styles.** `ship_mode = fixed` (default): the tunnel rolls so the chosen lane comes under the ship.
`move`: the tunnel stays still and the ship slides round it, nose to the centre. Arrows, A/D, a swipe of 40 px or
more, or the two thumb buttons. The thumb buttons are physical left and right (like the timer side), so their
row keeps left-to-right order in Hebrew; they are real buttons with names, usable by keyboard and switch.

**v1 bugs fixed.**
- `objectType` was lower-cased and then matched against camel-case names, so cartoon and realistic faces fell
  back to the mixed set. The object types are now an enum (`cartoon_faces`, `real_faces`, …).
- Reaction time for objects already on screen before the first steer started at page load. Those objects now
  have no reaction time; reaction is measured from when an object comes into view.
- In "fixed" mode the ship sat on the seam between two lanes (lane centres were offset by half a lane). Lanes
  are now centred on the ship.
- Straight wall rays crossed outside a bending tunnel; seams and light strips now follow the bend.

**Metrics.** v1's (hit rate, dodges, objects, average speed, no-move rate, per lane, per object type, reaction
times, best streak, level reached), plus: `threat_dodge_rate` (objects that appeared in the ship's own lane and
were dodged), `hit_rate_left`, `hit_rate_right` and `side_hit_asymmetry` (by the side of the ship an object appeared
on), and accuracy. One trial event per object (hemifield = side at appearance), one level-history row per level.

**Native parameters (§17.1).** `lanes`, `ship_mode`, `object_type`, `object_orientation`, `rotation`, `spin_speed`,
`progressive`. `object_set` (custom items) is left out: the settings form has no list field yet.

**Platform fixes found on the way.** The API now checks integer settings against their allowed values (it
accepted `lanes: 7`). The step editor honours a setting's `step` for number lists.

## Consequences

- Art is drawn in code until the commissioned illustrations arrive (§8.5). "Lifelike faces" are drawn, never
  photos.
- The lean strength and the 1 s grace are not pilot-fitted.
