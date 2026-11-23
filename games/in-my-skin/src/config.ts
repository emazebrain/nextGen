/** Difficulty for In My Skin (spec 2026-11-23): a level sets how long the child has to get the stop right. */
export const MAX_LEVEL = 30;

/** A stop is right when the picture is off its outline by no more than this share of its own length ("85% covered"). */
export const TOLERANCE = 0.15;
/** In a jump leg the picture shows for this share of the time on each spot, then blinks off. */
export const JUMP_VISIBLE = 0.7;
/** How long the picture stays frozen after a stop, before the next round. */
export const FREEZE_MS = 500;
export const LEGS = 3;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export interface LevelSettings {
  /** Picture length as a share of the play field's short side. */
  size: number;
  /** Glide: how long the picture stays inside the right zone, in ms. Speed follows from this and the size. */
  windowMs: number;
  /** Jump: how many spots a leg has (8–12). */
  spots: number;
  /** Jump: time on each spot, in ms. */
  dwellMs: number;
}

/** Values at levels 1, 6, 11, 16, 21, 26 and the end point after 30; levels in between step evenly. */
const ANCHORS: LevelSettings[] = [
  { size: 0.44, windowMs: 420, spots: 8, dwellMs: 650 },
  { size: 0.4, windowMs: 340, spots: 9, dwellMs: 550 },
  { size: 0.36, windowMs: 270, spots: 10, dwellMs: 450 },
  { size: 0.32, windowMs: 210, spots: 10, dwellMs: 380 },
  { size: 0.28, windowMs: 160, spots: 11, dwellMs: 320 },
  { size: 0.24, windowMs: 115, spots: 12, dwellMs: 260 },
  { size: 0.22, windowMs: 100, spots: 12, dwellMs: 240 },
];

export function levelSettings(level: number): LevelSettings {
  const l = clamp(Math.round(level), 1, MAX_LEVEL) - 1;
  const band = Math.floor(l / 5);
  const f = (l % 5) / 5;
  const a = ANCHORS[band]!;
  const b = ANCHORS[band + 1]!;
  const mix = (x: number, y: number) => x + (y - x) * f;
  return {
    size: mix(a.size, b.size),
    windowMs: Math.round(mix(a.windowMs, b.windowMs)),
    spots: a.spots,
    dwellMs: Math.round(mix(a.dwellMs, b.dwellMs)),
  };
}

/** Glide speed in picture lengths per ms: the right zone is 2 × TOLERANCE picture lengths long. */
export function glideSpeed(level: number, speedScale = 1): number {
  return ((2 * TOLERANCE) / levelSettings(level).windowMs) * clamp(speedScale, 0.5, 1);
}

/** The assignment's difficulty (1–5) picks the starting level: 1, 6, 11, 16, 21. */
export function startLevel(difficulty: number): number {
  return (clamp(Math.round(difficulty), 1, 5) - 1) * 5 + 1;
}

/** Two on-time stops in a row go up a level; two wrong in a row go down. */
export function nextLevel(level: number, sinceChange: boolean[]): number {
  if (sinceChange.length < 2) return level;
  const [a, b] = sinceChange.slice(-2);
  if (a && b) return clamp(level + 1, 1, MAX_LEVEL);
  if (!a && !b) return clamp(level - 1, 1, MAX_LEVEL);
  return level;
}
