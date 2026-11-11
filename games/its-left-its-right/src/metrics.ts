import type { RoundRecord } from "./engine.ts";

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

const ROTATION_THRESHOLD = 45;

/**
 * Compute clinical metrics from a session's round records.
 *
 * Returns null values for metrics that cannot be computed
 * (e.g. no records, no correct answers for RT).
 */
export function computeMetrics(
  records: RoundRecord[],
): Record<string, number | null> {
  if (records.length === 0) {
    return {
      accuracy: null,
      omission_rate: null,
      wrong_rate: null,
      rt_correct_ms: null,
      left_accuracy: null,
      right_accuracy: null,
      hand_accuracy: null,
      rotation_effect_ms: null,
      best_streak: null,
      highest_level: null,
    };
  }

  const total = records.length;
  const correct = records.filter((r) => r.outcome === "correct");
  const wrong = records.filter((r) => r.outcome === "wrong");
  const omissions = records.filter((r) => r.outcome === "omission");

  // Accuracy rates
  const accuracy = correct.length / total;
  const wrong_rate = wrong.length / total;
  const omission_rate = omissions.length / total;

  // Median RT for correct answers
  const correctRts = correct
    .map((r) => r.rt_ms)
    .filter((v): v is number => v !== null);
  const rt_correct_ms = median(correctRts);

  // Per-side accuracy
  const leftTrials = records.filter((r) => r.correctSide === "left");
  const rightTrials = records.filter((r) => r.correctSide === "right");
  const left_accuracy =
    leftTrials.length > 0
      ? leftTrials.filter((r) => r.outcome === "correct").length /
        leftTrials.length
      : null;
  const right_accuracy =
    rightTrials.length > 0
      ? rightTrials.filter((r) => r.outcome === "correct").length /
        rightTrials.length
      : null;

  // Hand accuracy
  const handTrials = records.filter((r) => r.bodyPart === "hand");
  const hand_accuracy =
    handTrials.length > 0
      ? handTrials.filter((r) => r.outcome === "correct").length /
        handTrials.length
      : null;

  // Rotation effect: median RT high-rotation minus median RT low-rotation
  // Only considers correct answers with valid RT
  const lowRot = correctRts.length > 0
    ? correct
        .filter((r) => r.rotationDeg < ROTATION_THRESHOLD && r.rt_ms !== null)
        .map((r) => r.rt_ms!)
    : [];
  const highRot = correctRts.length > 0
    ? correct
        .filter((r) => r.rotationDeg >= ROTATION_THRESHOLD && r.rt_ms !== null)
        .map((r) => r.rt_ms!)
    : [];
  const medLow = median(lowRot);
  const medHigh = median(highRot);
  const rotation_effect_ms =
    medLow !== null && medHigh !== null ? medHigh - medLow : null;

  // Best streak
  let bestStreak = 0;
  let currentStreak = 0;
  for (const r of records) {
    if (r.outcome === "correct") {
      currentStreak++;
      if (currentStreak > bestStreak) bestStreak = currentStreak;
    } else {
      currentStreak = 0;
    }
  }

  // Highest level
  const highest_level = Math.max(...records.map((r) => r.level));

  return {
    accuracy,
    omission_rate,
    wrong_rate,
    rt_correct_ms,
    left_accuracy,
    right_accuracy,
    hand_accuracy,
    rotation_effect_ms,
    best_streak: bestStreak,
    highest_level,
  };
}
