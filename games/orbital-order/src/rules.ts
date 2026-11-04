/**
 * Orbital Order rules (ported from v1 `rules.js`, seeded): a rule is an order
 * (going up or going down) plus one colour to skip. The solver is the single
 * source of truth for the expected chain; the renderer never decides.
 *
 * Placement (ADR 0013): the first half of the expected chain leans (p = 0.75)
 * towards the side of the screen the chosen hemisphere sees. Probe and motor
 * trials stay even, so their left/right numbers have a clean baseline.
 */
import { DIFFICULTY, GLYPHS, glyphOrdinal, POOL_SIZE, TOKENS, type Difficulty, type GlyphType, type Token } from "./config.ts";

export type Ordering = "up" | "down";
export interface Rule {
  ordering: Ordering;
  /** Token id of the colour to skip. */
  skip: number;
}

export interface Sphere {
  id: string;
  token: number;
  glyph: string;
  /** Position in 0…1 of the play area (x across, y down). */
  x: number;
  y: number;
}

const pick = <T>(a: readonly T[], rng: () => number): T => a[Math.floor(rng() * a.length)]!;
export function shuffle<T>(a: readonly T[], rng: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
export const randInt = (lo: number, hi: number, rng: () => number) => lo + Math.floor(rng() * (hi - lo + 1));

const ruleKey = (r: Rule) => `${r.ordering}|${r.skip}`;

/**
 * The next rule: differs from the last by at least one part (two at difficulty 3 and up) and never repeats one
 * of the last three.
 */
export function nextRule(history: Rule[], difficulty: Difficulty, pool: number[], rng: () => number): Rule {
  const prev = history[history.length - 1];
  for (let attempt = 0; attempt < 60; attempt++) {
    const rule: Rule = { ordering: rng() < 0.5 ? "up" : "down", skip: pick(pool, rng) };
    if (prev) {
      const diffs = (rule.ordering !== prev.ordering ? 1 : 0) + (rule.skip !== prev.skip ? 1 : 0);
      if (diffs < (difficulty >= 3 ? 2 : 1)) continue;
    }
    if (history.slice(-3).some((h) => ruleKey(h) === ruleKey(rule))) continue;
    return rule;
  }
  return { ordering: prev?.ordering === "up" ? "down" : "up", skip: pool.find((t) => t !== prev?.skip) ?? pool[0]! };
}

/** CIE76 distance between two hex colours (for picking a pool of colours that are easy to tell apart). */
function lab(hex: string): [number, number, number] {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v > 0.04045 ? ((v + 0.055) / 1.055) ** 2.4 : v / 12.92));
  const [r, g, b] = c as [number, number, number];
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
export const colourDistance = (a: string, b: string) => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

/**
 * The session's 5 colours. v1 drew 5 of 8 at random; the v2 palettes have close neighbours (several oranges),
 * so this draws a random first colour and then adds the colour farthest from those already chosen (ADR 0013).
 */
export function sessionPool(palette: "warm" | "cold", rng: () => number): number[] {
  const tokens = TOKENS[palette];
  const chosen = [Math.floor(rng() * tokens.length)];
  while (chosen.length < POOL_SIZE) {
    let best = -1;
    let bestD = -1;
    for (const t of tokens) {
      if (chosen.includes(t.id)) continue;
      const d = Math.min(...chosen.map((c) => colourDistance(t.fill, tokens[c]!.fill)));
      if (d > bestD) {
        bestD = d;
        best = t.id;
      }
    }
    chosen.push(best);
  }
  return chosen;
}

/** The expected chain: every sphere not in the skip colour, in the rule's order. */
export function solveChain(rule: Rule, spheres: Sphere[], glyphType: GlyphType): string[] {
  const dir = rule.ordering === "up" ? 1 : -1;
  return spheres
    .filter((s) => s.token !== rule.skip)
    .sort((a, b) => dir * (glyphOrdinal(a.glyph, glyphType) - glyphOrdinal(b.glyph, glyphType)))
    .map((s) => s.id);
}

export type ErrorClass = "inhibition" | "order" | "timeout";

/** A wrong tap: on the skip colour (inhibition) or a target out of order (order). */
export function classifyTap(sphere: Sphere, rule: Rule): Exclude<ErrorClass, "timeout"> {
  return sphere.token === rule.skip ? "inhibition" : "order";
}

export interface LayoutOptions {
  difficulty: Difficulty;
  glyphType: GlyphType;
  pool: number[];
  /** Side the first half of the chain leans to (+1 right, −1 left), or null for even placement. */
  lean: -1 | 1 | null;
  rng: () => number;
}

/**
 * One trial's spheres. The skip colour is always the minority (fewer spheres than the targets), glyphs are
 * unique, and each sphere sits in its own jittered row band, so rows don't give away the order.
 */
export function makeSpheres(rule: Rule, o: LayoutOptions): Sphere[] {
  const { rng } = o;
  const n = DIFFICULTY[o.difficulty].spheres;
  const targetPool = o.pool.filter((c) => c !== rule.skip);
  const maxSkip = Math.max(1, Math.floor((n - 1) / 2));
  const skipCount = randInt(1, Math.min(maxSkip, Math.max(1, n - 2)), rng);
  const colours = shuffle([...Array.from({ length: n - skipCount }, (_, i) => targetPool[i % targetPool.length]!), ...Array.from({ length: skipCount }, () => rule.skip)], rng);
  const glyphs = shuffle(shuffle(GLYPHS[o.glyphType], rng).slice(0, n), rng);
  const bands = shuffle(Array.from({ length: n }, (_, i) => i), rng);
  const y0 = 0.08;
  const y1 = 0.92;
  const bandH = (y1 - y0) / n;
  const spheres: Sphere[] = colours.map((token, i) => ({
    id: `s${i}`,
    token,
    glyph: glyphs[i]!,
    x: 0,
    y: Math.min(y1 - 0.02, Math.max(y0 + 0.02, y0 + bands[i]! * bandH + bandH / 2 + 0.3 * (rng() - 0.5) * bandH)),
  }));
  // Across: the first half of the chain leans towards the hemisphere's visual field; everything else is even.
  const chain = solveChain(rule, spheres, o.glyphType);
  const early = new Set(chain.slice(0, Math.ceil(chain.length / 2)));
  for (const s of spheres) {
    const leanHere = o.lean !== null && early.has(s.id) && rng() < 0.75;
    const half = rng() * 0.38; // 0.12…0.5 or 0.5…0.88
    s.x = leanHere ? (o.lean === 1 ? 0.5 + 0.02 + half : 0.5 - 0.02 - half) : 0.12 + rng() * 0.76;
    s.x = Math.min(0.88, Math.max(0.12, s.x));
  }
  return spheres;
}

/** The side a sphere is on: −1 left of centre, +1 right, 0 on it. */
export const sideOf = (s: Sphere): "L" | "R" | "C" => (s.x < 0.5 ? "L" : s.x > 0.5 ? "R" : "C");

export const tokenOf = (palette: "warm" | "cold", id: number): Token => TOKENS[palette][id]!;
