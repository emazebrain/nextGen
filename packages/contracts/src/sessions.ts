/**
 * Running sessions (design doc §5.6, §8.2, §9.8): the launch package the
 * app receives, and the results envelope it uploads. The envelope mirrors
 * @emb/game-runtime's ResultEnvelope; the device's UUIDv7 session_id is the
 * idempotency key.
 */
import { z } from "zod";

const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const num = z.number().finite();
const nullableNum = num.nullable();

export const resultEnvelope = z.object({
  envelope_version: z.literal("1"),
  session_id: z.string().regex(UUID_V7, "invalid_session_id"),
  game_id: z.string().min(1).max(60),
  game_version: z.string().min(1).max(30),
  demo: z.boolean(),
  started_at: z.string().datetime().nullable(),
  ended_at: z.string().datetime(),
  status: z.enum(["completed", "time_up", "out_of_lives", "abandoned"]),
  end_reason: z.string().min(1).max(40),
  mode: z.enum(["timed", "lives", "timed_lives"]),
  params: z.record(z.string(), z.unknown()),
  active_ms: z.number().int().min(0).max(4 * 3600 * 1000),
  paused_ms: z.number().int().min(0),
  lives_start: z.number().int().nullable(),
  lives_lost: z.number().int().min(0),
  lives_remaining: z.number().int().nullable(),
  life_loss_events: z.number().int().min(0),
  difficulty_start: z.number().int().min(1).max(5),
  levels: z.array(z.record(z.string(), z.unknown())).max(500),
  std: z.object({
    trials_total: z.number().int().min(0),
    correct: z.number().int().min(0),
    errors: z.number().int().min(0),
    timeouts: z.number().int().min(0),
    accuracy: nullableNum,
    rt_mean_ms: nullableNum,
    rt_median_ms: nullableNum,
    rt_sd_ms: nullableNum,
    rt_min_ms: nullableNum,
    rt_cv: nullableNum,
    left_accuracy: nullableNum,
    right_accuracy: nullableNum,
    left_rt_median_ms: nullableNum,
    right_rt_median_ms: nullableNum,
  }),
  metrics: z.record(z.string(), z.unknown()),
  trials: z.array(z.record(z.string(), z.unknown())).max(5000),
  practice_completed: z.boolean(),
});
export type ResultEnvelopeInput = z.infer<typeof resultEnvelope>;

export const resultUpload = z.object({
  /** The signed launch ticket this game was started with. */
  ticket: z.string().min(20).max(4000),
  envelope: resultEnvelope,
});
export type ResultUpload = z.infer<typeof resultUpload>;

export interface LaunchGameStep {
  kind: "game";
  assignment_step_id: string;
  ordinal: number;
  game_id: string;
  /** Platform + game parameters, exactly as signed into the ticket. */
  params: Record<string, unknown>;
  ticket: string;
  /** Already has a result in this session (picking up after an interruption). */
  done: boolean;
}

/** A video between games: played by the app itself, no ticket (ADR 0018). */
export interface LaunchVideoStep {
  kind: "video";
  assignment_step_id: string;
  ordinal: number;
  video: {
    id: string;
    version: number;
    source: "upload" | "youtube";
    youtube_id: string | null;
    title: string;
    duration_s: number | null;
    /** Same-origin URL of the file for uploads (includes ?v=<version>); null for YouTube. */
    file_url: string | null;
    sha256: string | null;
  };
  /** Already watched in this session. */
  done: boolean;
  /** Offline packages only: the step's v2 ticket, sent with the view (spec 2026-11-07 offline devices). */
  ticket?: string;
}

export type LaunchStep = LaunchGameStep | LaunchVideoStep;

export const videoViewInput = z
  .object({
    client_view_id: z.string().regex(UUID_V7, "invalid_view_id"),
    planned_session_id: z.string().uuid(),
    assignment_step_id: z.string().uuid(),
    video_id: z.string().uuid(),
    video_version: z.number().int().min(1),
    started_at: z.string().datetime(),
    ended_at: z.string().datetime(),
    watched_s: z.number().int().min(0).max(7200),
    /** null: not known (a YouTube video whose length was never entered). */
    completed: z.boolean().nullable(),
    /** The step's v2 ticket from an offline session package: names the therapist and the device (spec 2026-11-07). */
    ticket: z.string().max(4096).optional(),
  })
  .refine((v) => v.ended_at >= v.started_at, { path: ["ended_at"], message: "ends_before_start" });
export type VideoViewInput = z.infer<typeof videoViewInput>;

export interface VideoViewReceipt {
  /** kept_for_review: stored, but it arrived after something changed (spec 2026-11-07 offline devices). */
  outcome: "accepted" | "duplicate" | "kept_for_review";
  planned_session_status: string | null;
  review_reason?: string | null;
}

export interface LaunchPackage {
  planned_session_id: string;
  seq: number;
  week: number;
  total: number;
  patient: { id: string; given_name: string; family_name: string; preferred_locale: string; alert: string | null };
  assignment: { id: string; name: string };
  steps: LaunchStep[];
}

export interface ResultReceipt {
  /** kept_for_review: stored, but it arrived after something changed (spec 2026-11-07 offline devices). */
  outcome: "accepted" | "duplicate" | "kept_for_review";
  review_reason?: string | null;
  session_id: string;
  progression: { action: "up" | "down" | "hold"; from: number; to: number } | null;
  planned_session_status: string | null;
}

export interface GameSessionView {
  id: string;
  game_id: string;
  status: "completed" | "time_up" | "out_of_lives" | "abandoned";
  session_mode: "timed" | "lives" | "timed_lives";
  difficulty: number;
  hemisphere: "left" | "right";
  /** Played in black and white (ADR 0009); older sessions count as colour. */
  monochrome: boolean;
  started_at: string | null;
  ended_at: string;
  active_ms: number;
  accuracy: number | null;
  rt_median_ms: number | null;
  trials_total: number;
  correct: number;
  errors: number;
  lives_lost: number;
  highest_level: number | null;
  planned_session_id: string | null;
  seq: number | null;
  metrics: Record<string, unknown>;
  /** False when a review excluded it, or it was flagged consent_withdrawn and nobody has reviewed it yet. */
  counts: boolean;
  review: { reason: string; decision: "accept" | "exclude" | null } | null;
}

/** An automatic difficulty change, for the progress chart's markers (design doc §5.5). */
export interface ProgressionDecisionView {
  id: string;
  game_session_id: string;
  game_id: string;
  decided_at: string;
  action: "up" | "down";
  from_difficulty: number;
  to_difficulty: number;
  reason: string;
}

/** Canonical JSON (sorted keys, recursively), so the same params always hash the same. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`)
    .join(",")}}`;
}
