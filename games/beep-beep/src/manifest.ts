/** The SDK manifest: what the admin needs to list, configure and chart Beep Beep (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";
import { MAX_LEVEL } from "./levels.ts";

export const manifest: GameManifest = {
  id: "beep-beep",
  name: { en: "Beep Beep", he: "ביפ ביפ" },
  summary: {
    en: "Slide the vehicles to clear a way out for the hero.",
    he: "מזיזים את כלי הרכב ומפנים דרך יציאה לגיבור.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: MAX_LEVEL,
  ageRange: [6, 14],
  minutes: 8,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    // An optional time limit per board (§8.4: 30–300 s for this game).
    trialWindow: { minMs: 30_000, maxMs: 300_000, defaultMs: null },
    practice: true,
    rng: "seeded",
  },
  hemisphereNote: {
    left: {
      en: "Warm Desert Rally. The exit is on the right of the board.",
      he: "ראלי מדבר חמים. היציאה בצד ימין של הלוח.",
    },
    right: {
      en: "Cold Harbor Rush. The exit is on the left of the board.",
      he: "נמל קריר. היציאה בצד שמאל של הלוח.",
    },
  },
  recommendedMode: "timed_lives",
  recommendedDurationS: 480,
  lifeLossEvents: [
    { id: "move_budget", label: { en: "Ran out of moves on a board", he: "נגמרו המהלכים בלוח" } },
    { id: "board_time", label: { en: "Ran out of time on a board", he: "נגמר הזמן בלוח" } },
  ],
  qualifyingInteraction: "First move on the first board",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      hint_button: {
        type: "boolean",
        default: true,
        "x-ui": { label: { en: "Hint button", he: "כפתור רמז" }, help: { en: "Four steps: what's in the way, what to move, where, then it moves.", he: "ארבעה שלבים: מה חוסם, מה להזיז, לאן, ואז זה זז." }, widget: "switch" },
      },
      hint_after_s: {
        type: "integer",
        minimum: 0,
        maximum: 120,
        default: 0,
        "x-ui": {
          label: { en: "Glow on the blockers after (s)", he: "הדגשת החוסמים אחרי (שניות)" },
          help: { en: "0 = by difficulty: 20, 30 or 45 s at 1–3, off at 4–5.", he: "0 = לפי הקושי: 20, 30 או 45 שניות ב-1–3, כבוי ב-4–5." },
          widget: "slider",
          step: 5,
        },
      },
      show_answer_on_miss: {
        type: "boolean",
        default: true,
        "x-ui": { label: { en: "Show the right move after a miss", he: "להראות את המהלך הנכון אחרי כישלון" }, widget: "switch" },
      },
      undo: {
        type: "boolean",
        default: true,
        "x-ui": { label: { en: "Undo and start-again buttons", he: "כפתורי ביטול והתחלה מחדש" }, widget: "switch" },
      },
    },
  },
  metrics: [
    { key: "planning_efficiency", label: { en: "Planning efficiency", he: "יעילות התכנון" }, unit: "ratio", lowerIsBetter: false, skills: ["planning"] },
    { key: "optimal_move_rate", label: { en: "Moves that brought the exit closer", he: "מהלכים שקירבו ליציאה" }, unit: "ratio", lowerIsBetter: false, skills: ["planning"] },
    { key: "regressive_move_rate", label: { en: "Moves that set it back", he: "מהלכים שהרחיקו" }, unit: "ratio", lowerIsBetter: true, skills: ["planning", "self_correction"] },
    { key: "longest_plan_run", label: { en: "Longest run of good moves", he: "רצף המהלכים הטובים הארוך ביותר" }, unit: "count", lowerIsBetter: false, skills: ["planning"] },
    { key: "level_accuracy", label: { en: "Boards cleared", he: "לוחות שנפתרו" }, unit: "ratio", lowerIsBetter: false, skills: ["problem_solving"] },
    { key: "first_move_latency_ms", label: { en: "Thinking before the first move", he: "זמן חשיבה לפני המהלך הראשון" }, unit: "ms", lowerIsBetter: false, skills: ["planning"] },
    { key: "avg_seconds_per_move", label: { en: "Seconds per move", he: "שניות למהלך" }, unit: "index", lowerIsBetter: false },
    { key: "hints_used", label: { en: "Hints used", he: "רמזים" }, unit: "count", lowerIsBetter: true, skills: ["problem_solving"] },
    { key: "undos", label: { en: "Undos", he: "ביטולים" }, unit: "count", lowerIsBetter: false, skills: ["self_correction"] },
    { key: "resets", label: { en: "Starts again", he: "התחלות מחדש" }, unit: "count", lowerIsBetter: false, skills: ["self_correction"] },
    { key: "deepest_solved", label: { en: "Hardest board solved (moves)", he: "הלוח הקשה ביותר שנפתר (מהלכים)" }, unit: "count", lowerIsBetter: false, skills: ["problem_solving"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["planning", "problem_solving", "spatial_reasoning", "self_correction"], regions: ["BA9", "BA46", "BA10", "BA7"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
