/** The SDK manifest: what the admin needs to list, configure and chart Orbital Order (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  id: "orbital-order",
  name: { en: "Orbital Order", he: "סדר מסלולים" },
  summary: {
    en: "Tap the planets in order, skipping the colour on the sign. The rule changes now and then.",
    he: "מקישים על הכוכבים לפי הסדר ומדלגים על הצבע שבשלט. הכלל מתחלף מדי פעם.",
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
    trialWindow: { minMs: 1000, maxMs: 30000, defaultMs: null },
    practice: true,
    rng: "seeded",
  },
  hemisphereNote: {
    left: {
      en: "Warm Sun Orchard. The first planets in each chain are placed mostly on the right of the screen.",
      he: "מטע שמש חמים. הכוכבים הראשונים בכל שרשרת ממוקמים בעיקר בצד ימין של המסך.",
    },
    right: {
      en: "Cold Star Ocean. The first planets in each chain are placed mostly on the left of the screen.",
      he: "אוקיינוס כוכבים קריר. הכוכבים הראשונים בכל שרשרת ממוקמים בעיקר בצד שמאל של המסך.",
    },
  },
  recommendedMode: "lives",
  recommendedDurationS: 300,
  lifeLossEvents: [
    { id: "wrong_tap", label: { en: "Wrong planet", he: "כוכב לא נכון" } },
    { id: "trial_timeout", label: { en: "Response window ran out", he: "זמן התגובה נגמר" } },
  ],
  qualifyingInteraction: "First tap in the probe block (after practice and the motor baseline)",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      glyph_type: {
        type: "string",
        enum: ["digits", "letters"],
        default: "digits",
        "x-ui": {
          label: { en: "Planets show", he: "על הכוכבים" },
          widget: "select",
          options: { digits: { en: "Numbers", he: "מספרים" }, letters: { en: "Letters (A–Z)", he: "אותיות (A–Z)" } },
        },
      },
      rule_visible: {
        type: "string",
        enum: ["on_request", "always"],
        default: "on_request",
        "x-ui": {
          label: { en: "Rule sign", he: "שלט הכלל" },
          help: {
            en: "On request: the sign hides after each reveal and the child can tap ? to see it again (counted).",
            he: "לפי בקשה: השלט נעלם אחרי כל הצגה והילד יכול להקיש ? כדי לראות אותו שוב (נספר).",
          },
          widget: "select",
          options: { on_request: { en: "Hide, show on request", he: "מוסתר, מוצג לפי בקשה" }, always: { en: "Always visible", he: "תמיד גלוי" } },
        },
      },
      motor_baseline: {
        type: "boolean",
        default: true,
        "x-ui": {
          label: { en: "Start with plain taps", he: "להתחיל בהקשות פשוטות" },
          help: { en: "Five unscored taps on a glowing planet, to measure tapping speed alone.", he: "חמש הקשות לא נספרות על כוכב זוהר, למדידת מהירות ההקשה בלבד." },
          widget: "switch",
        },
      },
      max_rule_trials: {
        type: "integer",
        minimum: 8,
        maximum: 60,
        default: 24,
        "x-ui": {
          label: { en: "Rule trials (lives mode)", he: "סבבי כלל (מצב לבבות)" },
          help: { en: "The session completes after this many rule trials. Timed modes have no cap.", he: "המפגש מסתיים אחרי מספר זה של סבבים. במצבים מתוזמנים אין הגבלה." },
          widget: "slider",
          step: 1,
        },
      },
      neon: {
        type: "boolean",
        default: false,
        "x-ui": {
          label: { en: "Night sky look", he: "מראה שמי לילה" },
          help: { en: "A dark background with glowing planets.", he: "רקע כהה עם כוכבים זוהרים." },
          widget: "switch",
        },
      },
    },
  },
  metrics: [
    { key: "chain_completion_rate", label: { en: "Chains finished", he: "שרשראות שהושלמו" }, unit: "ratio", lowerIsBetter: false, skills: ["sequencing"] },
    { key: "probe_accuracy", label: { en: "Probe block accuracy", he: "דיוק בבלוק הבדיקה" }, unit: "ratio", lowerIsBetter: false, skills: ["sequencing"] },
    { key: "max_chain", label: { en: "Longest run of correct taps", he: "רצף ההקשות הנכונות הארוך ביותר" }, unit: "count", lowerIsBetter: false, skills: ["sequencing"] },
    { key: "first_tap_latency_ms", label: { en: "Time to the first tap", he: "זמן עד ההקשה הראשונה" }, unit: "ms", lowerIsBetter: true, skills: ["planning"] },
    { key: "inter_tap_latency_ms", label: { en: "Time between taps", he: "זמן בין הקשות" }, unit: "ms", lowerIsBetter: true, skills: ["planning"] },
    { key: "planning_ratio", label: { en: "Planning vs doing", he: "תכנון מול ביצוע" }, unit: "index", lowerIsBetter: false, skills: ["planning"] },
    { key: "rule_switch_cost_ms", label: { en: "Slow-down after a rule change", he: "האטה אחרי החלפת כלל" }, unit: "ms", lowerIsBetter: true, skills: ["rule_switching"] },
    { key: "inhibition_index", label: { en: "Taps on the skip colour", he: "הקשות על צבע הדילוג" }, unit: "ratio", lowerIsBetter: true, skills: ["inhibition"] },
    { key: "baseline_tap_latency_ms", label: { en: "Plain tapping speed", he: "מהירות הקשה פשוטה" }, unit: "ms", lowerIsBetter: true },
    { key: "rule_recheck_rate", label: { en: "Rule rechecks per trial", he: "בדיקות חוזרות של הכלל לסבב" }, unit: "index", lowerIsBetter: true, skills: ["planning"] },
    { key: "fatigue_slope", label: { en: "Second half vs first half", he: "מחצית שנייה מול ראשונה" }, unit: "index", lowerIsBetter: false },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["sequencing", "planning", "rule_switching", "inhibition"], regions: ["BA9", "BA46", "BA24", "BA32", "BA40", "BA6"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
