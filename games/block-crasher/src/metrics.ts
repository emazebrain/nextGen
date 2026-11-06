/**
 * Block Crasher measures (design doc §8.4, ADR 0017). Pure: fed by the engine, no clock.
 * Distances are in board px (the 800 × 600 board), so they compare across screen sizes.
 */
import type { SpecialKind } from "./levels.ts";

export type Side = "L" | "R";

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const round = (v: number, dp = 0) => Math.round(v * 10 ** dp) / 10 ** dp;

export class BlockMetrics {
  paddleHits = 0;
  hitsBySide: Record<Side, number> = { L: 0, R: 0 };
  ballsLost = 0;
  missesBySide: Record<Side, number> = { L: 0, R: 0 };
  livesLost = 0;
  gaps: number[] = [];
  interceptMs: number[] = [];
  reversals = 0;
  idleS = 0;
  bricks = 0;
  tough = 0;
  specials: Partial<Record<SpecialKind, number>> = {};
  powerupKills = 0;
  catches = 0;
  levelsCompleted = 0;
  highestLevel: number;
  playS = 0;
  private lastDir = 0;

  constructor(startLevel: number) {
    this.highestLevel = startLevel;
  }

  paddleHit(gapPx: number, side: Side, interceptMs: number | null) {
    this.paddleHits += 1;
    this.hitsBySide[side] += 1;
    this.gaps.push(Math.abs(gapPx));
    if (interceptMs !== null) this.interceptMs.push(interceptMs);
  }

  ballLost(side: Side) {
    this.ballsLost += 1;
    this.missesBySide[side] += 1;
  }

  /** A paddle move of dx board px; direction changes of at least 1.5 px count as reversals (jitter is ignored). */
  paddleMove(dx: number) {
    if (Math.abs(dx) < 1.5) return;
    const dir = Math.sign(dx);
    if (this.lastDir && dir !== this.lastDir) this.reversals += 1;
    this.lastDir = dir;
  }

  brick(tough: boolean) {
    this.bricks += 1;
    if (tough) this.tough += 1;
  }

  special(kind: SpecialKind, kills: number) {
    this.specials[kind] = (this.specials[kind] ?? 0) + 1;
    this.powerupKills += kills;
  }

  summary() {
    const triggers = Object.values(this.specials).reduce((a, b) => a + (b ?? 0), 0);
    const contacts = this.paddleHits + this.ballsLost;
    const missL = this.missesBySide.L;
    const missR = this.missesBySide.R;
    const minutes = this.playS / 60;
    return {
      paddle_hits: this.paddleHits,
      balls_lost: this.ballsLost,
      lives_lost: this.livesLost,
      paddle_miss_rate: contacts ? round(this.ballsLost / contacts, 3) : null,
      avg_intercept_gap_px: this.gaps.length ? round(this.gaps.reduce((a, b) => a + b, 0) / this.gaps.length, 1) : null,
      intercept_ms_median: median(this.interceptMs) === null ? null : Math.round(median(this.interceptMs)!),
      movement_reversals: this.reversals,
      reversals_per_min: minutes > 0.05 ? round(this.reversals / minutes, 1) : null,
      idle_seconds: round(this.idleS, 1),
      bricks_destroyed: this.bricks,
      tough_bricks_destroyed: this.tough,
      special_bricks_triggered: { ...this.specials },
      powerup_efficiency: triggers ? round(this.powerupKills / triggers, 2) : null,
      misses_left: missL,
      misses_right: missR,
      paddle_hits_left: this.hitsBySide.L,
      paddle_hits_right: this.hitsBySide.R,
      /** (right − left) / all misses: positive means more misses on the right half. */
      side_miss_asymmetry: missL + missR ? round((missR - missL) / (missL + missR), 2) : null,
      magnet_catches: this.catches,
      levels_completed: this.levelsCompleted,
      highest_level: this.highestLevel,
      play_seconds: round(this.playS, 1),
    };
  }
}
