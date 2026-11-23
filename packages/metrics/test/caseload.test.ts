/** One patient's row on the Reports caseload (reports dashboard design 2026-11-23). */
import { describe, expect, it } from "vitest";
import { caseloadSummary, type CaseloadInput, type GameInfo, type SessionInput } from "../src/index.ts";

const GAMES: GameInfo[] = [{ id: "g", metrics: [] }];
const NOW = new Date("2026-11-23T12:00:00Z");
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const date = (n: number) => day(n).slice(0, 10);

let seq = 0;
const session = (daysAgo: number, accuracy: number, difficulty = 2): SessionInput => ({
  id: `s${++seq}`,
  game_id: "g",
  ended_at: day(daysAgo),
  difficulty,
  accuracy,
  rt_median_ms: null,
  metrics: {},
});
const input = (over: Partial<CaseloadInput> = {}): CaseloadInput => ({ sessions: [], planned: [], decisions: [], reviewPending: 0, hasActiveAssignment: true, ...over });
const kinds = (i: CaseloadInput) => caseloadSummary(i, GAMES, NOW).reasons.map((r) => r.kind);

describe("caseloadSummary", () => {
  it("gives the last eight scores against the child's own baseline, oldest first", () => {
    const sessions = [0.5, 0.5, 0.55, 0.6, 0.6, 0.65, 0.7, 0.7, 0.75, 0.8].map((a, i) => session(10 - i, a));
    const row = caseloadSummary(input({ sessions }), GAMES, NOW);
    expect(row.scores).toHaveLength(8);
    expect(row.scores[0]).toBe(110); // 0.55 against a 0.5 baseline
    expect(row.scores.at(-1)).toBe(160);
    expect(row.summary).toBe("improving");
    expect(row.difficulty).toBe(2);
    expect(row.lastSessionAt).toBe(sessions.at(-1)!.ended_at);
    expect(row.reasons).toEqual([]);
  });

  it("says nothing about a trend until there are enough sessions", () => {
    const row = caseloadSummary(input({ sessions: [session(2, 0.5), session(1, 0.9)] }), GAMES, NOW);
    expect(row.summary).toBe("not_enough");
    expect(kinds(input({ sessions: [session(2, 0.9), session(1, 0.2)] }))).toEqual([]);
  });

  it("flags scores below the child's own earlier sessions", () => {
    const sessions = [0.8, 0.8, 0.6, 0.55, 0.5].map((a, i) => session(5 - i, a));
    const row = caseloadSummary(input({ sessions }), GAMES, NOW);
    expect(row.summary).toBe("declining");
    expect(row.reasons).toEqual([{ kind: "declining" }]);
  });

  it("counts results waiting for review", () => {
    expect(caseloadSummary(input({ sessions: [session(1, 0.5)], reviewPending: 3 }), GAMES, NOW).reasons).toEqual([{ kind: "review", count: 3 }]);
  });

  it("counts sessions missed in the last seven days, home and clinic apart", () => {
    const planned: CaseloadInput["planned"] = [
      { planned_date: date(1), location: "home", status: "missed" },
      { planned_date: date(2), location: "home", status: "planned" }, // its day has passed: missed
      { planned_date: date(3), location: "clinic", status: "missed" },
      { planned_date: date(0), location: "home", status: "planned" }, // today: still time
      { planned_date: date(9), location: "home", status: "missed" }, // too long ago
      { planned_date: date(2), location: "clinic", status: "cancelled" },
      { planned_date: date(1), location: "clinic", status: "done" },
    ];
    const row = caseloadSummary(input({ sessions: [session(1, 0.5)], planned }), GAMES, NOW);
    expect(row.reasons).toEqual([
      { kind: "missed_home", count: 2 },
      { kind: "missed_clinic", count: 1 },
    ]);
    // Last seven days, today included: cancelled ones don't count as planned.
    expect(row.week).toEqual({ done: 1, planned: 5 });
  });

  it("flags two weeks without a session, only while a protocol is active", () => {
    const sessions = [session(16, 0.5)];
    expect(caseloadSummary(input({ sessions }), GAMES, NOW).reasons).toEqual([{ kind: "inactive", days: 16 }]);
    expect(kinds(input({ sessions, hasActiveAssignment: false }))).toEqual([]);
    expect(kinds(input({ sessions: [session(13, 0.5)] }))).toEqual([]);
    // Never played, protocol assigned: worth a look, with no day count to show.
    expect(caseloadSummary(input(), GAMES, NOW).reasons).toEqual([{ kind: "inactive" }]);
  });

  it("flags difficulty stepping down twice in a row, and reports the last change", () => {
    const sessions = [session(1, 0.5)];
    const down2 = caseloadSummary(input({ sessions, decisions: [{ decided_at: day(5), action: "up" }, { decided_at: day(3), action: "down" }, { decided_at: day(1), action: "down" }] }), GAMES, NOW);
    expect(down2.reasons).toEqual([{ kind: "stepped_down" }]);
    expect(down2.lastChange).toBe("down");
    const mixed = caseloadSummary(input({ sessions, decisions: [{ decided_at: day(3), action: "down" }, { decided_at: day(1), action: "up" }] }), GAMES, NOW);
    expect(mixed.reasons).toEqual([]);
    expect(mixed.lastChange).toBe("up");
    expect(caseloadSummary(input({ sessions }), GAMES, NOW).lastChange).toBeNull();
  });

  it("lists reasons in a fixed order and leaves its inputs untouched", () => {
    const sessions = [0.8, 0.8, 0.5, 0.5, 0.5].map((a, i) => session(30 - i, a));
    const i = input({
      sessions,
      reviewPending: 1,
      planned: [{ planned_date: date(1), location: "clinic", status: "missed" }],
      decisions: [{ decided_at: day(28), action: "down" }, { decided_at: day(27), action: "down" }],
    });
    const before = JSON.stringify(i);
    expect(kinds(i)).toEqual(["review", "missed_clinic", "inactive", "declining", "stepped_down"]);
    expect(JSON.stringify(i)).toBe(before);
  });
});
