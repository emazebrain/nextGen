import type { AgeBand, BodyPart, Pose, Side } from "./assets.ts";
import { posesFor } from "./assets.ts";
import { bodyPartsForLevel, rotationRange } from "./config.ts";

export interface RoundSpec {
  pose: Pose;
  side: Side;
  rotationDeg: number;
  rotationDir: "cw" | "ccw";
  correctSide: Side;
}

export interface RoundContext {
  level: number;
  ageBand: AgeBand;
  bodyParts?: BodyPart[];
  maxRotation?: number;
  rotationBias?: "cw" | "ccw";
  rng: () => number;
}

/**
 * Generate a single round specification.
 *
 * - Picks a random pose from level- and age-eligible set
 * - 50/50 left/right side
 * - Rotation up to rotationRange(level), clamped by maxRotation if set
 * - 80/20 bias toward rotationBias direction (default cw)
 * - correctSide always equals the displayed side
 */
export function generateRound(ctx: RoundContext): RoundSpec {
  const { level, ageBand, bodyParts, maxRotation, rng } = ctx;

  // Therapist body-part override takes precedence over level-based
  // progression; when set, the therapist decides which parts appear
  // regardless of level. Without an override, level gates the parts.
  const levelParts = bodyPartsForLevel(level);
  const eligible = posesFor(ageBand, bodyParts ?? levelParts);

  // Pick a random pose
  const pose = eligible[Math.floor(rng() * eligible.length)]!;

  // 50/50 side — but if the pose cannot be flipped, force canonical ("right")
  const side: Side = !pose.canFlip ? "right" : rng() < 0.5 ? "left" : "right";

  // Rotation: up to rotationRange, clamped by maxRotation
  let maxDeg = rotationRange(level);
  if (maxRotation !== undefined && maxRotation > 0) {
    maxDeg = Math.min(maxDeg, maxRotation);
  }
  const rotationDeg = Math.floor(rng() * (maxDeg + 1));

  // 80/20 CW/CCW bias
  const bias = ctx.rotationBias ?? "cw";
  const anti = bias === "cw" ? "ccw" : "cw";
  const rotationDir: "cw" | "ccw" = rng() < 0.8 ? bias : anti;

  return {
    pose,
    side,
    rotationDeg,
    rotationDir,
    correctSide: side,
  };
}
