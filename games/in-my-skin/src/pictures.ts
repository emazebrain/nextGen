/**
 * The pictures of In My Skin and the hemisphere each category is used for (product owner, 2026-11-23).
 * Cartoons are the product owner's pictures and the other 3D-style pictures are placeholders, all files in ../assets; flat ones are inline SVG (flat.generated.ts); the rest are drawn in code.
 * Real-life faces and real-life photographs are not here yet: they need licensed photographs.
 */
import type { Locale } from "@emb/game-sdk";
import { ARROW_IDS, DIGITS, HEBREW, LATIN, OPERATIONS, SHAPE_IDS, SIGN_IDS } from "./drawn.ts";

export const CATEGORIES = ["flat_objects", "objects_3d", "cartoon_faces", "letters", "numbers", "operations", "shapes", "cartoons", "sports", "road_signs", "arrows", "everyday"] as const;
export type Category = (typeof CATEGORIES)[number];
export type Hemisphere = "left" | "right";

export const CATEGORY_HEMISPHERE: Record<Category, Hemisphere> = {
  flat_objects: "left",
  objects_3d: "right",
  cartoon_faces: "left",
  letters: "left",
  numbers: "left",
  operations: "left",
  shapes: "right",
  cartoons: "left",
  sports: "right",
  road_signs: "right",
  arrows: "right",
  everyday: "left",
};

export interface Picture {
  id: string;
  category: Category;
  /** Which way the picture looks as drawn; it is mirrored to face its travel. Null = never mirrored. */
  faces: "left" | "right" | null;
  source: "file" | "flat" | "drawn";
  /** Letters only: the alphabet it belongs to. */
  script?: "latin" | "hebrew";
}

const files = (category: Category, faces: Picture["faces"], ids: string[]): Picture[] => ids.map((id) => ({ id, category, faces, source: "file" }));
const drawn = (category: Category, ids: string[]): Picture[] => ids.map((id) => ({ id, category, faces: null, source: "drawn" }));

export const PICTURES: Picture[] = [
  ...["guitar", "trophy", "crown", "gem", "compass", "telescope", "microscope", "camera", "hourglass", "anchor", "magnet", "globe"].map(
    (id): Picture => ({ id, category: "flat_objects", faces: null, source: "flat" }),
  ),
  ...files("objects_3d", "left", ["helicopter", "racing-car", "locomotive", "tractor", "fire-engine", "motorcycle"]),
  ...files("objects_3d", "right", ["rocket", "airplane"]),
  ...files("objects_3d", null, ["flying-saucer", "sailboat", "bus", "speedboat"]),
  ...files("cartoon_faces", null, ["lion-face", "tiger-face", "robot-face", "alien-face", "fox-face", "dragon-face", "frog-face", "bear-face"]),
  ...LATIN.map((ch): Picture => ({ id: `letter-${ch}`, category: "letters", faces: null, source: "drawn", script: "latin" })),
  ...HEBREW.map((ch): Picture => ({ id: `letter-${ch}`, category: "letters", faces: null, source: "drawn", script: "hebrew" })),
  ...drawn("numbers", DIGITS.map((d) => `number-${d}`)),
  ...drawn("operations", Object.keys(OPERATIONS).map((k) => `op-${k}`)),
  ...drawn("shapes", SHAPE_IDS.map((s) => `shape-${s}`)),
  // Supplied by the product owner (2026-11-23); see NOTICE.md.
  ...files("cartoons", null, ["monster-pink", "monster-green-torch", "monster-blue", "troll-blue-hair", "troll-walking", "troll-bicycle", "giraffe-laughing", "dog-pink", "gorilla-rocker", "chicken-hero", "koala-skateboard", "groovy-dancer", "troll-green-hair"]),
  ...files("cartoons", "right", ["monster-orange", "dog-tongue", "boy-elephant-skateboard", "elephant-skateboard"]),
  ...files("cartoons", "left", ["boy-balloons", "dinosaur-pink", "dinosaur-green"]),
  ...files("sports", null, ["soccer-ball", "basketball", "tennis", "boxing-glove", "ping-pong", "curling-stone", "softball", "dartboard", "flying-disc", "ice-hockey", "badminton", "roller-skate"]),
  ...drawn("road_signs", SIGN_IDS),
  ...drawn("arrows", ARROW_IDS),
  ...files("everyday", null, ["key", "glasses", "backpack", "watch", "light-bulb", "book", "umbrella", "alarm-clock", "scissors", "purse", "teapot", "pencil"]),
];

/**
 * The pictures a session draws from: the chosen category, or every category that belongs to the hemisphere.
 * Letters follow the patient's language: Hebrew letters in Hebrew, Latin letters otherwise.
 */
export function poolFor(hemisphere: Hemisphere, lang: Locale | string, category: Category | null): Picture[] {
  const script = lang === "he" ? "hebrew" : "latin";
  return PICTURES.filter((p) => (category ? p.category === category : CATEGORY_HEMISPHERE[p.category] === hemisphere) && (!p.script || p.script === script));
}

/** Hands out pictures in a shuffled order and reshuffles when all have been shown, never repeating back to back. */
export class PictureBag {
  private queue: Picture[] = [];
  private last: Picture | null = null;
  constructor(
    private readonly pool: Picture[],
    private readonly rng: () => number,
  ) {
    if (pool.length === 0) throw new Error("no pictures");
  }
  next(): Picture {
    if (this.queue.length === 0) {
      this.queue = [...this.pool];
      for (let i = this.queue.length - 1; i > 0; i--) {
        const j = Math.floor(this.rng() * (i + 1));
        [this.queue[i], this.queue[j]] = [this.queue[j]!, this.queue[i]!];
      }
      if (this.queue.length > 1 && this.queue[this.queue.length - 1] === this.last) this.queue.reverse();
    }
    this.last = this.queue.pop()!;
    return this.last;
  }
}
