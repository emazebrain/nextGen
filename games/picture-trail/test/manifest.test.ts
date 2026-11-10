/** Picture Trail: manifest and strings (spec 2026-11-10). */
import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.ts";
import { strings } from "../src/strings.ts";

describe("manifest", () => {
  it("declares what a brain-region filter changes and the two ways to lose a life", () => {
    expect(manifest.id).toBe("picture-trail");
    expect(manifest.maxLevel).toBe(30);
    expect(manifest.regionUse).toEqual({ background: { temperature: "bg_temperature", type: "background" }, direction: true, targetLocation: true });
    expect(manifest.lifeLossEvents.map((e) => e.id)).toEqual(["wrong_picture", "missed_match"]);
    expect(manifest.capabilities.practice).toBe(true);
    expect(manifest.capabilities.monochrome).toBe(true);
  });

  it("has the spec's settings with defaults inside their ranges", () => {
    const p = manifest.paramsSchema.properties;
    expect(Object.keys(p).sort()).toEqual(["background", "bg_temperature", "direction", "lures", "show_ms"]);
    expect(p.direction!.enum).toEqual(["auto", "ltr", "rtl", "ttb", "btt", "tldbr", "brdtl", "trdbl", "bldtr"]);
    expect(p.direction!.default).toBe("auto");
    expect(p.show_ms).toMatchObject({ minimum: 0, maximum: 2500, default: 0 });
    for (const [k, d] of Object.entries(p)) {
      if (d.enum) expect(d.enum, k).toContain(d.default);
      expect(d["x-ui"]?.label.he, k).toBeTruthy();
    }
    expect(manifest.metrics.map((m) => m.key)).toEqual(["accuracy", "miss_rate", "wrong_tap_rate", "rt_correct_ms", "span", "best_streak", "highest_level"]);
  });

  it("child-facing text uses only game-based-activity wording", () => {
    // The hemisphere note is shown to therapists in the builder, where naming the brain region is allowed.
    const text = JSON.stringify([manifest.name, manifest.summary, strings]);
    expect(text).not.toMatch(/assessment|treatment|diagnos|therapy|brain|אבחון|טיפול|מוח/i);
  });
});

describe("strings", () => {
  it("English and Hebrew have the same keys and credit the pictures", () => {
    expect(Object.keys(strings.he).sort()).toEqual(Object.keys(strings.en).sort());
    expect(strings.en.credits).toMatch(/Twemoji.*CC-BY 4\.0/);
  });
});
