/** The SDK manifest: what the admin needs to list, configure and chart this game (design doc §8.3). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  id: "catch-me-if-you-can",
  name: { en: "Catch Me If You Can", he: "תפסו אותי אם תוכלו" },
  summary: {
    en: "Find the tile that looks a little different. The difference gets smaller as you go.",
    he: "מוצאים את המשבצת שנראית קצת אחרת. ההבדל קטן ככל שמתקדמים.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse"],
  maxLevel: 9,
  ageRange: [4, 14],
  minutes: 5,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    trialWindow: { minMs: 1000, maxMs: 30000, defaultMs: null },
    practice: true,
    rng: "seeded",
    monochrome: true,
  },
  recommendedMode: "timed_lives",
  lifeLossEvents: [
    { id: "wrong_tile", label: { en: "Wrong tile", he: "משבצת לא נכונה" } },
    { id: "trial_timeout", label: { en: "Time for a board runs out", he: "הזמן ללוח נגמר" } },
  ],
  qualifyingInteraction: "First tile tap after practice",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      cvd_mode: {
        type: "boolean",
        default: false,
        "x-ui": {
          label: { en: "Brightness differences only", he: "הבדלי בהירות בלבד" },
          help: { en: "For children with colour-vision deficiency. Set automatically from the patient record.", he: "לילדים עם עיוורון צבעים. נקבע אוטומטית לפי רשומת המטופל." },
          widget: "switch",
        },
      },
      // Backgrounds (ADR 0009). The background never touches the tiles: each board keeps its plain light frame.
      background: {
        type: "string",
        enum: ["solid", "textured"],
        default: "solid",
        "x-ui": {
          label: { en: "Background", he: "רקע" },
          help: { en: "Textured: flat patterns for the left hemisphere, 3D shapes for the right.", he: "עם טקסטורה: דוגמאות שטוחות להמיספרה השמאלית, צורות תלת־ממדיות לימנית." },
          widget: "segmented",
          options: { solid: { en: "Solid", he: "אחיד" }, textured: { en: "Textured", he: "עם טקסטורה" } },
        },
      },
      bg_motion: {
        type: "boolean",
        default: false,
        "x-ui": {
          label: { en: "Moving background", he: "רקע בתנועה" },
          help: { en: "Slow movement behind the boards. Off when the device asks for reduced motion.", he: "תנועה איטית מאחורי הלוחות. כבויה כשהמכשיר מוגדר להפחתת תנועה." },
          widget: "switch",
          visibleWhen: { background: "textured" },
        },
      },
      bg_temperature: {
        type: "string",
        enum: ["auto", "warm", "cold"],
        default: "auto",
        "x-ui": {
          label: { en: "Background colours", he: "צבעי הרקע" },
          help: { en: "A colour is picked at random from this palette for each session.", he: "בכל מפגש נבחר צבע אקראי מהפלטה הזו." },
          widget: "select",
          options: { auto: { en: "Follow the hemisphere", he: "לפי ההמיספרה" }, warm: { en: "Warm", he: "חמים" }, cold: { en: "Cold", he: "קרים" } },
        },
      },
    },
  },
  metrics: [
    { key: "final_jnd", label: { en: "Smallest difference missed (ΔE)", he: "ההבדל הקטן ביותר שהוחמץ (ΔE)" }, unit: "delta_e", lowerIsBetter: true, skills: ["visual_discrimination"] },
    { key: "min_cleared_delta_e", label: { en: "Smallest difference found (ΔE)", he: "ההבדל הקטן ביותר שנמצא (ΔE)" }, unit: "delta_e", lowerIsBetter: true, skills: ["visual_discrimination"] },
    { key: "anchor_first_rate", label: { en: "Main board checked first", he: "הלוח הראשי נבדק קודם" }, unit: "ratio", lowerIsBetter: false, skills: ["selective_attention"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
    { key: "highest_level", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["visual_discrimination", "selective_attention", "visuospatial_attention"], regions: ["BA17", "BA18", "BA19", "BA7", "BA40", "BA8"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
