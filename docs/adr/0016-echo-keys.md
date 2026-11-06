# ADR 0016 — Echo Keys rebuilt natively: falling notes, public-domain melodies, synthesised sound

- Status: Accepted
- Date: 2026-11-06
- Design doc: §8.4 Echo Keys, §8.1 (lives), §11.6 (wording and feedback), §17.1 (native parameters)
- Source: v1 `src/lib/echoKeys/config.js`, `src/pages/EchoKeys.jsx`, `src/docs/games/echo-keys.md`

## Context

v1 embedded a self-contained HTML game fetched from a CDN and patched its source with string replacements. That
file is not reachable from the build environment, and v2 games have no network. The design doc already called
for a native rebuild with difficulty and lives. The product owner chose: the hemisphere sets the palette and a
no-go side lean, classic public-domain nursery tunes, and synthesised sound until the commissioned samples arrive.

## Decisions

**Mechanics (§8.4).** Notes fall down lanes towards a piano; the child taps each key within ± the hit window of
its note's arrival. Melodies are played phrase by phrase. The first key press starts the music and the session
clock. Difficulty 1–5 follows the §8.4 table (keys 5 / 8 / 13, 60–108 BPM, 4–14 notes per phrase, hit window
350–160 ms, no-go share 10–30 %). `key_count` can fix the keyboard size.

**Lives (§8.1).** A phrase with 3 or more errors (missed notes plus wrong keys) reports `phrase_failed`
[§8.4 Assumption]; the phrase is played once more, then the melody goes on. Pressing a no-go ball reports
`nogo_pressed`. Session Rules decides what either costs. The set ends with `content_exhausted` when every melody
is done. The recommended mode is timed.

**Go/no-go (`go_no_go`, off by default).** Spiky balls (a thorn ball, warm; an ice ball, cold) fall in the gaps
between notes, never within 1.5 hit windows of a note on the same key; their share of all objects follows the
difficulty. They differ from notes by shape, not colour alone. Measures: hits, misses, false alarms, correct
rejections and d′ with the log-linear correction (Hautus 1995).

**Hemisphere (no new parameter).** Left → warm "Sunset Stage" (stage curtains and spotlights, sun drops, ivory
keys with dark-red black keys); right → cold "Moonlight Lake" (moon, stars and lake, water drops, indigo black
keys). With go/no-go on, three in four balls fall on the half of the keyboard that hemisphere sees (left → right
half). Melody notes stay where the tune puts them. The keyboard is physical: low notes on the left in every
language (like the timer side).

**Melodies.** Seven public-domain tunes written out in C: Hot Cross Buns, Au Clair de la Lune, Mary Had a Little
Lamb, Ode to Joy, Twinkle Twinkle Little Star, London Bridge, Row Row Row Your Boat. A keyboard offers only the
tunes that fit it (4 on 5 keys, all 7 on 8 and 13); on the 13-key keyboard each tune moves to the key that uses
the most black keys while still fitting. The order is shuffled with the session's seed. The design doc's
`melody_set` (classic / world / mixed) is not added: there is one set until more tunes are chosen.

**Sound.** Synthesised with Web Audio (no files, no network): a warm piano-like tone and a cold celesta-like
tone. A key with no note on it still sounds, softly (it is a piano); a pressed ball gives a soft low bump, never
a buzzer. The audio context starts on the first key press and follows pause; the session's `sound = off` mutes it.

**Practice.** A slow 6-note scale at 50 BPM with a wide hit window, no balls and no failures.

**Accessibility and tests.** The keyboard is real buttons named by note (C, C sharp … / דו, דו דיאז …), labelled
with letters in English and solfège in Hebrew; computer keys A–K (and W E T Y U for black keys) play them.

**Measures.** `per_melody`, `response_ms` mean / median / fastest (from when a note became tappable to the tap),
`timing_error_ms_mean` (signed: early is negative) and its absolute mean, accuracy, best streak, phrases failed,
melodies completed, and the go/no-go measures above. One trial event per note or ball; one level-history row
per melody.

## Consequences

- The tempo, phrase length and hit window per difficulty are the §8.4 assumptions, not pilot-fitted.
- Real piano and celesta samples (§8.5) can replace the synthesiser behind the same `Synth` interface.
