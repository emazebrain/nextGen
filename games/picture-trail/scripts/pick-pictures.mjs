// Generates src/pictures.ts from a curated subset of Twemoji (graphics CC-BY 4.0, see NOTICE.md).
// Rules (spec 2026-11-10): no flags, faces, people, hand gestures, religious or national symbols, pork, alcohol or
// weapons. Each picture has a category and the youngest age band it suits; older bands include younger pictures.
// Run: node scripts/pick-pictures.mjs   (needs the @twemoji/svg dev dependency)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const dir = require.resolve("@twemoji/svg/package.json").replace(/package\.json$/, "");

/** [id, codepoint, category, band] */
const LIST = [
  // 4-6: simple and familiar
  ["dog", "1f436", "animal", "4-6"], ["cat", "1f431", "animal", "4-6"], ["mouse", "1f42d", "animal", "4-6"], ["rabbit", "1f430", "animal", "4-6"],
  ["bear", "1f43b", "animal", "4-6"], ["panda", "1f43c", "animal", "4-6"], ["koala", "1f428", "animal", "4-6"], ["tiger", "1f42f", "animal", "4-6"],
  ["lion", "1f981", "animal", "4-6"], ["cow", "1f42e", "animal", "4-6"], ["frog", "1f438", "animal", "4-6"], ["monkey", "1f435", "animal", "4-6"],
  ["chicken", "1f414", "animal", "4-6"], ["penguin", "1f427", "animal", "4-6"], ["owl", "1f989", "animal", "4-6"], ["horse", "1f434", "animal", "4-6"],
  ["bee", "1f41d", "animal", "4-6"], ["butterfly", "1f98b", "animal", "4-6"], ["snail", "1f40c", "animal", "4-6"], ["ladybug", "1f41e", "animal", "4-6"],
  ["turtle", "1f422", "animal", "4-6"], ["fish", "1f41f", "animal", "4-6"], ["whale", "1f433", "animal", "4-6"], ["elephant", "1f418", "animal", "4-6"],
  ["apple", "1f34e", "food", "4-6"], ["banana", "1f34c", "food", "4-6"], ["grapes", "1f347", "food", "4-6"], ["strawberry", "1f353", "food", "4-6"],
  ["watermelon", "1f349", "food", "4-6"], ["orange", "1f34a", "food", "4-6"], ["cherries", "1f352", "food", "4-6"], ["carrot", "1f955", "food", "4-6"],
  ["ball", "26bd", "toy", "4-6"], ["balloon", "1f388", "toy", "4-6"], ["teddy", "1f9f8", "toy", "4-6"], ["kite", "1fa81", "toy", "4-6"], ["gift", "1f381", "toy", "4-6"],
  ["car", "1f697", "vehicle", "4-6"], ["bus", "1f68c", "vehicle", "4-6"], ["bike", "1f6b2", "vehicle", "4-6"], ["train", "1f682", "vehicle", "4-6"],
  ["airplane", "2708", "vehicle", "4-6"], ["sailboat", "26f5", "vehicle", "4-6"], ["rocket", "1f680", "vehicle", "4-6"],
  ["sun", "2600", "nature", "4-6"], ["star", "2b50", "nature", "4-6"], ["moon", "1f319", "nature", "4-6"], ["flower", "1f33c", "nature", "4-6"],
  ["tree", "1f333", "nature", "4-6"], ["rainbow", "1f308", "nature", "4-6"],
  // 7-9
  ["basketball", "1f3c0", "sport", "7-9"], ["football", "1f3c8", "sport", "7-9"], ["tennis", "1f3be", "sport", "7-9"], ["baseball", "26be", "sport", "7-9"],
  ["volleyball", "1f3d0", "sport", "7-9"], ["bowling", "1f3b3", "sport", "7-9"], ["skate", "26f8", "sport", "7-9"], ["trophy", "1f3c6", "sport", "7-9"],
  ["fire_engine", "1f692", "vehicle", "7-9"], ["ambulance", "1f691", "vehicle", "7-9"], ["police_car", "1f693", "vehicle", "7-9"], ["tractor", "1f69c", "vehicle", "7-9"],
  ["helicopter", "1f681", "vehicle", "7-9"], ["scooter", "1f6f4", "vehicle", "7-9"],
  ["pizza", "1f355", "food", "7-9"], ["cheese", "1f9c0", "food", "7-9"], ["bread", "1f35e", "food", "7-9"], ["cake", "1f370", "food", "7-9"],
  ["ice_cream", "1f366", "food", "7-9"], ["cookie", "1f36a", "food", "7-9"], ["popcorn", "1f37f", "food", "7-9"], ["lemon", "1f34b", "food", "7-9"],
  ["pineapple", "1f34d", "food", "7-9"], ["broccoli", "1f966", "food", "7-9"],
  ["crab", "1f980", "animal", "7-9"], ["shark", "1f988", "animal", "7-9"], ["kangaroo", "1f998", "animal", "7-9"], ["zebra", "1f993", "animal", "7-9"],
  ["hedgehog", "1f994", "animal", "7-9"], ["octopus", "1f419", "animal", "7-9"], ["dolphin", "1f42c", "animal", "7-9"], ["giraffe", "1f992", "animal", "7-9"],
  // 10-12
  ["guitar", "1f3b8", "music", "10-12"], ["violin", "1f3bb", "music", "10-12"], ["drum", "1f941", "music", "10-12"], ["trumpet", "1f3ba", "music", "10-12"],
  ["piano", "1f3b9", "music", "10-12"], ["saxophone", "1f3b7", "music", "10-12"],
  ["hammer", "1f528", "tool", "10-12"], ["wrench", "1f527", "tool", "10-12"], ["screwdriver", "1fa9b", "tool", "10-12"], ["saw", "1fa9a", "tool", "10-12"],
  ["magnet", "1f9f2", "tool", "10-12"], ["scissors", "2702", "tool", "10-12"],
  ["umbrella", "2602", "object", "10-12"], ["key", "1f511", "object", "10-12"], ["lock", "1f512", "object", "10-12"], ["lightbulb", "1f4a1", "object", "10-12"],
  ["alarm_clock", "23f0", "object", "10-12"], ["camera", "1f4f7", "object", "10-12"], ["telescope", "1f52d", "object", "10-12"], ["microscope", "1f52c", "object", "10-12"],
  ["books", "1f4da", "object", "10-12"], ["compass", "1f9ed", "object", "10-12"], ["hourglass", "231b", "object", "10-12"],
  ["house", "1f3e0", "place", "10-12"], ["castle", "1f3f0", "place", "10-12"], ["tent", "26fa", "place", "10-12"], ["mountain", "1f3d4", "place", "10-12"],
  ["volcano", "1f30b", "place", "10-12"], ["ferris_wheel", "1f3a1", "place", "10-12"],
  // 13+
  ["satellite", "1f6f0", "object", "13+"], ["test_tube", "1f9ea", "object", "13+"], ["dna", "1f9ec", "object", "13+"], ["abacus", "1f9ee", "object", "13+"],
  ["puzzle", "1f9e9", "toy", "13+"], ["dice", "1f3b2", "toy", "13+"], ["joystick", "1f579", "toy", "13+"], ["laptop", "1f4bb", "object", "13+"],
  ["keyboard", "2328", "object", "13+"], ["battery", "1f50b", "object", "13+"], ["plug", "1f50c", "object", "13+"], ["gear", "2699", "tool", "13+"],
  ["anchor", "2693", "object", "13+"], ["magnifier", "1f50d", "tool", "13+"], ["map", "1f5fa", "object", "13+"], ["bricks", "1f9f1", "tool", "13+"],
  ["ladder", "1fa9c", "tool", "13+"], ["bucket", "1faa3", "tool", "13+"], ["broom", "1f9f9", "tool", "13+"], ["yarn", "1f9f6", "object", "13+"],
  ["backpack", "1f392", "object", "13+"], ["crown", "1f451", "object", "13+"], ["gem", "1f48e", "object", "13+"], ["mushroom", "1f344", "nature", "13+"],
  ["cactus", "1f335", "nature", "13+"], ["leaf", "1f343", "nature", "13+"], ["snowflake", "2744", "nature", "13+"], ["lightning", "26a1", "nature", "13+"],
  ["fire", "1f525", "nature", "13+"], ["droplet", "1f4a7", "nature", "13+"],
];

const rows = LIST.map(([id, cp, category, band]) => {
  const svg = readFileSync(`${dir}${cp}.svg`, "utf8").trim();
  if (!svg.startsWith("<svg")) throw new Error(`${id}: not an svg`);
  return `  { id: ${JSON.stringify(id)}, category: ${JSON.stringify(category)}, band: ${JSON.stringify(band)}, svg: ${JSON.stringify(svg)} },`;
});
writeFileSync(
  new URL("../src/pictures.ts", import.meta.url),
  `/**
 * Picture Trail's pictures (spec 2026-11-10): a curated Twemoji subset, generated by scripts/pick-pictures.mjs.
 * Graphics © Twitter, Inc. and other contributors, CC-BY 4.0 (https://creativecommons.org/licenses/by/4.0/); see NOTICE.md.
 * A placeholder set until commissioned art arrives. Do not edit by hand.
 */
export type PictureBand = "4-6" | "7-9" | "10-12" | "13+";
export type Category = "animal" | "food" | "toy" | "vehicle" | "nature" | "sport" | "music" | "tool" | "object" | "place";
export interface Picture { id: string; category: Category; band: PictureBand; svg: string }

export const PICTURES: Picture[] = [
${rows.join("\n")}
];
`,
);
console.log(`${rows.length} pictures`);
