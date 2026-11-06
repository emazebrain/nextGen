/** The SDK manifest: what the admin needs to list, configure and chart Echo Keys (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  id: "echo-keys",
  name: { en: "Echo Keys", he: "מקשי הד" },
  summary: {
    en: "Tap each piano key just as its note arrives. With go/no-go on, leave the spiky balls alone.",
    he: "מקישים על כל קליד בדיוק כשהצליל מגיע. כשעצור-סע פעיל, לא נוגעים בכדורים הדוקרניים.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: 5,
  ageRange: [5, 14],
  minutes: 5,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    trialWindow: false,
    practice: true,
    rng: "seeded",
  },
  hemisphereNote: {
    left: {
      en: "Warm Sunset Stage. With go/no-go on, most spiky balls fall on the right half of the keyboard.",
      he: "במה בשקיעה חמימה. כשעצור-סע פעיל, רוב הכדורים הדוקרניים נופלים בחצי הימני של המקלדת.",
    },
    right: {
      en: "Cold Moonlight Lake. With go/no-go on, most spiky balls fall on the left half of the keyboard.",
      he: "אגם באור ירח קריר. כשעצור-סע פעיל, רוב הכדורים הדוקרניים נופלים בחצי השמאלי של המקלדת.",
    },
  },
  recommendedMode: "timed",
  recommendedDurationS: 300,
  lifeLossEvents: [
    { id: "phrase_failed", label: { en: "A phrase with 3 or more errors", he: "קטע עם 3 שגיאות או יותר" } },
    { id: "nogo_pressed", label: { en: "Pressed a spiky ball", he: "לחיצה על כדור דוקרני" } },
  ],
  qualifyingInteraction: "First key press",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      go_no_go: {
        type: "boolean",
        default: false,
        "x-ui": {
          label: { en: "Go/no-go balls", he: "כדורי עצור-סע" },
          help: { en: "Spiky balls fall between the notes; the child must not press them.", he: "כדורים דוקרניים נופלים בין הצלילים; אסור ללחוץ עליהם." },
          widget: "switch",
        },
      },
      key_count: {
        type: "integer",
        enum: [0, 5, 8, 13],
        default: 0,
        "x-ui": {
          label: { en: "Keys", he: "קלידים" },
          widget: "segmented",
          options: { "0": { en: "By difficulty", he: "לפי הקושי" }, "5": { en: "5", he: "5" }, "8": { en: "8", he: "8" }, "13": { en: "13", he: "13" } },
        },
      },
    },
  },
  metrics: [
    { key: "accuracy", label: { en: "Notes hit", he: "צלילים שנקלעו" }, unit: "ratio", lowerIsBetter: false, skills: ["sustained_attention", "auditory_motor"] },
    { key: "timing_error_ms_abs_mean", label: { en: "Timing off by", he: "סטייה בתזמון" }, unit: "ms", lowerIsBetter: true, skills: ["auditory_motor"] },
    { key: "timing_error_ms_mean", label: { en: "Early (−) or late (+)", he: "מוקדם (−) או מאוחר (+)" }, unit: "ms", lowerIsBetter: false, skills: ["auditory_motor"] },
    { key: "response_ms_median", label: { en: "Response time", he: "זמן תגובה" }, unit: "ms", lowerIsBetter: true, skills: ["auditory_motor"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false, skills: ["sustained_attention"] },
    { key: "d_prime", label: { en: "Go/no-go sensitivity (d′)", he: "רגישות עצור-סע (d′)" }, unit: "index", lowerIsBetter: false, skills: ["inhibition"] },
    { key: "false_alarm_rate", label: { en: "Spiky balls pressed", he: "כדורים דוקרניים שנלחצו" }, unit: "ratio", lowerIsBetter: true, skills: ["inhibition"] },
    { key: "phrases_failed", label: { en: "Phrases to try again", he: "קטעים לניסיון חוזר" }, unit: "count", lowerIsBetter: true, skills: ["sequencing"] },
    { key: "melodies_completed", label: { en: "Songs finished", he: "שירים שהושלמו" }, unit: "count", lowerIsBetter: false, skills: ["sequencing"] },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["sustained_attention", "auditory_motor", "sequencing", "inhibition"], regions: ["BA41", "BA42", "BA22", "BA6", "BA44", "BA45", "BA47"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
