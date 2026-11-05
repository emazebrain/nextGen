/**
 * Builds Beep Beep's board pack (src/pack.json), offline and deterministically (ADR 0015). v1 downloaded a
 * hand-made pack from a server; v2 games can't use the network, so the pack ships inside the game.
 *
 * For each grid size: random layouts, then a local search that nudges the deepest layouts found so far. Every
 * layout is solved exactly; the starts kept are states at a known shortest distance. Boards are filed by
 * (grid size, shortest solution) with up to PER_BUCKET boards each.
 *
 *   pnpm --filter @emb/game-beep-beep generate        (takes several minutes)
 */
import { writeFileSync } from "node:fs";
import { keyOf, solve, type Board, type State } from "../src/board.ts";
import { DEPTH_RANGE, PACK_CAP } from "../src/levels.ts";
import { mulberry32, randomLayout } from "./layouts.ts";

type Layout = Omit<Board, "id" | "optimal">;
const PER_BUCKET = 10;
const BUDGET_S: Record<number, number> = { 4: 8, 5: 60, 6: 240, 7: 360 };

function decode(k: number, count: number): State {
  const s: State = [];
  for (let i = 0; i < count; i++) {
    s.push(k % 8);
    k = Math.floor(k / 8);
  }
  return s;
}

/** All (depth → starts) in a layout's reachable states, or null if too big. */
function analyse(l: Layout): { depth: number; byDepth: Map<number, State[]> } | null {
  const sol = solve({ ...l, id: "", optimal: 0 }, PACK_CAP);
  if (!sol || sol.dist.size === 0) return null;
  const byDepth = new Map<number, State[]>();
  let depth = 0;
  for (const [k, d] of sol.dist) {
    depth = Math.max(depth, d);
    const list = byDepth.get(d) ?? [];
    if (list.length < 3) list.push(decode(k, l.pieces.length));
    byDepth.set(d, list);
  }
  return { depth, byDepth };
}

function mutate(l: Layout, rng: () => number): Layout | null {
  const n = l.n;
  const ri = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const pieces = l.pieces.map((p) => ({ ...p }));
  const start = l.start.slice();
  const walls = l.walls.map((w) => [w[0], w[1]] as [number, number]);
  const r = rng();
  if (r < 0.15 && pieces.length > 3) {
    const i = ri(1, pieces.length - 1);
    pieces.splice(i, 1);
    start.splice(i, 1);
  } else if (r < 0.25 && walls.length) {
    walls.splice(ri(0, walls.length - 1), 1);
  } else {
    // Re-place one blocker (or add one).
    const add = r > 0.85;
    const i = add ? pieces.length : ri(1, pieces.length - 1);
    const occ = new Uint8Array(n * n);
    for (const [wr, wc] of walls) occ[wr * n + wc] = 1;
    pieces.forEach((p, j) => {
      if (j === i) return;
      for (let k = 0; k < p.len; k++) occ[p.horiz ? p.fixed * n + start[j]! + k : (start[j]! + k) * n + p.fixed] = 1;
    });
    let placed = false;
    for (let t = 0; t < 60 && !placed; t++) {
      const len = n >= 5 && rng() < 0.3 ? 3 : 2;
      const horiz = rng() < 0.45;
      const fixed = ri(0, n - 1);
      if (horiz && fixed === l.exitRow) continue;
      const v = ri(0, n - len);
      const cells = Array.from({ length: len }, (_, k) => (horiz ? fixed * n + v + k : (v + k) * n + fixed));
      if (cells.some((c) => occ[c])) continue;
      pieces[i] = { fixed, len, horiz };
      start[i] = v;
      placed = true;
    }
    if (!placed) return null;
  }
  return { n, exitRow: l.exitRow, pieces, walls, start };
}

const pack: Board[] = [];
for (const n of [4, 5, 6, 7]) {
  const rng = mulberry32(20261105 + n);
  const [lo, hi] = DEPTH_RANGE[n]!;
  const buckets = new Map<number, Board[]>();
  const seen = new Set<string>();
  const file = (l: Layout, depth: number, s: State) => {
    if (depth < lo || depth > hi) return;
    const list = buckets.get(depth) ?? [];
    if (list.length >= PER_BUCKET) return;
    const sig = JSON.stringify([l.pieces, l.walls, l.exitRow, s]);
    if (seen.has(sig)) return;
    seen.add(sig);
    list.push({ id: `${n}-${depth}-${list.length + 1}`, n, exitRow: l.exitRow, pieces: l.pieces, walls: l.walls, start: s, optimal: depth });
    buckets.set(depth, list);
  };
  const t0 = Date.now();
  let elite: Array<{ l: Layout; depth: number }> = [];
  let tries = 0;
  while ((Date.now() - t0) / 1000 < BUDGET_S[n]!) {
    tries++;
    const base = elite.length && rng() < 0.7 ? elite[Math.floor(rng() * elite.length)]! : null;
    const l = base ? mutate(base.l, rng) : randomLayout(n, rng);
    if (!l) continue;
    const a = analyse(l);
    if (!a) continue;
    // Keep the hardest start, and one start at each shallower depth for the easy buckets.
    for (const [d, states] of a.byDepth) if (d > 0) file(l, d, states[d === a.depth ? 0 : Math.floor(rng() * states.length)]!);
    elite.push({ l, depth: a.depth });
    elite.sort((x, y) => y.depth - x.depth);
    elite = elite.slice(0, 24);
    const full = [...Array(hi - lo + 1)].every((_, i) => (buckets.get(lo + i)?.length ?? 0) >= PER_BUCKET);
    if (full) break;
  }
  const summary = [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([d, l]) => `${d}:${l.length}`).join(" ");
  console.log(`n=${n} tries=${tries} best=${elite[0]?.depth} ${summary}`);
  for (const list of [...buckets.values()]) pack.push(...list);
}
pack.sort((a, b) => a.n - b.n || a.optimal - b.optimal || a.id.localeCompare(b.id));
void keyOf;
writeFileSync(new URL("../src/pack.json", import.meta.url), JSON.stringify(pack.map((b) => ({ ...b, pieces: b.pieces.map((p) => [p.fixed, p.len, p.horiz ? 1 : 0]) }))) + "\n");
console.log(`wrote ${pack.length} boards`);
