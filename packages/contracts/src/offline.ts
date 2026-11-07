/**
 * Offline therapist devices (spec docs/superpowers/specs/2026-11-07-offline-device-design.md, ADR 0019): what a
 * device downloads, what an offline (v2) launch ticket allows, and the device APIs.
 */
import { z } from "zod";
import type { PatientDetail, PatientListItem } from "./patients.ts";
import type { AssignmentView, ProgressionRule, TemplateSummary, TodayItem } from "./protocols.ts";
import type { LaunchPackage, LaunchVideoStep } from "./sessions.ts";

/** What a v2 ticket allows: these settings exactly as assigned, and a difficulty range. Seed, practice and instructions are free. */
export interface AllowedParams {
  exact: Record<string, unknown>;
  difficulty: { min: number; max: number };
}

const FREE = new Set(["seed", "practice", "instructions"]);

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object).sort();
  const kb = Object.keys(b as object).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && same((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

export function paramsWithinAllowed(allowed: AllowedParams, params: Record<string, unknown>): boolean {
  for (const [k, v] of Object.entries(allowed.exact)) if (!(k in params) || !same(params[k], v)) return false;
  const d = params.difficulty;
  if (typeof d !== "number" || !Number.isInteger(d) || d < allowed.difficulty.min || d > allowed.difficulty.max) return false;
  for (const k of Object.keys(params)) if (k !== "difficulty" && !FREE.has(k) && !(k in allowed.exact)) return false;
  return true;
}

/** The parameters a device builds for an offline game step; the same practice and instructions rules as the API's launch. */
export function offlineParams(
  base: Record<string, unknown>,
  o: { difficulty: number; sessionsCompleted: number; practiceSetting: "on" | "off" | "auto"; seed: number },
): Record<string, unknown> {
  return {
    ...base,
    difficulty: o.difficulty,
    practice: o.practiceSetting === "auto" ? (o.sessionsCompleted === 0 ? "on" : "off") : o.practiceSetting,
    instructions: o.sessionsCompleted < 2 ? "always" : "short",
    seed: o.seed,
  };
}

/** A game step in an offline package: the device picks difficulty (progression), seed, practice and instructions. */
export interface PackageGameStep {
  kind: "game";
  assignment_step_id: string;
  ordinal: number;
  game_id: string;
  ticket: string;
  allowed: AllowedParams;
  base_params: Record<string, unknown>;
  practice_setting: "on" | "off" | "auto";
  sessions_completed: number;
  progression: ProgressionRule | null;
  difficulty: number;
  /** The step's recent counted results, oldest first: with them the device decides difficulty as the server would. */
  history: Array<{ accuracy: number | null; difficulty: number; valid: boolean }>;
  done: boolean;
}

export interface SessionPackage extends Omit<LaunchPackage, "steps"> {
  planned_date: string;
  steps: Array<PackageGameStep | LaunchVideoStep>;
}

export interface OfflineVideoRef {
  id: string;
  version: number;
  sha256: string;
  bytes: number;
  file_url: string;
}

export interface OfflineMe {
  user: { id: string; email: string; name: string };
  memberships: unknown[];
  is_platform_admin?: boolean;
}

export interface OfflineBundle {
  generated_at: string;
  me: OfflineMe;
  today: TodayItem[];
  caseload: PatientListItem[];
  patients: Record<string, PatientDetail>;
  templates: TemplateSummary[];
  assignments: AssignmentView[];
  packages: SessionPackage[];
  videos: OfflineVideoRef[];
  ended_spaces: string[];
}

export interface LibraryManifest {
  videos: OfflineVideoRef[];
}

export const deviceRegisterInput = z
  .object({
    device_id: z.string().uuid(),
    outbox_public_key: z.string().min(1).max(200),
  })
  .strict();
export type DeviceRegisterInput = z.infer<typeof deviceRegisterInput>;

export interface DeviceSecrets {
  outbox_secret: string | null;
  spaces: Array<{ space_id: string; clinic_id: string; space_secret: string }>;
}

export interface DeviceSpace {
  id: string;
  user_id: string;
  full_name: string;
  clinic_id: string;
  clinic_name: string;
  last_online_at: string;
  ended_at: string | null;
}

/** Why a result that arrived after something changed is waiting for review. */
export const REVIEW_REASONS = [
  "consent_withdrawn",
  "not_on_care_team",
  "membership_ended",
  "assignment_not_active",
  "step_changed",
  "session_closed",
  "played_twice",
  "params_outside_ticket",
  "ticket_expired",
] as const;
export type ReviewReason = (typeof REVIEW_REASONS)[number];
