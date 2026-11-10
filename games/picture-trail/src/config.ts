/**
 * Picture Trail: levels, pace and the within-session staircase (spec 2026-11-10). Pure: no clock, no I/O.
 */
export const MAX_LEVEL = 30;
export type AgeBand = "4-6" | "7-9" | "10-12" | "13+";
export type Difficulty = 1 | 2 | 3 | 4 | 5;

const COUNTS = [3, 4, 5, 6, 8];
const BAND_SIZE = 6;
/** Base show time per picture, by age band (ms). */
export const BASE_SHOW_MS: Record<AgeBand, number> = { "4-6": 1300, "7-9": 1100, "10-12": 950, "13+": 850 };
const START: Record<Difficulty, number> = { 1: 1, 2: 4, 3: 8, 4: 14, 5: 20 };
/** From difficulty 4, levels from 13 use look-alike wrong answers (same category as the match). */
export const LURE_FROM_LEVEL = 13;

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Pictures per phase: 3, 4, 5, 6 and 8, in bands of six levels. */
export function countForLevel(level: number): number {
  return COUNTS[clamp(Math.floor((clamp(level, 1, MAX_LEVEL) - 1) / BAND_SIZE), 0, COUNTS.length - 1)]!;
}

export function startLevel(d: Difficulty): number {
  return START[d] ?? 1;
}

/**
 * How long each picture shows: the age band's base, 4% shorter per level within a band of N, divided by the platform
 * speed scale (0.5–1.0 slows). A therapist's fixed time (500–2500 ms) replaces it; 0 means automatic.
 */
export function showMs(level: number, band: AgeBand, speedScale: number, override = 0): number {
  if (override > 0) return Math.round(clamp(override, 500, 2500));
  const pos = (clamp(level, 1, MAX_LEVEL) - 1) % BAND_SIZE;
  const scale = clamp(speedScale || 1, 0.5, 1);
  return Math.round((BASE_SHOW_MS[band] * 0.96 ** pos) / scale);
}

/** The gap between two pictures in a run: a quarter of the show time. */
export const gapMs = (show: number) => Math.round(show / 4);

/** Two correct rounds in a row → up; two non-correct in a row → down (results since the last change). */
export function nextLevel(level: number, sinceChange: boolean[]): number {
  const last = sinceChange.slice(-2);
  if (last.length < 2) return level;
  if (last[0] && last[1]) return clamp(level + 1, 1, MAX_LEVEL);
  if (!last[0] && !last[1]) return clamp(level - 1, 1, MAX_LEVEL);
  return level;
}

export function usesLures(level: number, difficulty: Difficulty, setting: "auto" | "on" | "off"): boolean {
  if (setting === "on") return true;
  if (setting === "off") return false;
  return difficulty >= 4 && level >= LURE_FROM_LEVEL;
}

/** The last level row's outcome when the session ends: finishing every level is "cleared", not a failure. */
export function finalLevelOutcome(status: "completed" | "time_up" | "out_of_lives" | "abandoned", maxClears: number): "cleared" | "failed" | "timeout" {
  if (status === "time_up") return "timeout";
  if (status === "completed" && maxClears >= 2) return "cleared";
  return "failed";
}
