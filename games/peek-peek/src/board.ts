/**
 * Peek Peek boards: pointy-top hex geometry, picture placement and the tray
 * order (ported from v1 `geometry.js` and `engine.js`). Pure and seeded: the
 * same seed, level, difficulty and attempt always build the same board.
 *
 * Placement follows the clustering lever ρ(d) and the hemisphere's side bias
 * (ADR 0012): the first half of the pictures the child looks for lean towards
 * the side of the screen the chosen hemisphere sees. Probe levels stay even so
 * the left/right measures have a clean baseline.
 */
import { boardForLevel, copyPartition, heartBudgetFor, kForLevel, PROBE_LEVELS, RHO, studySeconds, type BoardFamily, type Difficulty } from "./config.ts";

const SQRT3 = Math.sqrt(3);

export interface Cell {
  id: string;
  r: number;
  i: number;
  /** Hex centre in board units (circumradius 1), board centred on x = 0. */
  cx: number;
  cy: number;
}

/**
 * Cells from a row vector. Interlock rows (lengths alternate by one) are each centred, so the board comes out
 * mirror-symmetric; brick rows (equal lengths) shift every other row by half a hex. (v1 shifted every other row
 * on both families, which left interlock boards lopsided; ADR 0012.)
 */
export function buildCells(rows: number[], family: BoardFamily): Cell[] {
  const width = SQRT3;
  const cells: Cell[] = [];
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const cx = family === "interlock" ? (i - (n - 1) / 2) * width : i * width + (r % 2) * (width / 2);
      cells.push({ id: `${r}-${i}`, r, i, cx, cy: r * 1.5 });
    }
  });
  const xs = cells.map((c) => c.cx);
  const shift = -(Math.min(...xs) + Math.max(...xs)) / 2;
  const ys = cells.map((c) => c.cy);
  const shiftY = -(Math.min(...ys) + Math.max(...ys)) / 2;
  for (const c of cells) {
    c.cx = round6(c.cx + shift);
    c.cy = round6(c.cy + shiftY);
  }
  return cells;
}

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

/** Hex neighbours: two cells touch when their centres are one hex width apart. */
export function neighbourMap(cells: Cell[]): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const a of cells) {
    map[a.id] = cells.filter((b) => b !== a && Math.abs(Math.hypot(a.cx - b.cx, a.cy - b.cy) - SQRT3) < 1e-3).map((b) => b.id);
  }
  return map;
}

/** −1 left of the board's centre line, +1 right, 0 on it. */
export const sideOfCell = (c: Cell): -1 | 0 | 1 => (c.cx < -1e-6 ? -1 : c.cx > 1e-6 ? 1 : 0);

/** Same-picture neighbouring pairs (realised adjacency A). */
export function realisedAdjacency(assignment: Record<string, number>, cells: Cell[], nmap: Record<string, string[]>): number {
  let a = 0;
  for (const c of cells) for (const n of nmap[c.id]!) if (assignment[c.id] === assignment[n]) a++;
  return a / 2;
}

// ---------------------------------------------------------------- seeded randomness

function hashStr(s: string): number {
  let h = 1779033703 ^ s.length;
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const rngFor = (key: string) => mulberry32(hashStr(key));

function shuffled(n: number, rng: () => number): number[] {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

// ---------------------------------------------------------------- placement

/** Where the first half of the pictures lean: the side of the screen the hemisphere sees (ADR 0012). */
export type SideBias = { side: -1 | 1; p: number } | null;

export function biasFor(hemisphere: "left" | "right"): { early: -1 | 1; p: number } {
  return { early: hemisphere === "left" ? 1 : -1, p: 0.75 };
}

function pick<T>(pool: T[], rng: () => number): T {
  return pool[Math.floor(rng() * pool.length)]!;
}

function leaning<T>(pool: T[], sideOf: (x: T) => number, bias: SideBias, rng: () => number): T[] {
  if (bias && rng() < bias.p) {
    const s = pool.filter((x) => sideOf(x) === bias.side);
    if (s.length) return s;
  }
  return pool;
}

function placePictures(
  cells: Cell[],
  nmap: Record<string, string[]>,
  partition: number[],
  tray: number[],
  rho: number,
  bias: { early: -1 | 1; p: number } | null,
  rng: () => number,
): Record<string, number> {
  const side: Record<string, number> = Object.fromEntries(cells.map((c) => [c.id, sideOfCell(c)]));
  const sideOf = (id: string) => side[id]!;
  const free = new Set(cells.map((c) => c.id));
  const assignment: Record<string, number> = {};
  const early = Math.ceil(partition.length / 2);
  tray.forEach((pic, t) => {
    const b: SideBias = bias ? { side: t < early ? bias.early : (-bias.early as -1 | 1), p: bias.p } : null;
    for (let k = 0; k < partition[pic]!; k++) {
      let id: string;
      if (k === 0) {
        id = pick(leaning([...free], sideOf, b, rng), rng);
      } else {
        const near: string[] = [];
        for (const placed in assignment) if (assignment[placed] === pic) for (const n of nmap[placed]!) if (free.has(n)) near.push(n);
        if (rho > 0.05 && near.length && rng() < rho) {
          id = pick(leaning(near, sideOf, b, rng), rng);
        } else if (rho <= 0.05) {
          // Spread: the free cell with the fewest neighbours already holding this picture.
          let best = "";
          let bestScore = Infinity;
          for (const f of free) {
            const score = nmap[f]!.filter((n) => assignment[n] === pic).length;
            if (score < bestScore || (score === bestScore && rng() < 0.25)) {
              bestScore = score;
              best = f;
            }
          }
          id = best;
        } else {
          id = pick(leaning([...free], sideOf, b, rng), rng);
        }
      }
      assignment[id] = pic;
      free.delete(id);
    }
  });
  return assignment;
}

export interface Board {
  level: number;
  attempt: number;
  T: number;
  K: number;
  rows: number[];
  family: BoardFamily;
  cells: Cell[];
  cellsById: Record<string, Cell>;
  nmap: Record<string, string[]>;
  /** Copies per picture slot (index = picture slot 0…K−1). */
  partition: number[];
  /** Picture slot under each cell. */
  assignment: Record<string, number>;
  /** The order the child is asked for the pictures (picture slots). */
  tray: number[];
  /** Which pack picture each slot shows. */
  pictureIds: number[];
  realisedAdjacency: number;
  studySeconds: number;
  heartBudget: number;
  /** A mirror-symmetric level with even placement: counts towards the left/right measures. */
  isProbe: boolean;
  boardId: string;
}

export interface BuildOptions {
  level: number;
  attempt: number;
  difficulty: Difficulty;
  packSize: number;
  hemisphere: "left" | "right";
  /** Session seed (an integer drawn once from the host's seeded generator). */
  seed: number;
  /** 2–20 s, or null for the formula. */
  studyOverrideS: number | null;
  /** Even placement with no side lean (control trial, practice). */
  even?: boolean;
}

/** Builds one board. A retry (attempt > 1) gets a fresh placement of the same size. */
export function buildBoard(o: BuildOptions): Board {
  const shape = boardForLevel(o.level);
  const cells = buildCells(shape.rows, shape.family);
  const nmap = neighbourMap(cells);
  const K = kForLevel(o.level, o.difficulty, o.packSize);
  const partition = copyPartition(shape.T, K, o.level, o.difficulty);
  const rng = rngFor(`${o.seed}:${o.level}:${o.difficulty}:${o.attempt}`);
  const tray = shuffled(K, rng);
  const pictureIds = shuffled(o.packSize, rng).slice(0, K);
  const left = cells.filter((c) => sideOfCell(c) < 0).length;
  const right = cells.filter((c) => sideOfCell(c) > 0).length;
  const isProbe = PROBE_LEVELS.has(o.level) && shape.family === "interlock" && left === right;
  const assignment = placePictures(cells, nmap, partition, tray, RHO[o.difficulty], isProbe || o.even ? null : biasFor(o.hemisphere), rng);
  const A = realisedAdjacency(assignment, cells, nmap);
  return {
    level: o.level,
    attempt: o.attempt,
    T: shape.T,
    K,
    rows: shape.rows,
    family: shape.family,
    cells,
    cellsById: Object.fromEntries(cells.map((c) => [c.id, c])),
    nmap,
    partition,
    assignment,
    tray,
    pictureIds,
    realisedAdjacency: A,
    studySeconds: o.studyOverrideS ?? studySeconds(o.level),
    heartBudget: heartBudgetFor(o.difficulty, partition),
    isProbe,
    boardId: `pp-L${o.level}-d${o.difficulty}-T${shape.T}-K${K}-A${A}`,
  };
}
