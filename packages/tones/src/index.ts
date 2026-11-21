/**
 * Pulsed audio tone logic for eMazeBrain sessions (proprietary).
 *
 * This package is pure — no I/O, no clock, fully testable.
 *
 * During a session, games and videos can play background pulsed tones
 * in each ear at frequencies determined by the patient's age group and
 * which hemisphere has the deficit.
 *
 * Base tones:
 *   Right ear: 440 Hz carrier
 *   Left ear:  128 Hz carrier
 *
 * What varies per age group and hemisphere is the PULSE RATE — how many
 * short beeps per second of that carrier tone are played.
 *
 * Each pulse lasts ~10 ms (1/100 of a second).
 *
 * IMPORTANT: The frequency tables in this file are intellectual property.
 * They must NEVER be sent to the client as a full table. Only the computed
 * pulse rates for the current session are sent via the launch API.
 */

// ── Age groups ───────────────────────────────────────────────────────

export interface ToneAgeGroup {
  /** Original group number from the clinical spec. */
  id: number;
  /** Human-readable label (shown to therapists). */
  label: string;
  /** Minimum age in years (inclusive). null = no minimum. */
  ageMin: number | null;
  /** Maximum age in years (inclusive). null = no maximum. */
  ageMax: number | null;
  /** Special groups that don't auto-match by age. */
  special?: "brain_integration" | "severe_tics" | undefined;
  /** Which hemisphere deficits this group supports. */
  hemispheres: Array<"left" | "right">;
}

/**
 * The 11 clinical age groups (broad ranges removed per product decision).
 * Group 16 (brain integration) is excluded from v1.
 */
export const TONE_AGE_GROUPS: ToneAgeGroup[] = [
  { id: 2,  label: "1 year",               ageMin: 0,  ageMax: 1,  hemispheres: ["left", "right"] },
  { id: 3,  label: "2 years",              ageMin: 2,  ageMax: 2,  hemispheres: ["left", "right"] },
  { id: 5,  label: "3–4 years",            ageMin: 3,  ageMax: 4,  hemispheres: ["left", "right"] },
  { id: 6,  label: "5 years",              ageMin: 5,  ageMax: 5,  hemispheres: ["left", "right"] },
  { id: 8,  label: "6–7 years",            ageMin: 6,  ageMax: 7,  hemispheres: ["left", "right"] },
  { id: 9,  label: "8–10 years",           ageMin: 8,  ageMax: 10, hemispheres: ["left", "right"] },
  { id: 11, label: "11–13 years",          ageMin: 11, ageMax: 13, hemispheres: ["left", "right"] },
  { id: 12, label: "14–16 years",          ageMin: 14, ageMax: 16, hemispheres: ["left", "right"] },
  { id: 14, label: "17–21 years",          ageMin: 17, ageMax: 21, hemispheres: ["left", "right"] },
  { id: 15, label: "21+ years",            ageMin: 22, ageMax: null, hemispheres: ["left", "right"] },
  { id: 17, label: "17+ severe tics",      ageMin: 17, ageMax: null, special: "severe_tics", hemispheres: ["right"] },
];

/** Find the age group that best matches a patient's age in years. Excludes special groups. */
export function autoAgeGroup(ageYears: number): ToneAgeGroup | null {
  // Find the narrowest matching non-special group.
  let best: ToneAgeGroup | null = null;
  for (const g of TONE_AGE_GROUPS) {
    if (g.special) continue;
    const min = g.ageMin ?? 0;
    const max = g.ageMax ?? 999;
    if (ageYears >= min && ageYears <= max) {
      if (!best) {
        best = g;
      } else {
        // Prefer narrower range
        const bestRange = (best.ageMax ?? 999) - (best.ageMin ?? 0);
        const thisRange = max - min;
        if (thisRange < bestRange) best = g;
      }
    }
  }
  return best;
}

/** Compute patient age in whole years from date of birth. */
export function ageInYears(dob: string, today?: string): number {
  const [by, bm, bd] = dob.split("-").map(Number) as [number, number, number];
  const ref = today ? today.split("-").map(Number) as [number, number, number] : (() => { const d = new Date(); return [d.getFullYear(), d.getMonth() + 1, d.getDate()] as [number, number, number]; })();
  let age = ref[0] - by;
  if (ref[1] < bm || (ref[1] === bm && ref[2] < bd)) age--;
  return Math.max(0, age);
}

/** Look up a group by its numeric ID. */
export function findAgeGroup(id: number): ToneAgeGroup | undefined {
  return TONE_AGE_GROUPS.find((g) => g.id === id);
}

// ── Pulse rate tables (PROPRIETARY — never send to client as a table) ──

/**
 * Pulse rates per age group: how many beeps per second for each ear.
 *
 * "right brain deficit" = patient's right hemisphere is underperforming.
 * "left brain deficit"  = patient's left hemisphere is underperforming.
 */
interface PulseRates {
  leftEar: number;
  rightEar: number;
}

// Key: `${groupId}:${deficit}` where deficit is "left" or "right"
const PULSE_TABLE: Record<string, PulseRates> = {
  // Right brain deficit
  "2:right":  { leftEar: 3,  rightEar: 1 },
  "3:right":  { leftEar: 4,  rightEar: 2 },
  "5:right":  { leftEar: 4,  rightEar: 1 },
  "6:right":  { leftEar: 5,  rightEar: 2 },
  "8:right":  { leftEar: 7,  rightEar: 2 },
  "9:right":  { leftEar: 9,  rightEar: 3 },
  "11:right": { leftEar: 12, rightEar: 2 },
  "12:right": { leftEar: 15, rightEar: 2 },
  "14:right": { leftEar: 20, rightEar: 2 },
  "15:right": { leftEar: 30, rightEar: 4 },
  "17:right": { leftEar: 30, rightEar: 1 },

  // Left brain deficit
  "2:left":  { leftEar: 1,  rightEar: 3 },
  "3:left":  { leftEar: 2,  rightEar: 4 },
  "5:left":  { leftEar: 2,  rightEar: 8 },
  "6:left":  { leftEar: 6,  rightEar: 13 },
  "8:left":  { leftEar: 2,  rightEar: 10 },
  "9:left":  { leftEar: 4,  rightEar: 20 },
  "11:left": { leftEar: 2,  rightEar: 11 },
  "12:left": { leftEar: 4,  rightEar: 25 },
  "14:left": { leftEar: 3,  rightEar: 18 },
  "15:left": { leftEar: 5,  rightEar: 30 },
};

// ── Carrier tones ────────────────────────────────────────────────────

/** Right ear carrier: 440 Hz. */
export const RIGHT_EAR_CARRIER_HZ = 440;

/** Left ear carrier: 128 Hz. */
export const LEFT_EAR_CARRIER_HZ = 128;

/** Duration of each pulse in seconds (~10 ms). */
export const PULSE_DURATION_S = 0.01;

// ── Public lookup ────────────────────────────────────────────────────

export interface ToneParams {
  /** Carrier frequency for the left ear (always 128 Hz). */
  leftCarrierHz: number;
  /** Carrier frequency for the right ear (always 440 Hz). */
  rightCarrierHz: number;
  /** Pulses per second for the left ear. */
  leftPulseRate: number;
  /** Pulses per second for the right ear. */
  rightPulseRate: number;
  /** Duration of each pulse in seconds. */
  pulseDurationS: number;
}

/**
 * Compute the tone parameters for a session step.
 *
 * @param ageGroupId — the numeric age group (from TONE_AGE_GROUPS).
 * @param hemisphere — which hemisphere has the deficit ("left" or "right").
 * @returns The tone parameters, or null if the combination is invalid.
 *
 * This is the ONLY function that should be called from the API to get
 * tone data. It returns just the computed values, never the full table.
 */
export function toneParams(ageGroupId: number, hemisphere: "left" | "right"): ToneParams | null {
  const key = `${ageGroupId}:${hemisphere}`;
  const rates = PULSE_TABLE[key];
  if (!rates) return null;
  return {
    leftCarrierHz: LEFT_EAR_CARRIER_HZ,
    rightCarrierHz: RIGHT_EAR_CARRIER_HZ,
    leftPulseRate: rates.leftEar,
    rightPulseRate: rates.rightEar,
    pulseDurationS: PULSE_DURATION_S,
  };
}

/**
 * Convenience: get tone params from patient DOB and hemisphere.
 * Uses auto age group selection. Returns null if no match or if
 * tone_age_group override is provided but invalid.
 */
export function toneParamsForPatient(
  dob: string,
  hemisphere: "left" | "right",
  overrideGroupId?: number | null,
  today?: string,
): ToneParams | null {
  if (overrideGroupId != null) {
    return toneParams(overrideGroupId, hemisphere);
  }
  const age = ageInYears(dob, today);
  const group = autoAgeGroup(age);
  if (!group) return null;
  return toneParams(group.id, hemisphere);
}
