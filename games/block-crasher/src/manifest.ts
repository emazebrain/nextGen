/** The SDK manifest: what the admin needs to list, configure and chart Block Crasher (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";
import { MAX_LEVEL } from "./levels.ts";

export const manifest: GameManifest = {
  id: "block-crasher",
  name: { en: "Block Crasher", he: "מפצח הלבנים" },
  summary: {
    en: "Move the paddle to bounce the ball and clear ten brick boards.",
    he: "מזיזים את המשטח, מקפיצים את הכדור ומנקים עשרה לוחות לבנים.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: MAX_LEVEL,
  ageRange: [5, 14],
  minutes: 5,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    trialWindow: false,
    practice: true,
    rng: "seeded",
    // §8.4: no second loss right after a re-serve.
    lifeLossGraceMs: 1000,
  },
  hemisphereNote: {
    left: {
      en: "Warm Canyon Fort. Most special bricks sit on the right half of the board.",
      he: "מבצר הקניון החמים. רוב הלבנים המיוחדות נמצאות בחצי הימני של הלוח.",
    },
    right: {
      en: "Cold Glacier Castle. Most special bricks sit on the left half of the board.",
      he: "טירת הקרחון הקרה. רוב הלבנים המיוחדות נמצאות בחצי השמאלי של הלוח.",
    },
  },
  recommendedMode: "timed",
  recommendedDurationS: 300,
  lifeLossEvents: [{ id: "ball_lost", label: { en: "The last ball fell past the paddle", he: "הכדור האחרון נפל מתחת למשטח" } }],
  qualifyingInteraction: "First serve",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      specials: {
        type: "boolean",
        default: true,
        "x-ui": {
          label: { en: "Special bricks", he: "לבנים מיוחדות" },
          help: { en: "Bricks that explode, slow the ball, change the paddle and more.", he: "לבנים שמתפוצצות, מאטות את הכדור, משנות את המשטח ועוד." },
          widget: "switch",
        },
      },
      special_rate: {
        type: "number",
        enum: [-1, 0.05, 0.1, 0.15, 0.2, 0.25],
        default: -1,
        "x-ui": {
          label: { en: "How many special bricks", he: "כמה לבנים מיוחדות" },
          widget: "select",
          visibleWhen: { specials: true },
          options: {
            "-1": { en: "By difficulty", he: "לפי הקושי" },
            "0.05": { en: "5%", he: "5%" },
            "0.1": { en: "10%", he: "10%" },
            "0.15": { en: "15%", he: "15%" },
            "0.2": { en: "20%", he: "20%" },
            "0.25": { en: "25%", he: "25%" },
          },
        },
      },
      paddle_assist: {
        type: "integer",
        enum: [0, 1, 2],
        default: 0,
        "x-ui": {
          label: { en: "Paddle help", he: "עזרה במשטח" },
          help: { en: "A magnet paddle catches the ball; strong also pulls it in.", he: "משטח מגנטי תופס את הכדור; חזק גם מושך אותו." },
          widget: "segmented",
          options: { "0": { en: "Off", he: "כבוי" }, "1": { en: "Catch", he: "תפיסה" }, "2": { en: "Catch and pull", he: "תפיסה ומשיכה" } },
        },
      },
    },
  },
  metrics: [
    { key: "paddle_miss_rate", label: { en: "Balls missed", he: "כדורים שהוחמצו" }, unit: "ratio", lowerIsBetter: true, skills: ["visuomotor", "sustained_attention"] },
    { key: "avg_intercept_gap_px", label: { en: "Distance from paddle centre (px)", he: "מרחק ממרכז המשטח (פיקסלים)" }, unit: "index", lowerIsBetter: true, skills: ["visuomotor"] },
    { key: "intercept_ms_median", label: { en: "Time to reach the ball", he: "זמן להגיע לכדור" }, unit: "ms", lowerIsBetter: false, skills: ["motor_planning"] },
    { key: "reversals_per_min", label: { en: "Paddle direction changes per minute", he: "שינויי כיוון בדקה" }, unit: "count", lowerIsBetter: true, skills: ["motor_planning"] },
    { key: "bricks_destroyed", label: { en: "Bricks cleared", he: "לבנים שנוקו" }, unit: "count", lowerIsBetter: false, skills: ["sustained_attention"] },
    { key: "side_miss_asymmetry", label: { en: "Misses right vs left", he: "החמצות ימין מול שמאל" }, unit: "index", lowerIsBetter: false, skills: ["visuospatial_attention"] },
    { key: "powerup_efficiency", label: { en: "Bricks per special brick", he: "לבנים לכל לבנה מיוחדת" }, unit: "index", lowerIsBetter: false },
    { key: "idle_seconds", label: { en: "Still time (s)", he: "זמן ללא תנועה (שניות)" }, unit: "count", lowerIsBetter: true, skills: ["sustained_attention"] },
    { key: "highest_level", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["visuomotor", "motor_planning", "sustained_attention", "visuospatial_attention"], regions: ["BA4", "BA6", "BA7", "BA17", "BA18", "cerebellum"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
