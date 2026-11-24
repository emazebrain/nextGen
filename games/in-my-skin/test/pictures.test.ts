import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { drawnSvg } from "../src/drawn.ts";
import { FLAT_SVG } from "../src/flat.generated.ts";
import { CATEGORIES, CATEGORY_HEMISPHERE, PICTURES, PictureBag, poolFor } from "../src/pictures.ts";

const seeded = (seed: number) => () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);

describe("pictures", () => {
  it("puts each category on the hemisphere the product owner gave it", () => {
    expect(CATEGORY_HEMISPHERE).toEqual({
      flat_objects: "left", objects_3d: "right", cartoon_faces: "left", letters: "left", numbers: "left", operations: "left",
      shapes: "right", cartoons: "left", sports: "right", road_signs: "right", arrows: "right", everyday: "left",
    });
  });

  it("has unique ids and at least five pictures in every category", () => {
    expect(new Set(PICTURES.map((p) => p.id)).size).toBe(PICTURES.length);
    for (const c of CATEGORIES) expect(PICTURES.filter((p) => p.category === c).length, c).toBeGreaterThanOrEqual(5);
  });

  it("has artwork for every picture", () => {
    for (const p of PICTURES) {
      if (p.source === "file") expect(existsSync(fileURLToPath(new URL(`../assets/${p.id}.webp`, import.meta.url))), p.id).toBe(true);
      else if (p.source === "flat") expect(FLAT_SVG[p.id], p.id).toContain("<svg");
      else expect(drawnSvg(p.id), p.id).toContain("<svg");
    }
    expect(drawnSvg("nothing")).toBeNull();
  });

  it("never mirrors letters, numbers, signs or arrows", () => {
    for (const p of PICTURES) if (["letters", "numbers", "operations", "road_signs", "arrows"].includes(p.category)) expect(p.faces, p.id).toBeNull();
  });

  it("draws from the hemisphere's categories by default", () => {
    const left = new Set(poolFor("left", "en", null).map((p) => p.category));
    expect([...left].sort()).toEqual(["cartoon_faces", "cartoons", "everyday", "flat_objects", "letters", "numbers", "operations"]);
    const right = new Set(poolFor("right", "en", null).map((p) => p.category));
    expect([...right].sort()).toEqual(["arrows", "objects_3d", "road_signs", "shapes", "sports"]);
  });

  it("narrows to one category when the therapist chooses it, whatever the hemisphere", () => {
    expect(new Set(poolFor("right", "en", "numbers").map((p) => p.category))).toEqual(new Set(["numbers"]));
  });

  it("shows letters in the patient's language", () => {
    const he = poolFor("left", "he", "letters");
    const en = poolFor("left", "en", "letters");
    expect(he.every((p) => p.script === "hebrew")).toBe(true);
    expect(he.map((p) => p.id)).toContain("letter-he-alef");
    expect(en.map((p) => p.id)).toContain("letter-en-q");
    expect(en.every((p) => p.script === "latin")).toBe(true);
    expect(poolFor("left", "ru", "letters").every((p) => p.script === "latin")).toBe(true);
    expect(he.length).toBe(22);
    expect(en.length).toBe(26);
  });

  it("shows every picture once before any repeats, and never the same one twice in a row", () => {
    const pool = poolFor("right", "en", "sports");
    const bag = new PictureBag(pool, seeded(7));
    const first = Array.from({ length: pool.length }, () => bag.next().id);
    expect(new Set(first).size).toBe(pool.length);
    let last = first[first.length - 1];
    for (let i = 0; i < 200; i++) {
      const id = bag.next().id;
      expect(id).not.toBe(last);
      last = id;
    }
  });
});
