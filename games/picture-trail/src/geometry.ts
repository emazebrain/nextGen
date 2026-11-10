/**
 * Picture Trail: where the pictures go (spec 2026-11-10). Screen coordinates, y down. Pure.
 * The line runs edge to edge (corner to corner for diagonals); pictures are evenly spaced with both ends included.
 */
export type Direction = "ltr" | "rtl" | "ttb" | "btt" | "tldbr" | "brdtl" | "trdbl" | "bldtr";
export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
export interface Point { x: number; y: number }

/** Space from the play area's edge, clear of the answer-run frame. */
export const PAD = 36;
export const GAP = 12;
export const MAX_SIZE = 160;
export const MIN_SIZE = 64;
/** How far the line moves toward the target location, as a share of the screen across the line. */
export const SHIFT = 0.22;

const DIR: Record<Direction, Point> = {
  ltr: { x: 1, y: 0 }, rtl: { x: -1, y: 0 }, ttb: { x: 0, y: 1 }, btt: { x: 0, y: -1 },
  tldbr: { x: 1, y: 1 }, brdtl: { x: -1, y: -1 }, trdbl: { x: -1, y: 1 }, bldtr: { x: 1, y: -1 },
};
const COMPASS: Record<Compass, Point> = {
  N: { x: 0, y: -1 }, NE: { x: 1, y: -1 }, E: { x: 1, y: 0 }, SE: { x: 1, y: 1 },
  S: { x: 0, y: 1 }, SW: { x: -1, y: 1 }, W: { x: -1, y: 0 }, NW: { x: -1, y: -1 },
};
const sign = (v: number) => (Math.abs(v) < 1e-9 ? 0 : v > 0 ? 1 : -1);

/** -1: the target lies toward the start of the line; 1: toward its end; 0: across it (no bias). */
export function alongSide(dir: Direction, target: Compass): -1 | 0 | 1 {
  const d = DIR[dir];
  const t = COMPASS[target];
  return sign(d.x * t.x + d.y * t.y) as -1 | 0 | 1;
}

function sizeFor(dir: Direction, n: number, w: number, h: number): number {
  const d = DIR[dir];
  const extent = d.x !== 0 && d.y !== 0 ? Math.max(w, h) - 2 * PAD : d.x !== 0 ? w - 2 * PAD : h - 2 * PAD;
  const across = d.x !== 0 && d.y !== 0 ? Math.min(w, h) - 2 * PAD : d.x !== 0 ? h - 2 * PAD : w - 2 * PAD;
  return Math.min(MAX_SIZE, (extent - (n - 1) * GAP) / n, across);
}

/**
 * The n points of a line in direction `dir` on a w × h area, shifted toward `target` across the line. When the pictures
 * would be smaller than MIN_SIZE, n is reduced (never below 2) and `capped` says so.
 */
export function linePoints(dir: Direction, n: number, w: number, h: number, target?: Compass, opts: { keepN?: boolean } = {}): { points: Point[]; size: number; n: number; capped: boolean } {
  let count = Math.max(2, n);
  let size = sizeFor(dir, count, w, h);
  // A round already under way keeps its count when the screen changes (the device turned): smaller pictures, same slots.
  if (opts.keepN) size = Math.max(24, size);
  else while (size < MIN_SIZE && count > 2) size = sizeFor(dir, --count, w, h);
  const capped = count < n;
  size = Math.floor(size);
  const d = DIR[dir];
  const lo = { x: PAD + size / 2, y: PAD + size / 2 };
  const hi = { x: w - PAD - size / 2, y: h - PAD - size / 2 };
  const mid = { x: w / 2, y: h / 2 };
  // Start and end on the edges the direction runs between (corners for diagonals), centred on the other axis.
  let a: Point = { x: d.x > 0 ? lo.x : d.x < 0 ? hi.x : mid.x, y: d.y > 0 ? lo.y : d.y < 0 ? hi.y : mid.y };
  let b: Point = { x: d.x > 0 ? hi.x : d.x < 0 ? lo.x : mid.x, y: d.y > 0 ? hi.y : d.y < 0 ? lo.y : mid.y };
  if (target) {
    const t = COMPASS[target];
    const perp = { x: -d.y, y: d.x }; // across the line
    const s = sign(perp.x * t.x + perp.y * t.y);
    if (s !== 0) {
      const len = Math.hypot(perp.x, perp.y);
      const amount = SHIFT * (d.x !== 0 && d.y !== 0 ? Math.min(w, h) : d.x !== 0 ? h : w);
      const off = { x: (s * perp.x * amount) / len, y: (s * perp.y * amount) / len };
      const clampP = (p: Point): Point => ({ x: Math.min(hi.x, Math.max(lo.x, p.x + off.x)), y: Math.min(hi.y, Math.max(lo.y, p.y + off.y)) });
      a = clampP(a);
      b = clampP(b);
    }
  }
  const points = Array.from({ length: count }, (_, i) => {
    const f = count === 1 ? 0 : i / (count - 1);
    return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
  });
  return { points, size, n: count, capped };
}
