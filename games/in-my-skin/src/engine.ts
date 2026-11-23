/**
 * The round of In My Skin as pure functions of time. The renderer owns the clock (it stops while paused) and asks
 * where the picture is and how a stop at time t is judged. No clock, no I/O, no randomness.
 */
import { JUMP_VISIBLE, LEGS, TOLERANCE } from "./config.ts";
import type { Leg, LegKind } from "./motion.ts";

export interface RoundPlan {
  legs: Leg[];
  /** Where the outline sits, as a share of the path from A to B. */
  target: number;
  /** Glide: how long one leg takes. */
  glideMs: number;
  /** Picture length as a share of the path's length. */
  sizeShare: number;
  /** Jump: spots per leg, time on each, and the outline's spot (counted from A). */
  spots: number;
  dwellMs: number;
  targetSpot: number;
  /** Jump: distance between two spots as a share of the path. */
  spotStep: number;
}

export type StopClass = "early" | "on_time" | "late" | "no_stop";

export interface StopResult {
  cls: StopClass;
  /** 1–3; the leg the stop came on. Null when there was no stop. */
  leg: number | null;
  kind: LegKind | null;
  /** Glide only: ms between the stop and the moment the picture was exactly on the outline (negative = early). */
  errorMs: number | null;
  /** Glide only: how far off, in picture lengths along the line (negative = short of the outline). */
  offset: number | null;
  /** Jump only: how many spots off (negative = before the outline's spot). */
  spotsOff: number | null;
  /** Where the picture is frozen, as a share of the path. */
  share: number | null;
}

export interface View {
  /** 0-based leg. */
  leg: number;
  kind: LegKind;
  reverse: boolean;
  /** Where the picture is, as a share of the path from A. */
  share: number;
  visible: boolean;
}

export const legMs = (plan: RoundPlan, leg: Leg): number => (leg.kind === "glide" ? plan.glideMs : plan.spots * plan.dwellMs);
export const roundMs = (plan: RoundPlan): number => plan.legs.reduce((s, l) => s + legMs(plan, l), 0);

/** The share of the path where spot `i` (counted from A) sits. */
export const spotShare = (plan: RoundPlan, i: number): number => plan.target + (i - plan.targetSpot) * plan.spotStep;

function locate(plan: RoundPlan, t: number): { index: number; leg: Leg; into: number } | null {
  let start = 0;
  for (let i = 0; i < plan.legs.length && i < LEGS; i++) {
    const leg = plan.legs[i]!;
    const ms = legMs(plan, leg);
    if (t < start + ms) return { index: i, leg, into: Math.max(0, t - start) };
    start += ms;
  }
  return null;
}

/** Which spot (counted from A) a jump leg is on, `into` ms after the leg began. */
function spotAt(plan: RoundPlan, leg: Leg, into: number): number {
  const step = Math.min(plan.spots - 1, Math.floor(into / plan.dwellMs));
  return leg.reverse ? plan.spots - 1 - step : step;
}

/** Where the picture is at `t` ms into the round, or null once all three legs have passed. */
export function viewAt(plan: RoundPlan, t: number): View | null {
  const at = locate(plan, t);
  if (!at) return null;
  const { index, leg, into } = at;
  if (leg.kind === "glide") {
    const p = into / plan.glideMs;
    return { leg: index, kind: "glide", reverse: leg.reverse, share: leg.reverse ? 1 - p : p, visible: true };
  }
  const spot = spotAt(plan, leg, into);
  const inSlot = (into % plan.dwellMs) / plan.dwellMs;
  return { leg: index, kind: "jump", reverse: leg.reverse, share: spotShare(plan, spot), visible: inSlot < JUMP_VISIBLE };
}

/** Judges a stop at `t` ms into the round. After the third leg it is "no stop". */
export function judge(plan: RoundPlan, t: number): StopResult {
  const at = locate(plan, t);
  if (!at) return { cls: "no_stop", leg: null, kind: null, errorMs: null, offset: null, spotsOff: null, share: null };
  const { index, leg, into } = at;
  if (leg.kind === "glide") {
    const travelled = into / plan.glideMs;
    const targetTravel = leg.reverse ? 1 - plan.target : plan.target;
    const errorMs = into - targetTravel * plan.glideMs;
    const offset = (travelled - targetTravel) / plan.sizeShare;
    const cls: StopClass = Math.abs(offset) <= TOLERANCE + 1e-9 ? "on_time" : offset < 0 ? "early" : "late";
    return { cls, leg: index + 1, kind: "glide", errorMs, offset, spotsOff: null, share: leg.reverse ? 1 - travelled : travelled };
  }
  const spot = spotAt(plan, leg, into);
  // Counted along the direction of travel, so "before" is always negative.
  const spotsOff = (spot - plan.targetSpot) * (leg.reverse ? -1 : 1);
  const cls: StopClass = spotsOff === 0 ? "on_time" : spotsOff < 0 ? "early" : "late";
  return { cls, leg: index + 1, kind: "jump", errorMs: null, offset: null, spotsOff, share: spotShare(plan, spot) };
}

/**
 * Share of the outline covered by the picture when it is off by (dx, dy) picture lengths. `mask` is the picture's
 * own shape on an n × n grid (non-zero = solid). A solid square off by 0.15 along one axis is 85% covered.
 */
export function coverage(mask: Uint8Array, n: number, dx: number, dy: number): number {
  const sx = Math.round(dx * n);
  const sy = Math.round(dy * n);
  let solid = 0;
  let covered = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (!mask[y * n + x]) continue;
      solid++;
      const px = x - sx;
      const py = y - sy;
      if (px >= 0 && px < n && py >= 0 && py < n && mask[py * n + px]) covered++;
    }
  }
  return solid === 0 ? 0 : covered / solid;
}
