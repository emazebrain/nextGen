/** Shared helpers for the offline-device API tests (spec 2026-11-07): ids, envelopes, a game step. */
import { randomBytes } from "node:crypto";

export function uuidv7(): string {
  const b = randomBytes(16);
  const ms = BigInt(Date.now());
  for (let i = 0; i < 6; i++) b[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function envelope(params: Record<string, unknown>, accuracy: number) {
  const trials = 20;
  const correct = Math.round(trials * accuracy);
  return {
    envelope_version: "1", session_id: uuidv7(), game_id: "catch-me-if-you-can", game_version: "0.1.0", demo: false,
    started_at: "2026-11-02T08:00:00.000Z", ended_at: "2026-11-02T08:05:00.000Z", status: "time_up", end_reason: "time_up",
    mode: params.session_mode, params, active_ms: 300000, paused_ms: 0, lives_start: 3, lives_lost: 1, lives_remaining: 2, life_loss_events: 1,
    difficulty_start: params.difficulty, levels: [],
    std: {
      trials_total: trials, correct, errors: trials - correct, timeouts: 0, accuracy, rt_mean_ms: 812.4, rt_median_ms: 790.6, rt_sd_ms: 120,
      rt_min_ms: 400, rt_cv: 0.15, left_accuracy: accuracy, right_accuracy: accuracy, left_rt_median_ms: 780, right_rt_median_ms: 800,
    },
    metrics: { highest_level: 3, levels_completed: 2 }, trials: [], practice_completed: true,
  };
}

export const step = (extra: Record<string, unknown> = {}) => ({
  game_id: "catch-me-if-you-can", session_mode: "timed_lives", duration_s: 300, lives: 3, difficulty_start: 2, hemisphere: "left", timer_position: "left",
  practice: "off", trial_window_ms: null, game_params: {}, progression: { metric: "accuracy", up_at: 0.8, up_after: 1, down_below: 0.5, down_after: 1 }, ...extra,
});

