/**
 * Tunnel Rush measures (design doc §8.4 "Game metrics"), ported from v1
 * `metrics.js`. Pure: the summary is rebuilt from the object records alone.
 *
 * Added in v2 (ADR 0014): side measures (objects are counted by the side of the
 * ship they appeared on), and threat measures (objects that appeared in the
 * ship's own lane, so the child had to steer away).
 */
import { DISTANCE_POINTS, DODGE_POINTS, HIT_PENALTY, LEVEL_BONUS, STREAK_CAP, STREAK_POINTS, type GlyphKind } from "./config.ts";
import type { Pass, Side } from "./engine.ts";

export interface ObjectRecord {
  id: number;
  lane: number;
  kind: GlyphKind;
  label: string;
  hit: boolean;
  reactionMs: number | null;
  speed: number;
  level: number;
  spawnSide: Side;
  threat: boolean;
  /** Seconds since the run started. */
  t: number;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));

export class TunnelMetrics {
  readonly objects: ObjectRecord[] = [];
  score = 0;
  distance = 0;
  streak = 0;
  bestStreak = 0;
  levelReached: number;
  steers = 0;

  constructor(startLevel: number) {
    this.levelReached = startLevel;
  }

  addDistance(units: number) {
    if (units <= 0) return;
    this.distance += units;
    this.score += units * DISTANCE_POINTS;
  }

  /** Records one object reaching the ship; returns the points it gave (negative for a bump). */
  record(p: Pass, t: number): number {
    const o = p.obstacle;
    this.objects.push({ id: o.id, lane: o.lane, kind: o.glyph.kind, label: o.glyph.label, hit: p.hit, reactionMs: p.reactionMs, speed: p.speed, level: p.level, spawnSide: o.spawnSide, threat: o.threat, t: Math.round(t * 1000) / 1000 });
    if (p.hit) {
      this.streak = 0;
      const before = this.score;
      this.score = Math.max(0, this.score - HIT_PENALTY);
      return this.score - before;
    }
    this.streak += 1;
    this.bestStreak = Math.max(this.bestStreak, this.streak);
    const gain = DODGE_POINTS + Math.min(this.streak, STREAK_CAP) * STREAK_POINTS;
    this.score += gain;
    return gain;
  }

  levelUp(level: number) {
    this.levelReached = Math.max(this.levelReached, level);
    this.score += LEVEL_BONUS;
  }

  summary() {
    const all = this.objects;
    const n = all.length;
    const hits = all.filter((o) => o.hit).length;
    const reactions = all.map((o) => o.reactionMs).filter((r): r is number => r !== null);
    const speeds = all.map((o) => o.speed);
    const rate = (a: ObjectRecord[]) => (a.length ? a.filter((o) => o.hit).length / a.length : null);
    const left = all.filter((o) => o.spawnSide === "L");
    const right = all.filter((o) => o.spawnSide === "R");
    const hl = rate(left);
    const hr = rate(right);
    const threats = all.filter((o) => o.threat);
    const perLane: Record<string, { objects: number; dodges: number }> = {};
    const perType: Record<string, { seen: number; hits: number }> = {};
    for (const o of all) {
      const l = (perLane[o.lane] ??= { objects: 0, dodges: 0 });
      l.objects += 1;
      if (!o.hit) l.dodges += 1;
      const k = (perType[o.kind] ??= { seen: 0, hits: 0 });
      k.seen += 1;
      if (o.hit) k.hits += 1;
    }
    return {
      obstacles: n,
      dodges: n - hits,
      hits,
      accuracy: n ? r3((n - hits) / n) : null,
      hit_rate: n ? r3(hits / n) : null,
      avg_reaction_ms: r0(mean(reactions)),
      median_reaction_ms: r0(median(reactions)),
      // Objects the child never steered for: an attention and engagement flag.
      no_move_rate: n ? r3((n - reactions.length) / n) : null,
      threat_dodge_rate: threats.length ? r3(threats.filter((o) => !o.hit).length / threats.length) : null,
      hit_rate_left: r3(hl),
      hit_rate_right: r3(hr),
      // −1 … 1: positive = more bumps from objects that appeared on the right.
      side_hit_asymmetry: hl !== null && hr !== null && hl + hr > 0 ? r3((hr - hl) / (hr + hl)) : null,
      objects_left: left.length,
      objects_right: right.length,
      avg_speed: r3(mean(speeds)),
      speed_start: speeds.length ? speeds[0]! : null,
      speed_end: speeds.length ? speeds[speeds.length - 1]! : null,
      steers: this.steers,
      best_streak: this.bestStreak,
      level_reached: this.levelReached,
      distance: r3(this.distance),
      per_lane: perLane,
      per_object_type: perType,
    };
  }
}
