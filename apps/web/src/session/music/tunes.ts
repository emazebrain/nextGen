/**
 * Background music for sessions, written as data (product owner, 2026-11-27). Pure: no clock, no audio, no
 * randomness beyond a fixed seed, so every tune is the same on every device and can be unit-tested.
 *
 * Music follows the hemisphere a game works:
 *   Right hemisphere — low tones (mostly Do, Re, Mi, in different keys), rhythms that keep changing, no lyrics,
 *     natural sounds (sea, wind, breathing), instruments like didgeridoo, cello, bass, trombone, low flute, bass drum.
 *   Left hemisphere  — higher tones (mostly Sol, La, Si, in different keys), repeating rhythms and patterns,
 *     pop/rock style, harmonious chords, instruments like guitar, trumpet, violin, piccolo.
 * These are generated sounds: there are no sung lyrics and no recordings. Recorded tracks can replace them later.
 */
export type Side = "left" | "right";
export type Voice = "cello" | "bass" | "trombone" | "flute" | "softdrum" | "kick" | "snare" | "hat" | "guitar" | "trumpet" | "violin" | "piccolo";
export type TextureKind = "waves" | "wind" | "breath";

export interface Note {
  /** Seconds from the start of the loop. */
  t: number;
  dur: number;
  /** MIDI note number (60 = middle C). Drums ignore it. */
  midi: number;
  voice: Voice;
  /** 0–1, before the player's master volume. */
  gain: number;
  /** Which part the note belongs to; `lead` is the melody the tone rules are about. */
  part: "lead" | "bass" | "chords" | "drums";
}

export interface Tune {
  id: string;
  side: Side;
  title: string;
  /** Loop length in seconds (at least 30). */
  length: number;
  notes: Note[];
  /** Natural-sound layers that run for the whole loop (right hemisphere only). */
  textures: { kind: TextureKind; gain: number }[];
  /** A held low note under everything (the didgeridoo). */
  drone: { midi: number; gain: number } | null;
  /** The key's Do, as a pitch class 0–11, for checking which scale degrees the melody uses. */
  tonic: number;
  scale: number[];
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const MINOR = [0, 2, 3, 5, 7, 8, 10];
const DORIAN = [0, 2, 3, 5, 7, 9, 10];

/** mulberry32: a small seeded generator, so the "changing" rhythms are still the same tune every time. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The MIDI note of a scale degree (1 = Do) in the octave that starts at `base`; degrees above 7 climb an octave. */
const degree = (base: number, scale: number[], d: number): number => base + scale[(d - 1) % 7]! + 12 * Math.floor((d - 1) / 7);
const round = (x: number) => Math.round(x * 1000) / 1000;

// ---------------------------------------------------------------------------------------------------- right hemisphere

interface RightSpec {
  id: string;
  title: string;
  seed: number;
  /** Do for the melody, MIDI (low register). */
  base: number;
  scale: number[];
  lead: Voice;
  textures: Tune["textures"];
  drone: boolean;
}

/**
 * A slow, low melody that mostly walks Do–Re–Mi, with note lengths and gaps that never settle into a pattern:
 * each length differs from the one before it. A bass note and a soft drum come in at uneven moments.
 */
function rightTune(spec: RightSpec): Tune {
  const rng = seeded(spec.seed);
  const length = 36;
  const notes: Note[] = [];
  const LENGTHS = [0.7, 1.0, 1.4, 1.9, 2.4, 3.0];
  const GAPS = [0, 0.25, 0.6, 1.1];
  // Do, Re, Mi carry the tune; the Sol and La below add colour now and then.
  const DEGREES = [1, 1, 1, 2, 2, 2, 3, 3, 3, 3, -2, -1];
  const pitch = (d: number) => (d > 0 ? degree(spec.base, spec.scale, d) : degree(spec.base - 12, spec.scale, d === -2 ? 5 : 6));

  let t = 0.8;
  let last = -1;
  let lastDegree = 0;
  while (true) {
    let i = Math.floor(rng() * LENGTHS.length);
    if (i === last) i = (i + 1 + Math.floor(rng() * (LENGTHS.length - 1))) % LENGTHS.length; // never the same length twice running
    last = i;
    const dur = LENGTHS[i]!;
    if (t + dur > length - 1.2) break;
    let d = DEGREES[Math.floor(rng() * DEGREES.length)]!;
    if (d === lastDegree) d = DEGREES[Math.floor(rng() * 10)]!;
    lastDegree = d;
    notes.push({ t: round(t), dur, midi: pitch(d), voice: spec.lead, gain: 0.5, part: "lead" });
    t += dur + GAPS[Math.floor(rng() * GAPS.length)]!;
  }

  // Bass: long notes on Do or the Sol below, at uneven distances.
  for (let b = 0.3; b < length - 4; b += 3.2 + rng() * 3.6) {
    notes.push({ t: round(b), dur: 2.6 + rng() * 1.2, midi: rng() < 0.65 ? spec.base - 12 : degree(spec.base - 24, spec.scale, 5), voice: "bass", gain: 0.5, part: "bass" });
  }
  // A soft, deep drum: sometimes one beat, sometimes two close together, never a steady pulse.
  for (let d = 1.6 + rng() * 1.5; d < length - 1; d += 1.3 + rng() * 2.9) {
    notes.push({ t: round(d), dur: 0.4, midi: 36, voice: "softdrum", gain: 0.55, part: "drums" });
    if (rng() < 0.35 && d + 0.45 < length - 1) notes.push({ t: round(d + 0.32 + rng() * 0.2), dur: 0.3, midi: 36, voice: "softdrum", gain: 0.35, part: "drums" });
  }

  notes.sort((a, b) => a.t - b.t);
  return { id: spec.id, side: "right", title: spec.title, length, notes, textures: spec.textures, drone: spec.drone ? { midi: spec.base - 24, gain: 0.22 } : null, tonic: spec.base % 12, scale: spec.scale };
}

// ----------------------------------------------------------------------------------------------------- left hemisphere

interface LeftSpec {
  id: string;
  title: string;
  bpm: number;
  /** Do in the octave around middle C, MIDI. */
  base: number;
  lead: Voice;
  /** The lead joins in for the second half too, an octave up, on this voice. */
  shine: Voice;
  /** Two bars of melody as [eighth-note position 0–15, scale degree, length in eighths]. Mostly Sol (5), La (6), Si (7). */
  motif: Array<[number, number, number]>;
}

/**
 * Sixteen bars of steady 4/4 pop-rock: the same drum beat every bar, a bass on every beat, a strummed guitar
 * arpeggio, and a two-bar melody on Sol–La–Si that repeats over the harmonious I–V–vi–IV chords.
 */
function leftTune(spec: LeftSpec): Tune {
  const beat = 60 / spec.bpm;
  const eighth = beat / 2;
  const bars = 16;
  const length = round(bars * 4 * beat);
  const notes: Note[] = [];
  const PROGRESSION = [1, 5, 6, 4]; // I – V – vi – IV
  const lead = spec.base + 12;

  for (let bar = 0; bar < bars; bar++) {
    const t0 = bar * 4 * beat;
    const root = PROGRESSION[bar % 4]!;
    const chord = [root, root + 2, root + 4].map((d) => degree(spec.base, MAJOR, d));
    for (let b = 0; b < 4; b++) {
      // Drums: kick on 1 and 3, snare on 2 and 4, a hi-hat on every eighth.
      notes.push({ t: round(t0 + b * beat), dur: 0.2, midi: 36, voice: b % 2 === 0 ? "kick" : "snare", gain: b % 2 === 0 ? 0.6 : 0.4, part: "drums" });
      notes.push({ t: round(t0 + b * beat), dur: 0.05, midi: 80, voice: "hat", gain: 0.16, part: "drums" });
      notes.push({ t: round(t0 + b * beat + eighth), dur: 0.05, midi: 80, voice: "hat", gain: 0.1, part: "drums" });
      // Bass: the chord's root on every beat.
      notes.push({ t: round(t0 + b * beat), dur: beat * 0.9, midi: degree(spec.base - 24, MAJOR, root), voice: "bass", gain: 0.5, part: "bass" });
    }
    // Guitar: the chord broken into eighths, the same shape in every bar.
    [0, 1, 2, 1, 0, 1, 2, 1].forEach((n, i) => notes.push({ t: round(t0 + i * eighth), dur: eighth * 1.6, midi: chord[n]!, voice: "guitar", gain: 0.3, part: "chords" }));
    // Melody: the two-bar motif, starting again every two bars.
    for (const [pos, d, len] of spec.motif) {
      if (Math.floor(pos / 8) !== bar % 2) continue;
      const at = t0 + (pos % 8) * eighth;
      notes.push({ t: round(at), dur: len * eighth * 0.92, midi: degree(lead, MAJOR, d), voice: spec.lead, gain: 0.42, part: "lead" });
      if (bar >= 8) notes.push({ t: round(at), dur: len * eighth * 0.92, midi: degree(lead + 12, MAJOR, d), voice: spec.shine, gain: 0.2, part: "lead" });
    }
  }
  notes.sort((a, b) => a.t - b.t);
  return { id: spec.id, side: "left", title: spec.title, length, notes, textures: [], drone: null, tonic: spec.base % 12, scale: MAJOR };
}

// -------------------------------------------------------------------------------------------------------------- tunes

export const TUNES: Tune[] = [
  rightTune({ id: "right-sea", title: "Deep sea", seed: 11, base: 48, scale: MAJOR, lead: "cello", textures: [{ kind: "waves", gain: 0.5 }], drone: true }), // C
  rightTune({ id: "right-wind", title: "Wind over the hills", seed: 23, base: 50, scale: DORIAN, lead: "flute", textures: [{ kind: "wind", gain: 0.45 }], drone: false }), // D
  rightTune({ id: "right-breath", title: "Slow breath", seed: 37, base: 45, scale: MINOR, lead: "trombone", textures: [{ kind: "breath", gain: 0.4 }, { kind: "waves", gain: 0.2 }], drone: true }), // A
  leftTune({
    id: "left-sunny", title: "Sunny road", bpm: 120, base: 55, lead: "trumpet", shine: "piccolo", // G
    motif: [[0, 5, 2], [2, 6, 2], [4, 7, 2], [6, 6, 2], [8, 5, 2], [10, 7, 2], [12, 6, 4]],
  }),
  leftTune({
    id: "left-skip", title: "Skipping along", bpm: 126, base: 60, lead: "violin", shine: "piccolo", // C
    motif: [[0, 7, 1], [1, 6, 1], [2, 5, 2], [4, 6, 2], [6, 7, 2], [8, 8, 2], [10, 7, 2], [12, 6, 2], [14, 5, 2]],
  }),
  leftTune({
    id: "left-band", title: "Garage band", bpm: 112, base: 57, lead: "guitar", shine: "trumpet", // A
    motif: [[0, 5, 3], [3, 6, 1], [4, 7, 4], [8, 6, 2], [10, 5, 2], [12, 6, 2], [14, 7, 2]],
  }),
];

export const tunesFor = (side: Side): Tune[] => TUNES.filter((t) => t.side === side);
/** The tune for a session: each side has three, taken in turn by the session's number. */
export function pickTune(side: Side, n: number): Tune {
  const list = tunesFor(side);
  return list[((Math.trunc(n) % list.length) + list.length) % list.length]!;
}
export const midiHz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12);
/** Which scale degree (1 = Do … 7 = Si) a note is in its tune's key, or null when it is outside the scale. */
export function degreeOf(tune: Tune, midi: number): number | null {
  const i = tune.scale.indexOf((((midi - tune.tonic) % 12) + 12) % 12);
  return i < 0 ? null : i + 1;
}
