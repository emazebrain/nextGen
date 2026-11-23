/** Plans one round: picture, direction, movement type, where the outline sits, and the timing. Pure; seeded rng. */
import type { RegionCompass, RegionDirection, RegionParam } from "@emb/game-sdk";
import { glideSpeed, levelSettings } from "./config.ts";
import type { RoundPlan } from "./engine.ts";
import { DIRECTION_LIST, legsFor, locationBias, pathFor, pointAt, type Field, type Path, type Point } from "./motion.ts";
import type { Picture } from "./pictures.ts";

export interface RoundContext {
  level: number;
  picture: Picture;
  field: Field;
  rng: () => number;
  /** The brain-region row's motion pairs; absent when the step has no region filter. */
  motion?: RegionParam["motion"] | undefined;
  targetLocations?: RegionCompass[] | undefined;
  /** The therapist's fixed movement type (0–5), or null to follow the region. */
  movementType?: number | null;
  speedScale?: number;
  /** A circle the outline must stay clear of (the Stop button). */
  avoid?: { x: number; y: number; r: number } | undefined;
}

export interface RoundSpec {
  picture: Picture;
  level: number;
  direction: RegionDirection;
  movementType: number;
  path: Path;
  /** Picture length in px. */
  size: number;
  target: Point;
  plan: RoundPlan;
}

const pick = <T>(list: readonly T[], rng: () => number): T => list[Math.min(list.length - 1, Math.floor(rng() * list.length))]!;
const validType = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= 5;

export function planRound(ctx: RoundContext): RoundSpec {
  const { rng, field } = ctx;
  const pairs = (ctx.motion ?? []).filter((m) => m.directions.length > 0);
  const pair = pairs.length ? pick(pairs, rng) : null;
  const direction = pair ? pick(pair.directions, rng) : pick(["ltr", "rtl"] as RegionDirection[], rng);
  const types = (pair?.movement_types ?? []).filter(validType);
  const movementType = validType(ctx.movementType) ? ctx.movementType : types.length ? pick(types, rng) : 0;

  const settings = levelSettings(ctx.level);
  const size = settings.size * Math.min(field.w, field.h);
  const path = pathFor(DIRECTION_LIST.includes(direction) ? direction : "ltr", field, size);

  const bias = locationBias(direction, ctx.targetLocations?.length ? pick(ctx.targetLocations, rng) : undefined);
  const [lo, hi] = bias > 0 ? [0.55, 0.8] : bias < 0 ? [0.3, 0.55] : [0.35, 0.75];
  const [f0, f1] = path.onScreen;
  let u = lo + rng() * (hi - lo);
  let target = f0 + u * (f1 - f0);
  if (ctx.avoid) {
    const clear = ctx.avoid.r + size * 0.6;
    for (let i = 0; i < 12; i++) {
      const p = pointAt(path, target);
      if (Math.hypot(p.x - ctx.avoid.x, p.y - ctx.avoid.y) >= clear) break;
      u += u > 0.5 ? -0.05 : 0.05;
      target = f0 + u * (f1 - f0);
    }
  }

  const spots = settings.spots;
  const spotStep = (f1 - f0) / spots;
  const targetSpot = Math.max(1, Math.min(spots - 2, Math.round((target - f0) / spotStep)));
  const speed = glideSpeed(ctx.level, ctx.speedScale ?? 1) * size; // px per ms

  return {
    picture: ctx.picture,
    level: ctx.level,
    direction,
    movementType,
    path,
    size,
    target: pointAt(path, target),
    plan: {
      legs: legsFor(movementType),
      target,
      glideMs: path.length / speed,
      sizeShare: size / path.length,
      spots,
      dwellMs: Math.round(settings.dwellMs / Math.max(0.5, Math.min(1, ctx.speedScale ?? 1))),
      targetSpot,
      spotStep,
    },
  };
}
