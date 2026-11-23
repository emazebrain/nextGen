import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.ts";
import { MOVEMENT_TYPES } from "../src/motion.ts";
import { CATEGORIES } from "../src/pictures.ts";
import { strings } from "../src/strings.ts";

describe("manifest", () => {
  it("has the spec's id, levels and modes", () => {
    expect(manifest.id).toBe("in-my-skin");
    expect(manifest.maxLevel).toBe(30);
    expect(manifest.capabilities.modes).toEqual(["timed", "lives", "timed_lives"]);
  });

  it("reads background, direction, target location and movement from the brain region", () => {
    expect(manifest.regionUse).toEqual({ background: { temperature: "bg_temperature", type: "background" }, direction: true, targetLocation: true, movement: true });
  });

  it("reports one life-loss event per kind of wrong round", () => {
    expect(manifest.lifeLossEvents.map((e) => e.id)).toEqual(["stopped_early", "stopped_late", "no_stop"]);
  });

  it("offers every picture category and every movement type as a setting", () => {
    const p = manifest.paramsSchema.properties;
    expect(p.category!.enum).toEqual(["auto", ...CATEGORIES]);
    expect(p.movement_type!.enum).toEqual(["auto", ...MOVEMENT_TYPES]);
    for (const key of ["category", "movement_type", "bg_temperature", "background", "direction"]) {
      const def = p[key]!;
      for (const v of def.enum!) {
        const o = def["x-ui"]!.options![String(v)]!;
        expect(o.en, `${key}.${v}`).toBeTruthy();
        expect(o.he, `${key}.${v}`).toBeTruthy();
      }
    }
  });

  it("is in English and Hebrew throughout", () => {
    expect(manifest.name.he).toBeTruthy();
    expect(manifest.summary.he).toBeTruthy();
    for (const m of manifest.metrics) expect(m.label.he, m.key).toBeTruthy();
    for (const e of manifest.lifeLossEvents) expect(e.label.he, e.id).toBeTruthy();
    expect(Object.keys(strings.he).sort()).toEqual(Object.keys(strings.en).sort());
  });

  it("calls itself a game-based activity, never an assessment or a treatment", () => {
    const text = JSON.stringify([manifest, strings]).toLowerCase();
    for (const word of ["assessment", "treatment", "diagnos", "אבחון", "אבחנה", "טיפול"]) expect(text).not.toContain(word);
  });

  it("credits the artwork", () => {
    expect(manifest.credits?.en).toContain("Fluent Emoji");
  });
});
