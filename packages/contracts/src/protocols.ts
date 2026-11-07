/**
 * Protocol templates, steps and assignments (design doc §5.4–5.5, §8.1–8.2).
 * Shared by the API (validation) and the app (forms), so a step the builder
 * accepts is a step the server accepts.
 */
import { z } from "zod";

export const SESSION_MODES = ["timed", "lives", "timed_lives"] as const;
export type SessionMode = (typeof SESSION_MODES)[number];

/**
 * Rule-based progression (§5.4 sentence builder): "If accuracy is at least
 * 80% in 2 sessions in a row → difficulty +1. Below 50% in 1 session → −1."
 */
export const progressionRule = z
  .object({
    metric: z.literal("accuracy"),
    up_at: z.number().min(0.5).max(1),
    up_after: z.number().int().min(1).max(5),
    down_below: z.number().min(0).max(0.9),
    down_after: z.number().int().min(1).max(5),
  })
  .refine((r) => r.down_below < r.up_at, "down_must_be_below_up");
export type ProgressionRule = z.infer<typeof progressionRule>;

export const DEFAULT_PROGRESSION: ProgressionRule = { metric: "accuracy", up_at: 0.8, up_after: 2, down_below: 0.5, down_after: 1 };

export const gameStepInput = z
  .object({
    step_type: z.literal("game").default("game"),
    game_id: z.string().min(1).max(60),
    session_mode: z.enum(SESSION_MODES),
    duration_s: z.number().int().min(30).max(1800).nullable(),
    lives: z.number().int().min(1).max(9).nullable(),
    difficulty_start: z.number().int().min(1).max(5),
    hemisphere: z.enum(["left", "right"]),
    timer_position: z.enum(["left", "right", "hidden"]),
    practice: z.enum(["auto", "on", "off"]),
    trial_window_ms: z.number().int().min(1000).max(300000).nullable(),
    game_params: z.record(z.string(), z.union([z.boolean(), z.number(), z.string()])),
    progression: progressionRule.nullable(),
    /** Black and white (ADR 0009). Only for games whose manifest supports it. */
    monochrome: z.boolean().default(false),
    /** lives = auto: the game's per-board heart budget instead of a session count (Peek Peek, ADR 0012). `lives` is then null. */
    lives_auto: z.boolean().default(false),
  })
  .superRefine((s, ctx) => {
    // Only the fields the mode uses are set (§8.1), so a step can never be "timed" without a time limit.
    const needTime = s.session_mode !== "lives";
    const needLives = s.session_mode !== "timed";
    if (needTime && s.duration_s === null) ctx.addIssue({ code: "custom", path: ["duration_s"], message: "needs_duration" });
    if (!needTime && s.duration_s !== null) ctx.addIssue({ code: "custom", path: ["duration_s"], message: "no_duration_in_lives" });
    if (needLives && s.lives === null && !s.lives_auto) ctx.addIssue({ code: "custom", path: ["lives"], message: "needs_lives" });
    if (needLives && s.lives !== null && s.lives_auto) ctx.addIssue({ code: "custom", path: ["lives"], message: "lives_or_auto" });
    if (!needLives && (s.lives !== null || s.lives_auto)) ctx.addIssue({ code: "custom", path: ["lives"], message: "no_lives_in_timed" });
  });
/** A video between games (design doc §7: exactly one of game_id / video_id). It carries no game settings. */
export const videoStepInput = z.object({ step_type: z.literal("video"), video_id: z.string().uuid() }).strict();

/** A protocol step: a game or a video. Steps without step_type (older apps) are games. */
export const stepInput = z.preprocess(
  (v) => (v && typeof v === "object" && !("step_type" in v) ? { ...v, step_type: "game" } : v),
  z.discriminatedUnion("step_type", [gameStepInput, videoStepInput]),
);
/** As sent by clients: `step_type`, `monochrome` and `lives_auto` may be left out on game steps. */
export type GameStepInput = z.input<typeof gameStepInput>;
export type VideoStepInput = z.input<typeof videoStepInput>;
export type StepInput = GameStepInput | VideoStepInput;
export const isVideoStep = (s: { step_type?: string }): s is VideoStepInput => s.step_type === "video";

const planFields = {
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  weeks: z.number().int().min(1).max(52),
  sessions_per_week: z.number().int().min(1).max(7),
  setting: z.enum(["clinic", "home", "mixed"]),
};

export const templateInput = z.object({
  clinic_id: z.string().uuid(),
  ...planFields,
  visibility: z.enum(["private", "clinic"]),
  steps: z.array(stepInput).min(1).max(12),
});
export type TemplateInput = z.input<typeof templateInput>;

export const assignInput = z.object({
  template_id: z.string().uuid().nullable(),
  ...planFields,
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  steps: z.array(stepInput).min(1).max(12),
});
export type AssignInput = z.input<typeof assignInput>;

export interface TemplateSummary {
  id: string;
  name: string;
  description: string | null;
  weeks: number;
  sessions_per_week: number;
  setting: "clinic" | "home" | "mixed";
  visibility: "private" | "clinic" | "platform";
  version: number;
  owner_name: string | null;
  can_edit: boolean;
  /** Game ids in step order (video steps left out). */
  games: string[];
  /** Every step in order, games and videos. */
  items: StepItem[];
}

export type StepItem = { kind: "game"; game_id: string } | { kind: "video"; video_id: string; title: string };

export interface TemplateDetail extends TemplateSummary {
  clinic_id: string | null;
  steps: Array<StepInput & { id: string; ordinal: number }>;
}

export type AssignmentStepView = StepInput & {
  id: string;
  ordinal: number;
  current_difficulty: number;
  sessions_completed: number;
};

export interface PlannedSessionView {
  id: string;
  seq: number;
  week: number;
  planned_date: string;
  status: "planned" | "in_progress" | "done" | "missed" | "skipped" | "cancelled";
}

export interface AssignmentView {
  id: string;
  name: string;
  template_id: string | null;
  start_date: string;
  weeks: number;
  sessions_per_week: number;
  setting: "clinic" | "home" | "mixed";
  status: "active" | "paused" | "completed" | "cancelled";
  assigned_by_name: string | null;
  steps: AssignmentStepView[];
  sessions: PlannedSessionView[];
}

export interface TodayItem {
  planned_session_id: string;
  planned_date: string;
  seq: number;
  week: number;
  total: number;
  patient: { id: string; given_name: string; family_name: string; date_of_birth: string; alert: string | null; can_play: boolean };
  assignment: { id: string; name: string; weeks: number };
  games: string[];
}

function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  return dt.toISOString().slice(0, 10);
}

/**
 * Spreads sessions evenly through each week from the start date: 2 a week →
 * days 0 and 3 (e.g. Sun and Wed), 3 a week → 0, 2, 4. Pure; tested.
 */
export function scheduleDates(startDate: string, weeks: number, perWeek: number): Array<{ seq: number; week: number; date: string }> {
  const out: Array<{ seq: number; week: number; date: string }> = [];
  for (let w = 0; w < weeks; w++) {
    for (let i = 0; i < perWeek; i++) {
      out.push({ seq: out.length + 1, week: w + 1, date: addDays(startDate, w * 7 + Math.floor((i * 7) / perWeek)) });
    }
  }
  return out;
}
