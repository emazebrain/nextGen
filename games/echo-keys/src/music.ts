/**
 * Echo Keys music: the keyboards, the melodies and how they're fitted to a keyboard (design doc §8.4). Pure data.
 *
 * Every melody is public domain (traditional, or composed long before 1929) and is written here in C, as
 * [MIDI note, beats]. A melody is offered on a keyboard only if it fits; on the 13-key (chromatic) keyboard each
 * melody is moved to the key that uses the most black keys while still fitting (ADR 0016).
 */

export type Difficulty = 1 | 2 | 3 | 4 | 5;
export type Note = [midi: number, beats: number];

export interface Melody {
  id: string;
  notes: Note[];
}

/** Keys by size: 5 = C to G, 8 = the C major octave, 13 = every key from C to the next C. */
export const KEYBOARDS: Record<5 | 8 | 13, number[]> = {
  5: [60, 62, 64, 65, 67],
  8: [60, 62, 64, 65, 67, 69, 71, 72],
  13: [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72],
};

export const isBlack = (midi: number) => [1, 3, 6, 8, 10].includes(((midi % 12) + 12) % 12);

const C = 60, D = 62, E = 64, F = 65, G = 67, A = 69, C5 = 72;

/** Public-domain children's tunes (ADR 0016). */
export const MELODIES: Melody[] = [
  {
    id: "hot_cross_buns", // traditional English street cry
    notes: [[E, 1], [D, 1], [C, 2], [E, 1], [D, 1], [C, 2], [C, 0.5], [C, 0.5], [C, 0.5], [C, 0.5], [D, 0.5], [D, 0.5], [D, 0.5], [D, 0.5], [E, 1], [D, 1], [C, 2]],
  },
  {
    id: "au_clair", // French folk song, 18th century
    notes: [[C, 1], [C, 1], [C, 1], [D, 1], [E, 2], [D, 2], [C, 1], [E, 1], [D, 1], [D, 1], [C, 4]],
  },
  {
    id: "mary_lamb", // Sarah Josepha Hale, 1830; traditional tune
    notes: [[E, 1], [D, 1], [C, 1], [D, 1], [E, 1], [E, 1], [E, 2], [D, 1], [D, 1], [D, 2], [E, 1], [G, 1], [G, 2], [E, 1], [D, 1], [C, 1], [D, 1], [E, 1], [E, 1], [E, 1], [E, 1], [D, 1], [D, 1], [E, 1], [D, 1], [C, 4]],
  },
  {
    id: "ode_to_joy", // Beethoven, Symphony No. 9, 1824
    notes: [[E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [E, 1.5], [D, 0.5], [D, 2], [E, 1], [E, 1], [F, 1], [G, 1], [G, 1], [F, 1], [E, 1], [D, 1], [C, 1], [C, 1], [D, 1], [E, 1], [D, 1.5], [C, 0.5], [C, 2]],
  },
  {
    id: "twinkle", // French folk tune "Ah! vous dirai-je, maman", 1761
    notes: [[C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2], [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2], [G, 1], [G, 1], [F, 1], [F, 1], [E, 1], [E, 1], [D, 2], [C, 1], [C, 1], [G, 1], [G, 1], [A, 1], [A, 1], [G, 2], [F, 1], [F, 1], [E, 1], [E, 1], [D, 1], [D, 1], [C, 2]],
  },
  {
    id: "london_bridge", // traditional English nursery rhyme
    notes: [[G, 1.5], [A, 0.5], [G, 1], [F, 1], [E, 1], [F, 1], [G, 2], [D, 1], [E, 1], [F, 2], [E, 1], [F, 1], [G, 2], [G, 1.5], [A, 0.5], [G, 1], [F, 1], [E, 1], [F, 1], [G, 2], [D, 2], [G, 2], [E, 1], [C, 3]],
  },
  {
    id: "row_boat", // traditional, published 1852
    notes: [[C, 1], [C, 1], [C, 0.75], [D, 0.25], [E, 1], [E, 0.75], [D, 0.25], [E, 0.75], [F, 0.25], [G, 2], [C5, 0.5], [C5, 0.5], [G, 0.5], [G, 0.5], [E, 0.5], [E, 0.5], [C, 0.5], [C, 0.5], [G, 0.75], [F, 0.25], [E, 0.75], [D, 0.25], [C, 2]],
  },
];

/** Keys, tempo, notes per phrase, hit window and no-go share by difficulty (§8.4 [Assumption: v1 had none]). */
export const DIFFICULTY: Record<Difficulty, { keys: 5 | 8 | 13; bpm: number; phrase: [number, number]; windowMs: number; nogoRate: number }> = {
  1: { keys: 5, bpm: 60, phrase: [4, 6], windowMs: 350, nogoRate: 0.1 },
  2: { keys: 5, bpm: 72, phrase: [6, 8], windowMs: 300, nogoRate: 0.15 },
  3: { keys: 8, bpm: 84, phrase: [8, 10], windowMs: 250, nogoRate: 0.2 },
  4: { keys: 8, bpm: 96, phrase: [10, 14], windowMs: 200, nogoRate: 0.25 },
  5: { keys: 13, bpm: 108, phrase: [14, 14], windowMs: 160, nogoRate: 0.3 },
};

/** Practice: a slow 6-note scale, no no-go balls (§8.4). */
export const PRACTICE: Melody = { id: "practice", notes: [[C, 1], [D, 1], [E, 1], [F, 1], [G, 1], [E, 2]] };
export const PRACTICE_BPM = 50;

/** The shift (in semitones) that fits a melody on a keyboard, or null if it can't fit. */
export function fitShift(m: Melody, keys: number[]): number | null {
  const lo = Math.min(...m.notes.map((n) => n[0]));
  const hi = Math.max(...m.notes.map((n) => n[0]));
  const set = new Set(keys);
  let best: number | null = null;
  let bestBlack = -1;
  for (let t = -12; t <= 12; t++) {
    if (lo + t < keys[0]! || hi + t > keys[keys.length - 1]!) continue;
    if (!m.notes.every((n) => set.has(n[0] + t))) continue;
    const black = keys.length === 13 ? m.notes.filter((n) => isBlack(n[0] + t)).length : 0;
    // On the chromatic keyboard, prefer the key with the most black keys; otherwise stay as close to C as possible.
    if (black > bestBlack || (black === bestBlack && best !== null && Math.abs(t) < Math.abs(best))) {
      best = t;
      bestBlack = black;
    }
  }
  return best;
}

/** The melodies a keyboard can play, already moved into place. */
export function melodiesFor(keys: number[]): Melody[] {
  const out: Melody[] = [];
  for (const m of MELODIES) {
    const t = fitShift(m, keys);
    if (t === null) continue;
    out.push({ id: m.id, notes: m.notes.map(([n, b]) => [n + t, b] as Note) });
  }
  return out;
}

/** Splits a melody into phrases of a size within [lo, hi], as evenly as possible (a short melody is one phrase). */
export function phrases(m: Melody, [lo, hi]: [number, number]): Note[][] {
  const n = m.notes.length;
  if (n <= hi) return [m.notes];
  let count = Math.ceil(n / hi);
  while (count > 1 && n / count < lo) count--;
  const out: Note[][] = [];
  let i = 0;
  for (let k = 0; k < count; k++) {
    const size = Math.round((n - i) / (count - k));
    out.push(m.notes.slice(i, i + size));
    i += size;
  }
  return out;
}
