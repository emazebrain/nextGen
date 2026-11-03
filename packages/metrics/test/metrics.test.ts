import { describe, expect, it } from "vitest";
import { activity, scoreAgainst, skillsPlayed, trend, type GameInfo, type SessionInput } from "../src/index.ts";

const games: GameInfo[] = [
  {
    id: "catch",
    metrics: [
      { key: "final_jnd", lowerIsBetter: true, skills: ["visual_discrimination"] },
      { key: "anchor_first_rate", lowerIsBetter: false, skills: ["selective_attention"] },
      { key: "best_streak", lowerIsBetter: false },
    ],
  },
  { id: "orbit", metrics: [{ key: "max_chain", lowerIsBetter: false, skills: ["sequencing", "visual_discrimination"] }] },
];

let n = 0;
function s(day: number, difficulty: number, accuracy: number | null, extra: Partial<SessionInput> = {}): SessionInput {
  n += 1;
  return {
    id: `s${String(n).padStart(3, "0")}`,
    game_id: "catch",
    ended_at: `2026-10-${String(day).padStart(2, "0")}T10:00:00.000Z`,
    difficulty,
    accuracy,
    rt_median_ms: 1000,
    metrics: {},
    ...extra,
  };
}

describe("scoreAgainst", () => {
  it("is 100 at baseline and higher-is-better in both directions", () => {
    expect(scoreAgainst(0.8, 0.8, false)).toBe(100);
    expect(scoreAgainst(0.88, 0.8, false)).toBeCloseTo(110);
    expect(scoreAgainst(800, 1000, true)).toBeCloseTo(125); // faster = better
    expect(scoreAgainst(1250, 1000, true)).toBeCloseTo(80);
  });
  it("refuses undefined ratios rather than inventing a number", () => {
    expect(scoreAgainst(0.5, 0, false)).toBeNull();
    expect(scoreAgainst(0, 1000, true)).toBeNull();
  });
});

describe("trend", () => {
  it("says 'not enough' until there are three sessions and one after the baseline", () => {
    expect(trend([], games, { kind: "standard", key: "accuracy" }).summary).toBe("not_enough");
    const two = [s(1, 3, 0.7), s(2, 3, 0.8)];
    const t = trend(two, games, { kind: "standard", key: "accuracy" });
    expect(t.summary).toBe("not_enough");
    expect(t.points.every((p) => p.isBaseline)).toBe(true);
  });

  it("scores against the mean of the first two sessions at that difficulty, baseline included", () => {
    const t = trend([s(1, 3, 0.7), s(2, 3, 0.9), s(3, 3, 0.96)], games, { kind: "standard", key: "accuracy" });
    expect(t.points.map((p) => p.score)).toEqual([87.5, 112.5, 120]);
    expect(t.points.map((p) => p.value)).toEqual([0.7, 0.9, 0.96]);
    expect(t.summary).toBe("improving");
    expect(t.recentScore).toBe(120);
  });

  it("starts a fresh baseline when difficulty goes up, so harder work doesn't look like a decline", () => {
    const sessions = [s(1, 3, 0.8), s(2, 3, 0.8), s(3, 3, 0.9), s(4, 4, 0.6), s(5, 4, 0.6), s(6, 4, 0.66)];
    const t = trend(sessions, games, { kind: "standard", key: "accuracy" });
    expect(t.points.map((p) => p.score)).toEqual([100, 100, 112.5, 100, 100, 110]);
    expect(t.points.map((p) => p.difficultyChanged)).toEqual([false, false, false, true, false, false]);
    expect(t.points.map((p) => p.isBaseline)).toEqual([true, true, false, true, true, false]);
    expect(t.summary).toBe("improving"); // mean(112.5, 110)
  });

  it("keeps separate baselines per side and for black and white (ADR 0009)", () => {
    const sessions = [
      s(1, 3, 0.8, { hemisphere: "left" }), s(2, 3, 0.8, { hemisphere: "left" }),
      s(3, 3, 0.5, { hemisphere: "right" }), s(4, 3, 0.5, { hemisphere: "right" }),
      s(5, 3, 0.6, { hemisphere: "left", monochrome: true }), s(6, 3, 0.6, { hemisphere: "left", monochrome: true }),
      s(7, 3, 0.88, { hemisphere: "left" }), s(8, 3, 0.55, { hemisphere: "right" }), s(9, 3, 0.66, { hemisphere: "left", monochrome: true }),
    ];
    const t = trend(sessions, games, { kind: "standard", key: "accuracy" });
    // Each of the three groups sets its own baseline, so every later session scores 110 against its own start.
    expect(t.points.map((p) => p.isBaseline)).toEqual([true, true, true, true, true, true, false, false, false]);
    expect(t.points.slice(6).map((p) => p.score)).toEqual([110, 110, 110]);
  });

  it("treats reaction time as lower-is-better", () => {
    const t = trend(
      [s(1, 2, 0.8, { rt_median_ms: 1000 }), s(2, 2, 0.8, { rt_median_ms: 1000 }), s(3, 2, 0.8, { rt_median_ms: 1300 })],
      games,
      { kind: "standard", key: "rt_median_ms" },
    );
    expect(t.points.at(-1)!.score).toBe(76.9);
    expect(t.summary).toBe("declining");
  });

  it("reads 'steady' inside ±10%", () => {
    const t = trend([s(1, 3, 0.8), s(2, 3, 0.8), s(3, 3, 0.84), s(4, 3, 0.78)], games, { kind: "standard", key: "accuracy" });
    expect(t.summary).toBe("steady");
  });

  it("combines every metric tagged with a skill, across games, each against its own baseline", () => {
    const sessions = [
      s(1, 3, null, { metrics: { final_jnd: 10 } }),
      s(2, 3, null, { metrics: { final_jnd: 10 } }),
      s(3, 3, null, { metrics: { final_jnd: 8 } }), // 125
      s(4, 2, null, { game_id: "orbit", metrics: { max_chain: 4 } }),
      s(5, 2, null, { game_id: "orbit", metrics: { max_chain: 4 } }),
      s(6, 2, null, { game_id: "orbit", metrics: { max_chain: 5 } }), // 125
    ];
    const t = trend(sessions, games, { kind: "skill", skill: "visual_discrimination" });
    expect(t.points).toHaveLength(6);
    expect(t.points.map((p) => p.score)).toEqual([100, 100, 125, 100, 100, 125]);
    expect(t.points.every((p) => p.value === null)).toBe(true);
    expect(t.summary).toBe("improving");
  });

  it("skips sessions with no value, and ignores games without the skill", () => {
    const sessions = [s(1, 3, 0.8), s(2, 3, null), s(3, 3, 0.8), s(4, 3, 0.8, { game_id: "unknown" })];
    expect(trend(sessions, games, { kind: "standard", key: "accuracy" }).points).toHaveLength(3);
    expect(trend(sessions, games, { kind: "skill", skill: "selective_attention" }).points).toHaveLength(0);
  });

  it("is deterministic and doesn't depend on input order", () => {
    const sessions = [s(3, 3, 0.9), s(1, 3, 0.7), s(2, 3, 0.8)];
    const a = trend(sessions, games, { kind: "standard", key: "accuracy" });
    const b = trend([...sessions].reverse(), games, { kind: "standard", key: "accuracy" });
    expect(a).toEqual(b);
    expect(a.points.map((p) => p.endedAt.slice(8, 10))).toEqual(["01", "02", "03"]);
  });
});

describe("skillsPlayed and activity", () => {
  it("lists skills of games actually played, in first-played order", () => {
    expect(skillsPlayed([s(2, 1, 0.5, { game_id: "orbit" }), s(1, 1, 0.5)], games)).toEqual(["visual_discrimination", "selective_attention", "sequencing"]);
    expect(skillsPlayed([], games)).toEqual([]);
  });

  it("counts sessions and minutes in the last 30 days", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    const a = activity([s(30, 3, 0.8, { active_ms: 300_000 }), s(29, 3, 0.8, { active_ms: 150_000, ended_at: "2026-09-01T10:00:00.000Z" }), s(20, 3, 0.8, { active_ms: 120_000 })], now);
    expect(a).toEqual({ sessions: 2, minutes: 7, lastPlayed: "2026-10-30T10:00:00.000Z" });
  });
});
