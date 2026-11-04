/** The SDK manifest: what the admin needs to list, configure and chart Peek Peek (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  id: "peek-peek",
  name: { en: "Peek Peek", he: "פיק פיק" },
  summary: {
    en: "Look at the pictures, remember where they hide, then find every copy.",
    he: "מסתכלים על התמונות, זוכרים איפה הן מתחבאות, ומוצאים את כל העותקים.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: 50,
  ageRange: [4, 14],
  minutes: 6,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: true,
    trialWindow: false,
    practice: true,
    rng: "seeded",
  },
  hemisphereNote: {
    left: {
      en: "Warm garden pots. The first pictures the child looks for are placed mostly on the right of the board.",
      he: "עציצים בגינה חמימה. התמונות הראשונות שהילד מחפש ממוקמות בעיקר בצד ימין של הלוח.",
    },
    right: {
      en: "Cold sea shells. The first pictures the child looks for are placed mostly on the left of the board.",
      he: "צדפים בים קריר. התמונות הראשונות שהילד מחפש ממוקמות בעיקר בצד שמאל של הלוח.",
    },
  },
  recommendedMode: "timed_lives",
  recommendedDurationS: 360,
  lifeLossEvents: [{ id: "wrong_tile", label: { en: "Wrong tile", he: "משבצת לא נכונה" } }],
  qualifyingInteraction: "First tile tap after the first study phase",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      pack: {
        type: "string",
        enum: ["marine", "animals", "household", "faces", "rotate"],
        default: "marine",
        "x-ui": {
          label: { en: "Pictures", he: "תמונות" },
          help: { en: "Mixed changes the pictures from board to board.", he: "מעורב מחליף את סוג התמונות בכל לוח." },
          widget: "select",
          options: {
            marine: { en: "Sea creatures", he: "חיות ים" },
            animals: { en: "Animals", he: "בעלי חיים" },
            household: { en: "Things at home", he: "חפצים בבית" },
            faces: { en: "Faces", he: "פרצופים" },
            rotate: { en: "Mixed", he: "מעורב" },
          },
        },
      },
      control_trials: {
        type: "boolean",
        default: true,
        "x-ui": {
          label: { en: "Start with an open board", he: "להתחיל בלוח פתוח" },
          help: {
            en: "One board stays face up before the memory boards, to measure searching without memory.",
            he: "לוח אחד נשאר פתוח לפני לוחות הזיכרון, כדי למדוד חיפוש בלי זיכרון.",
          },
          widget: "switch",
        },
      },
      hidden_count: {
        type: "boolean",
        default: false,
        "x-ui": {
          label: { en: "Hide how many copies are left", he: "להסתיר כמה עותקים נשארו" },
          help: { en: "The child keeps searching without a count.", he: "הילד ממשיך לחפש בלי מונה." },
          widget: "switch",
        },
      },
      study_time_s: {
        type: "integer",
        minimum: 0,
        maximum: 20,
        default: 0,
        "x-ui": {
          label: { en: "Time to look (seconds)", he: "זמן הסתכלות (שניות)" },
          help: { en: "0 = automatic: longer for bigger boards (3–9.5 s).", he: "0 = אוטומטי: יותר זמן ללוחות גדולים (3–9.5 שניות)." },
          widget: "slider",
          step: 1,
        },
      },
    },
  },
  metrics: [
    { key: "first_attempt_accuracy_ex_final", label: { en: "Found on the first try", he: "נמצא בניסיון הראשון" }, unit: "ratio", lowerIsBetter: false, skills: ["visuospatial_wm"] },
    { key: "first_round_misses_mean", label: { en: "Misses on the first picture", he: "החטאות בתמונה הראשונה" }, unit: "count", lowerIsBetter: true, skills: ["visuospatial_wm"] },
    { key: "capacity_estimate", label: { en: "Highest level with at most one miss", he: "השלב הגבוה ביותר עם החטאה אחת לכל היותר" }, unit: "count", lowerIsBetter: false, skills: ["visuospatial_wm"] },
    { key: "learning_slope", label: { en: "Learning across a board", he: "למידה לאורך הלוח" }, unit: "index", lowerIsBetter: true, skills: ["visuospatial_wm"] },
    { key: "perseveration_rate", label: { en: "Repeated wrong tiles", he: "חזרה על משבצות שגויות" }, unit: "ratio", lowerIsBetter: true, skills: ["search_organisation"] },
    { key: "search_organisation", label: { en: "Search organisation", he: "ארגון החיפוש" }, unit: "ratio", lowerIsBetter: false, skills: ["search_organisation"] },
    { key: "adjacency_ratio", label: { en: "Taps next to the last tap", he: "הקשות סמוכות" }, unit: "ratio", lowerIsBetter: false, skills: ["search_organisation"] },
    { key: "perseveration_asymmetry", label: { en: "Repeats left vs right", he: "חזרות שמאל מול ימין" }, unit: "index", lowerIsBetter: false, skills: ["visuospatial_attention"] },
    { key: "find_order_index", label: { en: "Side found first", he: "הצד שנמצא קודם" }, unit: "index", lowerIsBetter: false, skills: ["visuospatial_attention"] },
    { key: "control_find_order_index", label: { en: "Side found first (open board)", he: "הצד שנמצא קודם (לוח פתוח)" }, unit: "index", lowerIsBetter: false, skills: ["visuospatial_attention"] },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
    { key: "highest_level", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["visuospatial_wm", "search_organisation", "visuospatial_attention"], regions: ["BA28", "BA35", "BA36", "BA7", "BA46"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
