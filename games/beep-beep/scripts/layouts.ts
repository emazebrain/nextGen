/**
 * Random board layouts for the pack generator (scripts only, never shipped).
 * A layout is the hero on the exit row plus blockers and a few walls; the
 * generator then picks the hardest start in the layout's reachable states.
 */
import { solve, keyOf, type Board, type Piece, type State } from "../src/board.ts";

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PIECES: Record<number, [number, number]> = { 4: [3, 5], 5: [5, 9], 6: [9, 13], 7: [12, 17] };
const WALLS: Record<number, [number, number]> = { 4: [0, 0], 5: [0, 1], 6: [0, 2], 7: [0, 3] };

/** A random layout, or null if the pieces didn't fit. */
export function randomLayout(n: number, rng: () => number): Omit<Board, "id" | "optimal"> | null {
  const ri = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const exitRow = ri(1, n - 2);
  const occ = new Uint8Array(n * n);
  const pieces: Piece[] = [{ fixed: exitRow, len: 2, horiz: true }];
  const start: number[] = [ri(0, n - 3)];
  occ[exitRow * n + start[0]!] = occ[exitRow * n + start[0]! + 1] = 1;
  const walls: Array<[number, number]> = [];
  const [wlo, whi] = WALLS[n]!;
  for (let w = ri(wlo, whi), tries = 0; walls.length < w && tries < 50; tries++) {
    const r = ri(0, n - 1);
    const c = ri(0, n - 1);
    if (r === exitRow || occ[r * n + c]) continue; // never on the exit row, so the way out stays possible
    occ[r * n + c] = 1;
    walls.push([r, c]);
  }
  const [plo, phi] = PIECES[n]!;
  const want = ri(plo, phi);
  for (let tries = 0; pieces.length < want && tries < 400; tries++) {
    const len = n >= 5 && rng() < 0.3 ? 3 : 2;
    const horiz = rng() < 0.45;
    const fixed = ri(0, n - 1);
    // A horizontal piece on the exit row could never leave the hero's way.
    if (horiz && fixed === exitRow) continue;
    const v = ri(0, n - len);
    const cells = Array.from({ length: len }, (_, k) => (horiz ? fixed * n + v + k : (v + k) * n + fixed));
    if (cells.some((c) => occ[c])) continue;
    for (const c of cells) occ[c] = 1;
    pieces.push({ fixed, len, horiz });
    start.push(v);
  }
  if (pieces.length < plo) return null;
  return { n, exitRow, pieces, walls, start };
}

/**
 * For a layout, every reachable state with its exact distance to the goal; returns the hardest states (and how
 * hard), or null if the layout can't be solved within the cap.
 */
export function hardestStarts(layout: Omit<Board, "id" | "optimal">, cap = 30_000): { depth: number; states: State[] } | null {
  const sol = solve({ ...layout, id: "", optimal: 0 }, cap);
  if (!sol || sol.dist.size === 0) return null;
  let depth = 0;
  for (const d of sol.dist.values()) depth = Math.max(depth, d);
  if (depth === 0) return null;
  // Decode the keys at that depth back into states.
  const states: State[] = [];
  for (const [k, d] of sol.dist) {
    if (d !== depth) continue;
    const s: State = [];
    let x = k;
    for (let i = 0; i < layout.pieces.length; i++) {
      s.push(x % 8);
      x = Math.floor(x / 8);
    }
    states.push(s);
    if (states.length >= 8) break;
  }
  void keyOf;
  return { depth, states };
}
