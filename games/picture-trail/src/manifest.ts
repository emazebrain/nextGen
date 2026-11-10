/** The SDK manifest for Picture Trail (spec 2026-11-10). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";

const DIRS = { en: { ltr: "Left to right", rtl: "Right to left", ttb: "Top to bottom", btt: "Bottom to top", tldbr: "Top left to bottom right", brdtl: "Bottom right to top left", trdbl: "Top right to bottom left", bldtr: "Bottom left to top right" },
  he: { ltr: "משמאל לימין", rtl: "מימין לשמאל", ttb: "מלמעלה למטה", btt: "מלמטה למעלה", tldbr: "משמאל למעלה לימין למטה", brdtl: "מימין למטה לשמאל למעלה", trdbl: "מימין למעלה לשמאל למטה", bldtr: "משמאל למטה לימין למעלה" } } as const;
type Dir = keyof typeof DIRS.en;

export const manifest: GameManifest = {
  id: "picture-trail",
  name: { en: "Picture Trail", he: "שביל התמונות" },
  summary: {
    en: "Pictures appear one by one along a line. Then find the one you saw before.",
    he: "תמונות מופיעות אחת אחרי השנייה לאורך קו. אחר כך מוצאים את זו שראיתם קודם.",
  },
  version: "1.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: 30,
  ageRange: [4, 16],
  minutes: 5,
  capabilities: { modes: ["timed", "lives", "timed_lives"], livesAuto: false, trialWindow: false, practice: true, rng: "seeded", monochrome: true },
  hemisphereNote: {
    left: { en: "Warm colours. Without a brain region, the pictures run from right to left.", he: "צבעים חמים. בלי אזור במוח, התמונות נעות מימין לשמאל." },
    right: { en: "Cool colours. Without a brain region, the pictures run from left to right.", he: "צבעים קרים. בלי אזור במוח, התמונות נעות משמאל לימין." },
  },
  // A brain-region filter sets the background from the table's row, and the line's direction and where most pictures go.
  regionUse: { background: { temperature: "bg_temperature", type: "background" }, direction: true, targetLocation: true },
  recommendedMode: "timed_lives",
  recommendedDurationS: 300,
  lifeLossEvents: [
    { id: "wrong_picture", label: { en: "Tapped a different picture", he: "הקשה על תמונה אחרת" } },
    { id: "missed_match", label: { en: "Let the picture go by", he: "התמונה עברה בלי הקשה" } },
  ],
  qualifyingInteraction: "The Tap to start button",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      direction: {
        type: "string",
        enum: ["auto", ...(Object.keys(DIRS.en) as Dir[])],
        default: "auto",
        "x-ui": {
          label: { en: "Direction of the line", he: "כיוון הקו" },
          help: { en: "Automatic follows the brain region, or the side when there is none.", he: "אוטומטי לפי האזור במוח, או לפי הצד כשאין אזור." },
          widget: "select",
          options: { auto: { en: "Automatic", he: "אוטומטי" }, ...Object.fromEntries((Object.keys(DIRS.en) as Dir[]).map((d) => [d, { en: DIRS.en[d], he: DIRS.he[d] }])) },
        },
      },
      bg_temperature: {
        type: "string",
        enum: ["auto", "warm", "cold"],
        default: "auto",
        "x-ui": { label: { en: "Background colours", he: "צבעי הרקע" }, widget: "segmented", options: { auto: { en: "By side", he: "לפי הצד" }, warm: { en: "Warm", he: "חמים" }, cold: { en: "Cool", he: "קרים" } } },
      },
      background: {
        type: "string",
        enum: ["solid", "textured"],
        default: "solid",
        "x-ui": { label: { en: "Background", he: "רקע" }, widget: "segmented", options: { solid: { en: "Plain", he: "אחיד" }, textured: { en: "Patterned", he: "עם דוגמה" } } },
      },
      lures: {
        type: "string",
        enum: ["auto", "on", "off"],
        default: "auto",
        "x-ui": {
          label: { en: "Look-alike pictures", he: "תמונות דומות" },
          help: { en: "Automatic: from difficulty 4, wrong answers look like the right one.", he: "אוטומטי: מרמת קושי 4, התשובות השגויות דומות לנכונה." },
          widget: "segmented",
          options: { auto: { en: "Automatic", he: "אוטומטי" }, on: { en: "On", he: "פועל" }, off: { en: "Off", he: "כבוי" } },
        },
      },
      show_ms: {
        type: "integer",
        minimum: 0,
        maximum: 2500,
        default: 0,
        "x-ui": {
          label: { en: "Time per picture (ms)", he: "זמן לכל תמונה (מ\"ש)" },
          help: { en: "0 = automatic, by age and level. Otherwise 500–2500 ms.", he: "0 = אוטומטי, לפי גיל ושלב. אחרת 500–2500 מ\"ש." },
          widget: "slider",
          step: 100,
        },
      },
    },
  },
  metrics: [
    { key: "accuracy", label: { en: "Found the picture", he: "מצא את התמונה" }, unit: "ratio", lowerIsBetter: false, skills: ["visual_memory"] },
    { key: "miss_rate", label: { en: "No tap at all", he: "בלי הקשה" }, unit: "ratio", lowerIsBetter: true, skills: ["visual_memory"] },
    { key: "wrong_tap_rate", label: { en: "Taps on other pictures", he: "הקשות על תמונות אחרות" }, unit: "ratio", lowerIsBetter: true, skills: ["inhibition"] },
    { key: "rt_correct_ms", label: { en: "Time to tap (found)", he: "זמן הקשה (נמצא)" }, unit: "ms", lowerIsBetter: true, skills: ["processing_speed"] },
    { key: "span", label: { en: "Most pictures remembered", he: "הכי הרבה תמונות שנזכרו" }, unit: "count", lowerIsBetter: false, skills: ["visual_memory"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
    { key: "highest_level", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["visual_memory", "inhibition", "processing_speed"], regions: [] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
