export type BodyPart = "hand" | "arm" | "foot" | "ear";
export type AgeBand = "4-6" | "7-9" | "10-12" | "13+";
export type Side = "left" | "right";

export interface Pose {
  id: string;
  bodyPart: BodyPart;
  minBand: AgeBand;
  svgFile: string;
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
): Pose => ({
  id,
  bodyPart,
  minBand,
  svgFile: `${bodyPart}-${id}-r.svg`,
  canFlip: true,
});

export const POSES: Pose[] = [
  // Hands — available from age 4 (band "4-6")
  pose("thumbsup", "hand", "4-6"),
  pose("pointing", "hand", "4-6"),
  pose("openpalm", "hand", "4-6"),
  pose("pinch", "hand", "4-6"),
  pose("peace", "hand", "4-6"),
  pose("fist", "hand", "4-6"),
  pose("wave", "hand", "4-6"),
  pose("grab", "hand", "4-6"),

  // Arms — available from age 7 (band "7-9")
  pose("extended", "arm", "7-9"),
  pose("bent-elbow", "arm", "7-9"),
  pose("reaching-up", "arm", "7-9"),
  pose("reaching-down", "arm", "7-9"),

  // Feet — available from age 7 (band "7-9")
  pose("top-view", "foot", "7-9"),
  pose("side-view", "foot", "7-9"),
  pose("sole", "foot", "7-9"),

  // Ears — available from age 10 (band "10-12")
  pose("profile", "ear", "10-12"),
  pose("angled", "ear", "10-12"),
  pose("from-behind", "ear", "10-12"),
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
