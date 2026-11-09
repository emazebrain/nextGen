/**
 * @emb/game-sdk — the public contract between a game and the eMazeBrain host
 * (design doc §8.3). Games import ONLY this package. Types only; no runtime.
 */
import type { EndReason, SessionMode, SessionStatus } from "@emb/session-rules";

export type { EndReason, SessionMode, SessionStatus };

export type Palette = "warm" | "cold";
export type Locale = "he" | "en" | "ar" | "ru" | "fr" | "es" | "zh";

/** A JSON Schema (draft 2020-12 subset) for a game's own parameters, with x-ui hints for the generated settings form. */
export interface ParamsSchema {
  type: "object";
  properties: Record<
    string,
    {
      type: "integer" | "number" | "boolean" | "string";
      enum?: Array<string | number>;
      minimum?: number;
      maximum?: number;
      default?: unknown;
      "x-ui"?: { label: LocalText; help?: LocalText; widget?: "slider" | "switch" | "select" | "segmented"; step?: number; options?: Record<string, LocalText>; /** Show this setting only when other settings have these values. */ visibleWhen?: Record<string, string | number | boolean> };
    }
  >;
  additionalProperties?: false;
}

export type LocalText = Partial<Record<Locale, string>> & { en: string };

/** A metric the game reports, shown in trend charts (design doc §8.3 metrics.json). */
export interface MetricDefinition {
  key: string;
  label: LocalText;
  unit: "ratio" | "ms" | "count" | "score" | "delta_e" | "index";
  lowerIsBetter: boolean;
  /** Skills this metric informs (taxonomy codes). */
  skills?: string[];
}

export interface GameManifest {
  id: string;
  name: Partial<Record<Locale, string>> & { en: string };
  version: string; // semver
  sdkVersion: string; // semver range, e.g. "^2.0.0"
  entry: string;
  renderer: "pixi" | "three" | "canvas2d";
  orientation: Array<"landscape" | "portrait">;
  inputs: Array<"touch" | "mouse" | "keyboard">;
  maxLevel: number;
  capabilities: {
    modes: SessionMode[];
    livesAuto: boolean;
    trialWindow: false | { minMs: number; maxMs: number; defaultMs: number | null };
    practice: boolean;
    rng: "seeded";
    /** The game can run in black and white (platform parameter `monochrome`, ADR 0009). */
    monochrome?: boolean;
    /**
     * Continuous games: after a life is lost, further losses inside this window are ignored by Session Rules
     * (0–3000 ms; design doc §8.1, ADR 0014). Default 0.
     */
    lifeLossGraceMs?: number;
  };
  /**
   * What the hemisphere choice changes in this game, shown under it in the protocol builder (ADR 0011),
   * e.g. which side the larger board appears on.
   */
  hemisphereNote?: { left: LocalText; right: LocalText };
  /**
   * What a brain-region filter changes in this game, besides the hemisphere (spec 2026-11-09). `background` names the
   * game's own background parameters; the host fills them from the row at launch. The rest are read from `region`.
   */
  regionUse?: { background?: { temperature: string; type: string }; direction?: true; targetLocation?: true; rotation?: true; movement?: true };
  recommendedMode?: SessionMode;
  recommendedDurationS?: number;
  lifeLossEvents: Array<{ id: string; label: LocalText }>;
  qualifyingInteraction: string;
  /** The game's own parameters (namespaced by the game id when stored, e.g. catch_me.cvd_mode). */
  paramsSchema: ParamsSchema;
  metrics: MetricDefinition[];
  /** Short description for the library card. */
  summary: LocalText;
  ageRange: [number, number];
  minutes: number;
  assetPacks: Record<Palette | "shared", string>;
  taxonomy: { skills: string[]; regions: string[] };
  sizeBytes: { core: number; warm: number; cold: number };
}

/** Platform parameters every game receives (design doc §8.2). Native params are namespaced. */
export interface PlatformParams {
  session_mode: SessionMode;
  duration_s?: number;
  lives?: number | "auto";
  difficulty: 1 | 2 | 3 | 4 | 5;
  start_level: number | "from_difficulty";
  max_level?: number;
  hemisphere: "left" | "right";
  timer_position: "left" | "right" | "hidden";
  /** Black and white: greys only, for the game and the HUD (ADR 0009). */
  monochrome?: boolean;
  trial_window_ms?: number | null;
  practice: "auto" | "on" | "off";
  instructions: "auto" | "always" | "short";
  scene?: string;
  lang: Locale;
  sound: "off" | "effects" | "all";
  reduce_motion: "os" | "on" | "off";
  high_contrast: boolean;
  show_score: boolean;
  context: "clinic" | "home";
  seed: number;
  input_assist: "none" | "large_hit" | "dwell_800ms" | "switch_scan";
  speed_scale: number; // 0.5–1.0
  /**
   * The step's brain-region filter, resolved by the host at launch (brain-region filters spec 2026-11-09). Absent when
   * the step has none (side only). `hemisphere` above already follows the row: cold → right, warm → left.
   */
  region?: RegionParam;
}

export type RegionDirection = "ltr" | "rtl" | "ttb" | "btt" | "tldbr" | "brdtl" | "trdbl" | "bldtr";
export type RegionCompass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";
/** One row of the product owner's brain-region table, for the chosen filter. Where a list has several options, the game chooses with the seed. */
export interface RegionParam {
  /** The chosen node: a lobe, a sub-lobe or a Brodmann area, e.g. "right.temporal.superior_temporal". */
  path: string;
  /** The sub-lobe whose row applies. */
  sublobe: string;
  /** True when a lobe was chosen and this launch's sub-lobe was drawn from it. */
  drawn: boolean;
  bg_temperature: "warm" | "cold";
  bg_types: ("solid" | "textured")[];
  motion: { movement_types: number[]; directions: RegionDirection[] }[];
  /** Where most objects are placed. */
  target_locations: RegionCompass[];
  rotation: "cw" | "ccw";
  clinical_status: "draft" | "approved";
  revision: number;
}

export type TrialOutcome = "correct" | "error" | "timeout" | "omission" | "commission";

export interface TrialEvent {
  trialId: string;
  level: number;
  stimulusOnMs: number;
  responseMs: number | null;
  outcome: TrialOutcome;
  target?: { x: number; y: number; hemifield: "L" | "R" | "C" };
  tags?: Record<string, string | number>;
}

export interface LevelHistoryRow {
  level: number;
  durationMs: number;
  scoreDelta: number;
  trials: number;
  correct: number;
  errors: number;
  livesLost: number;
  outcome: "cleared" | "failed" | "timeout";
  detail?: Record<string, unknown>;
}

/** Provided by the host. The game reports; Session Rules decides. */
export interface SessionApi {
  qualifyingInteraction(): void;
  trial(t: TrialEvent): void;
  lifeLossEvent(id: string, data?: Record<string, unknown>): void;
  levelComplete(row: LevelHistoryRow): void;
  contentExhausted(reason?: "content_exhausted" | "max_level" | "trial_cap"): void;
  log(type: string, data?: Record<string, unknown>): void;
  onLifeLost(cb: (remaining: number | null) => void): void;
  /**
   * lives = "auto" only (Peek Peek): the game's per-board heart budget, shown in the shared HUD. Call it when a
   * board starts and after each wrong tile; it refills on each new board. Ignored in every other mode.
   */
  boardHearts?(left: number, total: number): void;
  onTrialWindow(cb: (msLeft: number) => void): void;
  onEnd(cb: (status: SessionStatus) => void): void;
  readonly state: { activeMs: number; livesRemaining: number | null; mode: SessionMode; paused: boolean };
}

export interface AssetPack {
  id: string;
  version: string;
  palette: Palette;
  get(path: string): ArrayBuffer;
  tokens: Record<string, string>;
}

export interface InitContext {
  params: PlatformParams & Record<string, unknown>;
  /** Asset pack for the hemisphere's palette. Games drawn in code may ignore it. */
  assets: AssetPack | null;
  /** Seeded from params.seed: the only source of randomness a game may use. */
  rng: () => number;
  /** The game's own strings in params.lang, with {name} placeholders filled. */
  t: (key: string, vars?: Record<string, string | number>) => string;
  session: SessionApi;
  /** Element the game renders into. It fills the frame; the HUD sits above it. */
  mount: HTMLElement;
  /** OS setting or the in-app switch: no shake, parallax or particle bursts. */
  reducedMotion: boolean;
  /** Palette tokens for the hemisphere (design doc §7.1): g50…g900, accent1, accent2, heart, success, error. */
  palette: Palette;
  tokens: Record<string, string>;
  /** Black and white (params.monochrome): tokens are greys; the game draws greys only. */
  monochrome: boolean;
}

export type PauseReason = "app_hidden" | "manual" | "instructions" | "therapist_hold" | "focus_lost";

export interface GameModule {
  init(ctx: InitContext): Promise<void>;
  showInstructions?(): { demoAssetId: string; textKey: string };
  startPractice?(): Promise<{ trials: number }>;
  start(): void;
  pause(reason: PauseReason): void;
  resume(): void;
  end(status: SessionStatus, reason: EndReason): Record<string, number | string | object>;
  destroy(): void;
}

export type CreateGame = () => GameModule;

/** What a game package exports. */
export interface GameDefinition {
  manifest: GameManifest;
  create: CreateGame;
  /** Instruction and feedback strings by locale (at least en and he). */
  strings: Partial<Record<Locale, Record<string, string>>> & { en: Record<string, string> };
}
