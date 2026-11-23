/** Paths and legs for In My Skin. Pure geometry: screen coordinates, y grows downward. */
import type { RegionCompass, RegionDirection } from "@emb/game-sdk";

export interface Point {
  x: number;
  y: number;
}
export interface Field {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const DIRECTION_LIST: RegionDirection[] = ["ltr", "rtl", "ttb", "btt", "tldbr", "trdbl", "bldtr", "brdtl"];

/** Which way each direction runs, as signs. Diagonals follow the field's own diagonal (see `pathFor`). */
const SIGN: Record<RegionDirection, Point> = {
  ltr: { x: 1, y: 0 },
  rtl: { x: -1, y: 0 },
  ttb: { x: 0, y: 1 },
  btt: { x: 0, y: -1 },
  tldbr: { x: 1, y: 1 },
  trdbl: { x: -1, y: 1 },
  bldtr: { x: 1, y: -1 },
  brdtl: { x: -1, y: -1 },
};

/** The six movement types, by their stored number (product owner, 2026-11-23). */
export const MOVEMENT_TYPES = ["continuous", "intervals", "continuous-continuous", "continuous-intervals", "intervals-continuous", "intervals-intervals"] as const;
export type MovementType = 0 | 1 | 2 | 3 | 4 | 5;

export type LegKind = "glide" | "jump";
export interface Leg {
  kind: LegKind;
  /** True when the leg runs from B back to A. */
  reverse: boolean;
}

/**
 * The three legs of a round. One-word types re-enter at A each time; two-word types go A→B by the first word,
 * come back B→A by the second, then go A→B by the first again.
 */
export function legsFor(type: number): Leg[] {
  const fwd = (kind: LegKind): Leg => ({ kind, reverse: false });
  const back = (kind: LegKind): Leg => ({ kind, reverse: true });
  switch (type) {
    case 1:
      return [fwd("jump"), fwd("jump"), fwd("jump")];
    case 2:
      return [fwd("glide"), back("glide"), fwd("glide")];
    case 3:
      return [fwd("glide"), back("jump"), fwd("glide")];
    case 4:
      return [fwd("jump"), back("glide"), fwd("jump")];
    case 5:
      return [fwd("jump"), back("jump"), fwd("jump")];
    default:
      return [fwd("glide"), fwd("glide"), fwd("glide")];
  }
}

export interface Path {
  a: Point;
  b: Point;
  /** Unit vector from A to B. */
  dir: Point;
  length: number;
  /** Share of the path between which the whole picture is inside the field. */
  onScreen: [number, number];
}

/**
 * A straight line through the middle of the field. A and B lie outside it, far enough that a picture of `size`
 * is out of sight at both ends. Diagonals run corner to corner.
 */
export function pathFor(direction: RegionDirection, field: Field, size: number): Path {
  const s = SIGN[direction];
  const raw = { x: s.x * (s.y === 0 ? 1 : field.w), y: s.y * (s.x === 0 ? 1 : field.h) };
  const norm = Math.hypot(raw.x, raw.y);
  const dir = { x: raw.x / norm, y: raw.y / norm };
  const cx = field.x + field.w / 2;
  const cy = field.y + field.h / 2;
  // Distance from the centre to the field's edge along the line.
  const edge = Math.min(dir.x === 0 ? Infinity : field.w / 2 / Math.abs(dir.x), dir.y === 0 ? Infinity : field.h / 2 / Math.abs(dir.y));
  const half = edge + size * 0.75;
  // The picture is a square of `size`; it is fully inside while its centre is this far from the edge along the line.
  const inset = (size / 2) * Math.max(dir.x === 0 ? 0 : 1 / Math.abs(dir.x), dir.y === 0 ? 0 : 1 / Math.abs(dir.y));
  const visible = Math.max(0, edge - inset);
  return {
    a: { x: cx - dir.x * half, y: cy - dir.y * half },
    b: { x: cx + dir.x * half, y: cy + dir.y * half },
    dir,
    length: half * 2,
    onScreen: [(half - visible) / (half * 2), (half + visible) / (half * 2)],
  };
}

export function pointAt(path: Path, share: number): Point {
  return { x: path.a.x + (path.b.x - path.a.x) * share, y: path.a.y + (path.b.y - path.a.y) * share };
}

/** Whether a picture should be drawn mirrored so it faces the way it travels. Vertical travel never mirrors. */
export function mirrored(faces: "left" | "right" | null, direction: RegionDirection, reverse: boolean): boolean {
  if (!faces) return false;
  const dx = SIGN[direction].x * (reverse ? -1 : 1);
  if (dx === 0) return false;
  return faces === "left" ? dx > 0 : dx < 0;
}

const COMPASS: Record<RegionCompass, Point> = {
  N: { x: 0, y: -1 },
  NE: { x: 1, y: -1 },
  E: { x: 1, y: 0 },
  SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 },
  SW: { x: -1, y: 1 },
  W: { x: -1, y: 0 },
  NW: { x: -1, y: -1 },
};

/** +1 when the target location lies further along the direction of travel, −1 when it lies behind, 0 when neither. */
export function locationBias(direction: RegionDirection, location: RegionCompass | undefined): -1 | 0 | 1 {
  if (!location) return 0;
  const d = SIGN[direction];
  const c = COMPASS[location];
  const dot = d.x * c.x + d.y * c.y;
  return dot > 0 ? 1 : dot < 0 ? -1 : 0;
}
