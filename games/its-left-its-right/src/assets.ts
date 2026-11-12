export type BodyPart = "hand" | "arm" | "foot" | "ear";
export type AgeBand = "4-6" | "7-9" | "10-12" | "13+";
export type Side = "left" | "right";

export interface Pose {
  id: string;
  bodyPart: BodyPart;
  minBand: AgeBand;
  imageFile: string;
  canFlip: boolean;
}

export const BAND_ORDER: Record<AgeBand, number> = {
  "4-6": 0,
  "7-9": 1,
  "10-12": 2,
  "13+": 3,
};

const pose = (
  id: string,
  bodyPart: BodyPart,
  minBand: AgeBand,
  canFlip = true,
): Pose => ({
  id,
  bodyPart,
  minBand,
  imageFile: `${bodyPart}-${id}-r.png`,
  canFlip,
});

export const POSES: Pose[] = [
  // Hands — available from age 4 (band "4-6")
  // 3D rendered hands
  pose("pointing", "hand", "4-6"),
  pose("openpalm", "hand", "4-6"),
  pose("backhand", "hand", "4-6"),
  pose("thumbsup", "hand", "4-6"),
  pose("stop", "hand", "4-6"),

  // 2D illustrated hands — origami
  pose("crane", "hand", "4-6"),
  pose("fox-side", "hand", "4-6"),
  pose("fox-up", "hand", "4-6"),
  pose("dog", "hand", "4-6"),

  // 2D illustrated hands — vegetables/food
  pose("tomato-cup", "hand", "4-6"),
  pose("tomatoes-pile", "hand", "4-6"),
  pose("tomato-grip", "hand", "4-6"),
  pose("pepper-red-cup", "hand", "4-6"),
  pose("pepper-red-flat", "hand", "4-6"),
  pose("pepper-red-pinch", "hand", "4-6"),
  pose("pepper-green-pinch", "hand", "4-6"),
  pose("herbs-pinch", "hand", "4-6"),
  pose("potato-cup", "hand", "4-6"),
  pose("bun-cup", "hand", "4-6"),

  // Arms — to be added later (band "7-9")
  // Feet — to be added later (band "7-9")
  // Ears — to be added later (band "10-12")
];

/**
 * Filter poses by age band and optionally by allowed body parts.
 * Falls back to all age-eligible poses if the body-part filter
 * leaves an empty set (Review Focus #5).
 */
export function posesFor(ageBand: AgeBand, bodyParts?: BodyPart[]): Pose[] {
  const bandIdx = BAND_ORDER[ageBand];
  const ageEligible = POSES.filter(
    (p) => BAND_ORDER[p.minBand] <= bandIdx,
  );

  if (!bodyParts || bodyParts.length === 0) return ageEligible;

  const filtered = ageEligible.filter((p) =>
    bodyParts.includes(p.bodyPart),
  );

  // Fallback: if the filter leaves nothing, return all age-eligible poses
  return filtered.length > 0 ? filtered : ageEligible;
}
