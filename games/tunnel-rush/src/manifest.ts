/** The SDK manifest: what the admin needs to list, configure and chart Tunnel Rush (design doc §8.3–8.4). No renderer imports here. */
import type { GameManifest } from "@emb/game-sdk";
import { LIFE_LOSS_GRACE_MS, MAX_LEVEL } from "./config.ts";

export const manifest: GameManifest = {
  id: "tunnel-rush",
  name: { en: "Tunnel Rush", he: "מרוץ המנהרה" },
  summary: {
    en: "Steer a rolling tunnel so the floating objects miss your ship.",
    he: "מסובבים את המנהרה כדי שהעצמים המרחפים יחמיצו את החללית.",
  },
  version: "2.0.0",
  sdkVersion: "^2.0.0",
  entry: "index.js",
  renderer: "pixi",
  orientation: ["landscape", "portrait"],
  inputs: ["touch", "mouse", "keyboard"],
  maxLevel: MAX_LEVEL,
  ageRange: [5, 14],
  minutes: 2,
  capabilities: {
    modes: ["timed", "lives", "timed_lives"],
    livesAuto: false,
    trialWindow: false,
    practice: true,
    rng: "seeded",
    lifeLossGraceMs: LIFE_LOSS_GRACE_MS,
  },
  hemisphereNote: {
    left: {
      en: "Warm Volcano Run. Most objects appear on the ship's right.",
      he: "מרוץ הר הגעש החמים. רוב העצמים מופיעים מימין לחללית.",
    },
    right: {
      en: "Cold Ice Comet Run. Most objects appear on the ship's left.",
      he: "מרוץ שביט הקרח הקר. רוב העצמים מופיעים משמאל לחללית.",
    },
  },
  recommendedMode: "timed",
  recommendedDurationS: 120,
  lifeLossEvents: [{ id: "collision", label: { en: "Ran into an object", he: "התנגשות בעצם" } }],
  qualifyingInteraction: "First steer (arrow, key or swipe)",
  paramsSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      lanes: {
        type: "integer",
        enum: [6, 8, 10, 12],
        default: 8,
        "x-ui": { label: { en: "Lanes", he: "מסלולים" }, help: { en: "More lanes, smaller steps.", he: "יותר מסלולים, צעדים קטנים יותר." }, widget: "segmented" },
      },
      ship_mode: {
        type: "string",
        enum: ["fixed", "move"],
        default: "fixed",
        "x-ui": {
          label: { en: "Steering", he: "היגוי" },
          widget: "select",
          options: { fixed: { en: "The tunnel rolls around the ship", he: "המנהרה מסתובבת סביב החללית" }, move: { en: "The ship slides around the tunnel", he: "החללית נעה סביב המנהרה" } },
        },
      },
      object_type: {
        type: "string",
        enum: ["shapes", "letters", "numbers", "cartoon_faces", "real_faces", "mixed"],
        default: "shapes",
        "x-ui": {
          label: { en: "Objects", he: "עצמים" },
          widget: "select",
          options: {
            shapes: { en: "Shapes", he: "צורות" },
            letters: { en: "Letters", he: "אותיות" },
            numbers: { en: "Numbers", he: "מספרים" },
            cartoon_faces: { en: "Cartoon faces", he: "פרצופים מצוירים" },
            real_faces: { en: "Lifelike faces (drawn)", he: "פרצופים מציאותיים (מצוירים)" },
            mixed: { en: "Mixed", he: "מעורב" },
          },
        },
      },
      object_orientation: {
        type: "string",
        enum: ["upright", "wall"],
        default: "upright",
        "x-ui": {
          label: { en: "Object direction", he: "כיוון העצמים" },
          widget: "select",
          options: { upright: { en: "Always upright", he: "תמיד זקופים" }, wall: { en: "Lying along the wall", he: "לאורך הקיר" } },
        },
      },
      rotation: {
        type: "string",
        enum: ["none", "cw", "ccw", "alternate"],
        default: "none",
        "x-ui": {
          label: { en: "Tunnel spin", he: "סיבוב המנהרה" },
          help: { en: "The tunnel turns on its own; the child corrects for it.", he: "המנהרה מסתובבת מעצמה והילד מתקן." },
          widget: "select",
          options: { none: { en: "None", he: "ללא" }, cw: { en: "Clockwise", he: "עם כיוון השעון" }, ccw: { en: "Anticlockwise", he: "נגד כיוון השעון" }, alternate: { en: "Changes every 6 s", he: "מתחלף כל 6 שניות" } },
        },
      },
      spin_speed: {
        type: "integer",
        minimum: 0,
        maximum: 60,
        default: 14,
        "x-ui": { label: { en: "Spin speed (°/s)", he: "מהירות סיבוב (°/ש׳)" }, widget: "slider", step: 2 },
      },
      progressive: {
        type: "boolean",
        default: true,
        "x-ui": { label: { en: "Level up as you go", he: "עולים שלב תוך כדי" }, help: { en: "One level every 8 objects, up to 10.", he: "שלב אחד כל 8 עצמים, עד 10." }, widget: "switch" },
      },
    },
  },
  metrics: [
    { key: "hit_rate", label: { en: "Bumps per object", he: "התנגשויות לעצם" }, unit: "ratio", lowerIsBetter: true, skills: ["sustained_attention", "visuomotor"] },
    { key: "accuracy", label: { en: "Objects dodged", he: "עצמים שנמנעו" }, unit: "ratio", lowerIsBetter: false, skills: ["sustained_attention"] },
    { key: "median_reaction_ms", label: { en: "Reaction time", he: "זמן תגובה" }, unit: "ms", lowerIsBetter: true, skills: ["reaction_time"] },
    { key: "threat_dodge_rate", label: { en: "Dodged when in the way", he: "התחמקות כשהעצם בדרך" }, unit: "ratio", lowerIsBetter: false, skills: ["visuomotor"] },
    { key: "no_move_rate", label: { en: "Objects with no steering", he: "עצמים בלי היגוי" }, unit: "ratio", lowerIsBetter: true, skills: ["sustained_attention"] },
    { key: "side_hit_asymmetry", label: { en: "Bumps right vs left", he: "התנגשויות ימין מול שמאל" }, unit: "index", lowerIsBetter: false, skills: ["visuospatial_attention"] },
    { key: "avg_speed", label: { en: "Average speed", he: "מהירות ממוצעת" }, unit: "index", lowerIsBetter: false },
    { key: "obstacles", label: { en: "Objects passed", he: "עצמים שעברו" }, unit: "count", lowerIsBetter: false },
    { key: "best_streak", label: { en: "Best streak", he: "רצף הצלחות" }, unit: "count", lowerIsBetter: false },
    { key: "level_reached", label: { en: "Highest level", he: "השלב הגבוה ביותר" }, unit: "count", lowerIsBetter: false },
  ],
  assetPacks: { warm: "packs/warm/pack.json", cold: "packs/cold/pack.json", shared: "packs/shared/pack.json" },
  taxonomy: { skills: ["sustained_attention", "reaction_time", "visuomotor", "visuospatial_attention"], regions: ["BA7", "BA8", "BA24", "cerebellum"] },
  sizeBytes: { core: 0, warm: 0, cold: 0 },
};
