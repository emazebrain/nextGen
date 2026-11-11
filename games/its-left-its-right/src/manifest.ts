/** The SDK manifest for It's Left, It's Right (spec 2026-11-10). */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  id: "its-left-its-right",
  name: { en: "It's Left, It's Right", he: "שמאלה, ימינה" },
  summary: {
    en: "A picture of a body part appears rotated on the screen. Decide if it shows a left or a right.",
    he: "תמונה של חלק גוף מופיעה מסובבת על המסך. החליטו אם זה שמאל או ימין.",
  },
  version: "1.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse"],
  maxLevel: 30,
  ageRange: [4, 16],
  minutes: 5,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    trialWindow: false,
    practice: true,
    rng: "seeded",
    monochrome: false,
  },
  hemisphereNote: {
    left: {
      en: "Warm colours.",
      he: "צבעים חמים.",
    },
    right: {
      en: "Cool colours.",
      he: "צבעים קרים.",
    },
  },
  regionUse: {
    background: { temperature: "bg_temperature", type: "background" },
    direction: true,
    targetLocation: true,
  },
  recommendedMode: "timed_lives",
  recommendedDurationS: 300,
  lifeLossEvents: [
    { id: "wrong_answer", label: { en: "Chose the wrong side", he: "בחר את הצד הלא נכון" } },
    { id: "no_answer", label: { en: "Ran out of time", he: "נגמר הזמן" } },
  ],
  qualifyingInteraction: "The Tap to start button",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      time_limit_ms: {
        type: "integer",
        minimum: 0,
        maximum: 10000,
        default: 0,
        "x-ui": {
          label: { en: "Time per question (ms)", he: "זמן לכל שאלה (מ\"ש)" },
          help: { en: "0 = automatic, by level. Otherwise 2000–10000 ms.", he: "0 = אוטומטי, לפי שלב. אחרת 2000–10000 מ\"ש." },
          widget: "slider",
          step: 500,
        },
      },
      max_rotation: {
        type: "integer",
        minimum: 0,
        maximum: 180,
        default: 0,
        "x-ui": {
          label: { en: "Max rotation (°)", he: "סיבוב מרבי (°)" },
          help: { en: "0 = automatic, by level. Otherwise 0–180°.", he: "0 = אוטומטי, לפי שלב. אחרת 0–180°." },
          widget: "slider",
          step: 15,
        },
      },
      body_parts: {
        type: "string",
        enum: ["auto", "hand", "arm", "foot", "ear", "hand+arm", "hand+foot", "hand+ear", "arm+foot", "arm+ear", "foot+ear", "hand+arm+foot", "hand+arm+ear", "hand+foot+ear", "arm+foot+ear"],
        default: "auto",
        "x-ui": {
          label: { en: "Body parts", he: "חלקי גוף" },
          help: { en: "auto = by level and age.", he: "אוטומטי = לפי שלב וגיל." },
          widget: "select",
          options: {
            auto: { en: "Automatic", he: "אוטומטי" },
            hand: { en: "Hand", he: "יד" },
            arm: { en: "Arm", he: "זרוע" },
            foot: { en: "Foot", he: "כף רגל" },
            ear: { en: "Ear", he: "אוזן" },
            "hand+arm": { en: "Hand + Arm", he: "יד + זרוע" },
            "hand+foot": { en: "Hand + Foot", he: "יד + כף רגל" },
            "hand+ear": { en: "Hand + Ear", he: "יד + אוזן" },
          },
        },
      },
      bg_temperature: {
        type: "string",
        enum: ["auto", "warm", "cold"],
        default: "auto",
        "x-ui": {
          label: { en: "Background colours", he: "צבעי הרקע" },
          widget: "segmented",
          options: {
            auto: { en: "By side", he: "לפי הצד" },
            warm: { en: "Warm", he: "חמים" },
            cold: { en: "Cool", he: "קרים" },
          },
        },
      },
      background: {
        type: "string",
        enum: ["solid", "textured"],
        default: "solid",
        "x-ui": {
          label: { en: "Background", he: "רקע" },
          widget: "segmented",
          options: {
            solid: { en: "Plain", he: "אחיד" },
            textured: { en: "Patterned", he: "עם דוגמה" },
          },
        },
      },
      direction: {
        type: "string",
        enum: ["auto"],
        default: "auto",
        "x-ui": {
          label: { en: "Image entry direction", he: "כיוון כניסת התמונה" },
          widget: "select",
          options: {
            auto: { en: "Automatic", he: "אוטומטי" },
          },
        },
      },
    },
  },
  metrics: [
    { key: "accuracy", label: { en: "Correct answers", he: "תשובות נכונות" }, unit: "ratio", lowerIsBetter: false, skills: ["laterality"] },
    { key: "omission_rate", label: { en: "No answer", he: "בלי תשובה" }, unit: "ratio", lowerIsBetter: true, skills: ["laterality"] },
    { key: "wrong_rate", label: { en: "Wrong side", he: "צד שגוי" }, unit: "ratio", lowerIsBetter: true, skills: ["laterality"] },
    { key: "rt_correct_ms", label: { en: "Time to answer (correct)", he: "זמן תשובה (נכון)" }, unit: "ms", lowerIsBetter: true, skills: ["reaction_time"] },
    { key: "left_accuracy", label: { en: "Left accuracy", he: "דיוק שמאל" }, unit: "ratio", lowerIsBetter: false, skills: ["laterality"] },
    { key: "right_accuracy", label: { en: "Right accuracy", he: "דיוק ימין" }, unit: "ratio", lowerIsBetter: false, skills: ["laterality"] },
    { key: "hand_accuracy", label: { en: "Hand accuracy", he: "דיוק ידיים" }, unit: "ratio", lowerIsBetter: false, skills: ["laterality"] },
    { key: "rotation_effect_ms", label: { en: "Rotation effect", he: "השפעת סיבוב" }, unit: "ms", lowerIsBetter: true, skills: ["mental_rotation"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
    { key: "highest_level", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: {
    warm: "packs/warm/pack.json",
    cold: "packs/cold/pack.json",
    shared: "packs/shared/pack.json",
  },
  taxonomy: {
    skills: ["laterality", "mental_rotation", "reaction_time", "spatial_awareness"],
    regions: [],
  },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
