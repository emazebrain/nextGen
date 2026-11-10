/**
 * Picture Trail: building a round (spec 2026-11-10). Pure: randomness only through the injected rng.
 */
import type { AgeBand } from "./config.ts";
import { alongSide, type Compass, type Direction } from "./geometry.ts";
import { PICTURES, type Picture } from "./pictures.ts";

const BAND_ORDER: AgeBand[] = ["4-6", "7-9", "10-12", "13+"];
/** Chance the match goes in the half of the line nearest the target location. */
export const TARGET_BIAS = 0.8;

export interface RegionLike {
  motion: Array<{ movement_types: number[]; directions: string[] }>;
  target_locations: string[];
}
export interface DirectionParams {
  hemisphere: "left" | "right";
  region?: RegionLike;
  /** The step's own setting, used only without a brain-region filter. */
  direction?: string;
}

export interface Round {
  direction: Direction;
  target: Compass | undefined;
  n: number;
  question: Picture[];
  answer: Picture[];
  /** The match's slot in the question run and in the answer run. */
  matchQ: number;
  matchA: number;
  lure: boolean;
}

/** The pictures for an age band: its own and every younger band's. */
export function picturesFor(band: AgeBand): Picture[] {
  const max = BAND_ORDER.indexOf(band);
  return PICTURES.filter((p) => BAND_ORDER.indexOf(p.band) <= max);
}

/**
 * Directions a round may use. With a filter: the directions listed with movement type 0 (else the first entry's), as
 * given, duplicates included. Without one: the step's fixed direction, or left to right for the right hemisphere and
 * right to left for the left.
 */
export function directionsFor(p: DirectionParams): Direction[] {
  if (p.region) {
    const entry = p.region.motion.find((m) => m.movement_types.includes(0)) ?? p.region.motion[0];
    if (entry?.directions.length) return entry.directions as Direction[];
  }
  if (p.direction && p.direction !== "auto") return [p.direction as Direction];
  return [p.hemisphere === "right" ? "ltr" : "rtl"];
}

export function targetsFor(p: DirectionParams): Compass[] {
  return (p.region?.target_locations ?? []) as Compass[];
}

const pick = <T,>(rng: () => number, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
function shuffle<T>(rng: () => number, xs: T[]): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export interface RoundContext {
  level: number;
  band: AgeBand;
  lures: boolean;
  directions: Direction[];
  targets: Compass[];
  /** Pictures shown so far this session; refilled when too few are left. The round adds its own. */
  used: Set<string>;
  /** Pictures per run, after the screen's cap. */
  n: number;
}

export function buildRound(rng: () => number, c: RoundContext): Round {
  const n = Math.max(2, c.n);
  const all = picturesFor(c.band);
  const need = 2 * n - 1;
  let fresh = all.filter((p) => !c.used.has(p.id));
  if (fresh.length < need) {
    c.used.clear(); // the set is used up: start again, still never repeating within a round
    fresh = all;
  }
  const direction = pick(rng, c.directions);
  const target = c.targets.length ? pick(rng, c.targets) : undefined;

  const question = shuffle(rng, fresh).slice(0, n);
  const matchQ = Math.floor(rng() * n);
  const match = question[matchQ]!;
  const inQuestion = new Set(question.map((p) => p.id));
  let rest = shuffle(rng, fresh.filter((p) => !inQuestion.has(p.id)));
  let others: Picture[] = [];
  if (c.lures) {
    const alike = rest.filter((p) => p.category === match.category).slice(0, Math.ceil((n - 1) / 2));
    others = alike;
    rest = rest.filter((p) => !alike.includes(p));
  }
  others = shuffle(rng, [...others, ...rest.slice(0, n - 1 - others.length)]);

  // The match's answer slot: biased into the half nearest the target location.
  const side = target ? alongSide(direction, target) : 0;
  const half = Math.floor(n / 2);
  const near = side === -1 ? [...Array(half).keys()] : side === 1 ? [...Array(half).keys()].map((i) => n - 1 - i) : [];
  const matchA = near.length && rng() < TARGET_BIAS ? pick(rng, near) : Math.floor(rng() * n);
  const answer = [...others];
  answer.splice(matchA, 0, match);

  for (const p of [...question, ...answer]) c.used.add(p.id);
  return { direction, target, n, question, answer, matchQ, matchA, lure: c.lures };
}
