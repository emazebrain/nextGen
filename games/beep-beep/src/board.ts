/**
 * Beep Beep boards and solver (ported from v1 `engine.js`), pure.
 *
 * A board is a square grid, a list of pieces and a few wall cells. Piece 0 is
 * the hero: horizontal, on the exit row. Every piece slides along its own
 * length; one move = one piece, one direction, any distance. Boards are stored
 * with the exit on the right; the renderer mirrors them for an exit on the left.
 *
 * The move graph is undirected (every move can be undone), so one breadth-first
 * pass over a board's reachable states gives the exact distance to the goal from
 * every state. v1 ran a fresh search after each move; v2 solves a board once when
 * it is shown and looks distances up afterwards (ADR 0015).
 */

export interface Piece {
  /** Row for a horizontal piece, column for a vertical one. */
  fixed: number;
  len: number;
  horiz: boolean;
}

export interface Board {
  id: string;
  n: number;
  exitRow: number;
  pieces: Piece[];
  walls: Array<[number, number]>;
  /** Start position of each piece along its axis (column for horizontal, row for vertical). */
  start: number[];
  /** Fewest moves to free the hero from the start. */
  optimal: number;
}

export type State = number[];
export interface Move {
  idx: number;
  from: number;
  to: number;
}

/** Numeric key for a state: positions are 0…6, so base 8 fits 17 pieces in a double exactly. */
export function keyOf(s: State): number {
  let k = 0;
  for (let i = s.length - 1; i >= 0; i--) k = k * 8 + s[i]!;
  return k;
}

export function isGoal(b: Board, s: State): boolean {
  return s[0] === b.n - b.pieces[0]!.len;
}

/** Cell occupancy for a state (walls and every piece except `skip`). */
function occupancy(b: Board, s: State, skip = -1): Uint8Array {
  const occ = new Uint8Array(b.n * b.n);
  for (const [r, c] of b.walls) occ[r * b.n + c] = 1;
  for (let i = 0; i < b.pieces.length; i++) {
    if (i === skip) continue;
    const p = b.pieces[i]!;
    for (let k = 0; k < p.len; k++) occ[p.horiz ? p.fixed * b.n + s[i]! + k : (s[i]! + k) * b.n + p.fixed] = 1;
  }
  return occ;
}

/** How far piece `idx` can slide each way from where it is now. */
export function slideRange(b: Board, s: State, idx: number): { min: number; max: number } {
  const p = b.pieces[idx]!;
  const occ = occupancy(b, s, idx);
  const at = (v: number) => (p.horiz ? p.fixed * b.n + v : v * b.n + p.fixed);
  let min = s[idx]!;
  while (min > 0 && !occ[at(min - 1)]) min--;
  let max = s[idx]!;
  while (max + p.len < b.n && !occ[at(max + p.len)]) max++;
  return { min, max };
}

/** Every legal move from a state. Occupancy is built once per state (the solver calls this a lot). */
export function moves(b: Board, s: State): Move[] {
  const out: Move[] = [];
  const n = b.n;
  const occ = occupancy(b, s);
  for (let i = 0; i < b.pieces.length; i++) {
    const p = b.pieces[i]!;
    const v0 = s[i]!;
    const at = p.horiz ? (v: number) => p.fixed * n + v : (v: number) => v * n + p.fixed;
    for (let v = v0 - 1; v >= 0 && !occ[at(v)]; v--) out.push({ idx: i, from: v0, to: v });
    for (let v = v0 + 1; v + p.len - 1 < n && !occ[at(v + p.len - 1)]; v++) out.push({ idx: i, from: v0, to: v });
  }
  return out;
}

export function apply(s: State, m: Move): State {
  const t = s.slice();
  t[m.idx] = m.to;
  return t;
}

/** Distances to the goal for every state reachable from the start, or null if there are more than `cap` states. */
export interface Solution {
  dist: Map<number, number>;
  states: number;
}

export function solve(b: Board, cap = 250_000): Solution | null {
  // 1. Every state reachable from the start (the graph is undirected).
  const seen = new Map<number, State>();
  const start = b.start.slice();
  seen.set(keyOf(start), start);
  let frontier: State[] = [start];
  const goals: State[] = [];
  while (frontier.length) {
    const next: State[] = [];
    for (const s of frontier) {
      if (isGoal(b, s)) goals.push(s);
      for (const m of moves(b, s)) {
        const t = apply(s, m);
        const k = keyOf(t);
        if (seen.has(k)) continue;
        seen.set(k, t);
        next.push(t);
        if (seen.size > cap) return null;
      }
    }
    frontier = next;
  }
  // 2. Distances: breadth-first from all goal states at once.
  const dist = new Map<number, number>();
  for (const g of goals) dist.set(keyOf(g), 0);
  frontier = goals;
  let d = 0;
  while (frontier.length) {
    d++;
    const next: State[] = [];
    for (const s of frontier) {
      for (const m of moves(b, s)) {
        const t = apply(s, m);
        const k = keyOf(t);
        if (dist.has(k)) continue;
        dist.set(k, d);
        next.push(t);
      }
    }
    frontier = next;
  }
  return { dist, states: seen.size };
}

export function distance(sol: Solution | null, s: State): number {
  if (!sol) return Infinity;
  return sol.dist.get(keyOf(s)) ?? Infinity;
}

/** A first move of a shortest solution (used by hints and "show the answer"). Prefers moving the hero, then fewer cells. */
export function bestMove(b: Board, sol: Solution | null, s: State): Move | null {
  const d = distance(sol, s);
  if (!Number.isFinite(d) || d === 0) return null;
  let best: Move | null = null;
  for (const m of moves(b, s)) {
    if (distance(sol, apply(s, m)) !== d - 1) continue;
    if (!best || (m.idx === 0 && best.idx !== 0) || (m.idx !== 0 && best.idx !== 0 && Math.abs(m.to - m.from) < Math.abs(best.to - best.from))) best = m;
  }
  return best;
}

export type MoveClass = "progressive" | "neutral" | "regressive" | "unknown";

export function classify(before: number, after: number): MoveClass {
  if (!Number.isFinite(before) || !Number.isFinite(after)) return "unknown";
  return after < before ? "progressive" : after > before ? "regressive" : "neutral";
}

/** Cells of a piece at position v. */
export function cellsOf(p: Piece, v: number): Array<[number, number]> {
  return Array.from({ length: p.len }, (_, k) => (p.horiz ? [p.fixed, v + k] : [v + k, p.fixed]) as [number, number]);
}

/**
 * Hint rung 1 (v1): the pieces between the hero and the exit, plus the pieces blocking those along their
 * column. Points attention without giving the answer.
 */
export function blockersToExit(b: Board, s: State): Set<number> {
  const owner = new Map<number, number>();
  b.pieces.forEach((p, i) => cellsOf(p, s[i]!).forEach(([r, c]) => owner.set(r * b.n + c, i)));
  const hero = b.pieces[0]!;
  const set = new Set<number>();
  for (let c = s[0]! + hero.len; c < b.n; c++) {
    const i = owner.get(b.exitRow * b.n + c);
    if (i !== undefined && i !== 0) set.add(i);
  }
  for (const i of [...set]) {
    const p = b.pieces[i]!;
    if (p.horiz) continue;
    for (let r = 0; r < b.n; r++) {
      if (r >= s[i]! && r < s[i]! + p.len) continue;
      const j = owner.get(r * b.n + p.fixed);
      if (j !== undefined && j !== 0 && j !== i) set.add(j);
    }
  }
  return set;
}
