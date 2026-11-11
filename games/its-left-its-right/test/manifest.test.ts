import { describe, expect, it } from "vitest";
import { manifest } from "../src/manifest.ts";
import { strings } from "../src/strings.ts";

describe("manifest", () => {
  it("has the spec's id, maxLevel, and age range", () => {
    expect(manifest.id).toBe("its-left-its-right");
    expect(manifest.maxLevel).toBe(30);
    expect(manifest.ageRange).toEqual([4, 16]);
  });

  it("declares region use: background, direction, and target location", () => {
    expect(manifest.regionUse).toEqual({
      background: { temperature: "bg_temperature", type: "background" },
      direction: true,
      targetLocation: true,
    });
  });

  it("declares life-loss events for wrong answer and timeout", () => {
    expect(manifest.lifeLossEvents.map(e => e.id)).toEqual(["wrong_answer", "no_answer"]);
  });

  it("has the spec's metrics", () => {
    const keys = manifest.metrics.map(m => m.key);
    expect(keys).toEqual([
      "accuracy", "omission_rate", "wrong_rate", "rt_correct_ms",
      "left_accuracy", "right_accuracy", "hand_accuracy",
      "rotation_effect_ms", "best_streak", "highest_level",
    ]);
  });

  it("has paramsSchema with spec's settings", () => {
    const p = manifest.paramsSchema.properties;
    expect(Object.keys(p).sort()).toEqual(["background", "bg_temperature", "body_parts", "direction", "max_rotation", "time_limit_ms"]);
    expect(p.time_limit_ms).toMatchObject({ minimum: 0, maximum: 10000, default: 0 });
    expect(p.max_rotation).toMatchObject({ minimum: 0, maximum: 180, default: 0 });
    expect(p.body_parts!["x-ui"]!.widget).toBe("multiselect");
  });

  it("asset packs: shared is real, warm/cold are stubs", () => {
    expect(manifest.assetPacks.shared).toBe("packs/shared/pack.json");
  });
});

describe("strings", () => {
  it("English and Hebrew have the same keys", () => {
    expect(Object.keys(strings.he).sort()).toEqual(Object.keys(strings.en).sort());
  });

  it("child-facing text uses only game-based-activity wording", () => {
    const text = JSON.stringify([manifest.name, manifest.summary, strings]);
    expect(text).not.toMatch(/assessment|treatment|diagnos|therapy|brain|אבחון|טיפול|מוח/i);
  });

  it("has left/right button labels in both locales", () => {
    expect(strings.en.left).toBe("Left");
    expect(strings.en.right).toBe("Right");
    expect(strings.he.left).toBe("שמאל");
    expect(strings.he.right).toBe("ימין");
  });
});
