import { describe, expect, it } from "vitest";
import { createSession, SessionConfigError, timerLayout, timerPositionFor, timerShown } from "../src/index.js";

describe("configuration", () => {
  it("requires a duration of 30–1800 s for modes with time", () => {
    expect(() => createSession({ mode: "timed" })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "timed", durationS: 10 })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "timed_lives", durationS: 2000, lives: 3 })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "timed", durationS: 300 })).not.toThrow();
  });

  it("requires lives of 1–9 or 'auto' for modes with lives", () => {
    expect(() => createSession({ mode: "lives" })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "lives", lives: 0 })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "lives", lives: 10 })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "lives", lives: 2.5 })).toThrow(SessionConfigError);
    expect(() => createSession({ mode: "lives", lives: "auto" })).not.toThrow();
  });

  it("ignores settings that don't apply to the mode", () => {
    const s = createSession({ mode: "timed", durationS: 60, lives: 3 });
    expect(s.snapshot().livesRemaining).toBeNull();
  });
});

describe("timer", () => {
  it("never starts before the first qualifying interaction", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.tick(0);
    s.tick(500_000);
    expect(s.snapshot()).toMatchObject({ phase: "ready", activeMs: 0, remainingMs: 60_000 });
  });

  it("starts once, on the first interaction, and ignores later ones", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(1000);
    s.qualifyingInteraction(5000);
    s.tick(11_000);
    expect(s.snapshot().activeMs).toBe(10_000);
  });

  it("ends a timed session with time_up and caps active time at the duration", () => {
    const s = createSession({ mode: "timed", durationS: 30 });
    s.qualifyingInteraction(0);
    s.tick(29_999);
    expect(s.snapshot().phase).toBe("playing");
    s.tick(31_000);
    expect(s.snapshot()).toMatchObject({ phase: "ended", status: "time_up", endReason: "duration_elapsed", activeMs: 30_000 });
  });

  it("raises the HUD warning for the last 10 seconds only", () => {
    const s = createSession({ mode: "timed", durationS: 30 });
    s.qualifyingInteraction(0);
    expect(s.tick(19_000).timerWarning).toBe(false);
    expect(s.tick(20_000).timerWarning).toBe(true);
  });

  it("excludes paused time from play time", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(0);
    s.tick(10_000);
    s.pause(10_000, "app_hidden");
    s.tick(40_000); // ignored while paused
    s.resume(40_000);
    s.tick(45_000);
    expect(s.snapshot()).toMatchObject({ activeMs: 15_000, pausedMs: 30_000, phase: "playing" });
  });

  it("treats repeated pauses as one", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(0);
    s.pause(5000);
    s.pause(9000);
    s.resume(10_000);
    expect(s.snapshot().pausedMs).toBe(5000);
  });

  it("abandons a session left in the background longer than abandonAfterS", () => {
    const s = createSession({ mode: "timed", durationS: 300, abandonAfterS: 600 });
    s.qualifyingInteraction(0);
    s.pause(1000, "app_hidden");
    s.resume(1000 + 600_001);
    expect(s.snapshot()).toMatchObject({ phase: "ended", status: "abandoned", endReason: "background_timeout" });
  });

  it("never loses play time when the clock goes backwards", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(10_000);
    s.tick(12_000);
    s.tick(11_000);
    s.tick(13_000);
    expect(s.snapshot().activeMs).toBe(4000);
  });
});

describe("lives", () => {
  it("ends a lives session with out_of_lives when the last life is lost", () => {
    const s = createSession({ mode: "lives", lives: 3 });
    s.qualifyingInteraction(0);
    expect(s.lifeLossEvent(1000)).toBe("life_lost");
    expect(s.lifeLossEvent(2000)).toBe("life_lost");
    expect(s.snapshot().livesRemaining).toBe(1);
    expect(s.lifeLossEvent(3000)).toBe("life_lost");
    expect(s.snapshot()).toMatchObject({ phase: "ended", status: "out_of_lives", endReason: "lives_depleted", livesLost: 3 });
  });

  it("never ends a timed session on mistakes", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(0);
    for (let i = 1; i <= 20; i++) expect(s.lifeLossEvent(i * 100)).toBe("recorded_only");
    expect(s.snapshot()).toMatchObject({ phase: "playing", lifeLossEvents: 20, livesLost: 0, livesRemaining: null });
  });

  it("ignores a second loss inside the grace window", () => {
    const s = createSession({ mode: "lives", lives: 3, lifeLossGraceMs: 1000 });
    s.qualifyingInteraction(0);
    expect(s.lifeLossEvent(5000)).toBe("life_lost");
    expect(s.lifeLossEvent(5500)).toBe("ignored_grace");
    expect(s.lifeLossEvent(6000)).toBe("life_lost");
    expect(s.snapshot().livesRemaining).toBe(1);
  });

  it("leaves 'auto' lives to the game and relies on the safety cap", () => {
    const s = createSession({ mode: "lives", lives: "auto", safetyCapS: 120 });
    s.qualifyingInteraction(0);
    expect(s.lifeLossEvent(1000)).toBe("game_managed");
    s.tick(120_000);
    expect(s.snapshot()).toMatchObject({ status: "completed", endReason: "safety_cap" });
  });

  it("ignores events before play starts and after it ends", () => {
    const s = createSession({ mode: "lives", lives: 1 });
    expect(s.lifeLossEvent(0)).toBe("ignored_not_playing");
    s.qualifyingInteraction(0);
    s.lifeLossEvent(10);
    expect(s.lifeLossEvent(20)).toBe("ignored_not_playing");
  });
});

describe("timed_lives and precedence", () => {
  it("ends on whichever comes first: time", () => {
    const s = createSession({ mode: "timed_lives", durationS: 30, lives: 3 });
    s.qualifyingInteraction(0);
    s.lifeLossEvent(1000);
    s.tick(30_000);
    expect(s.snapshot()).toMatchObject({ status: "time_up", livesRemaining: 2 });
  });

  it("ends on whichever comes first: lives", () => {
    const s = createSession({ mode: "timed_lives", durationS: 300, lives: 1 });
    s.qualifyingInteraction(0);
    s.lifeLossEvent(1000);
    expect(s.snapshot()).toMatchObject({ status: "out_of_lives" });
  });

  it("prefers out_of_lives over time_up in the same frame", () => {
    const s = createSession({ mode: "timed_lives", durationS: 30, lives: 1 });
    s.qualifyingInteraction(0);
    s.lifeLossEvent(30_500); // time is also up at this instant
    expect(s.snapshot().status).toBe("out_of_lives");
  });

  it("prefers time_up over completed in the same frame", () => {
    const s = createSession({ mode: "timed_lives", durationS: 30, lives: 3 });
    s.qualifyingInteraction(0);
    s.contentExhausted(31_000, "max_level");
    expect(s.snapshot().status).toBe("time_up");
  });

  it("completes when content runs out before time", () => {
    const s = createSession({ mode: "timed", durationS: 300 });
    s.qualifyingInteraction(0);
    s.contentExhausted(60_000, "max_level");
    expect(s.snapshot()).toMatchObject({ status: "completed", endReason: "max_level", activeMs: 60_000 });
  });
});

describe("abandonment", () => {
  it("records who quit", () => {
    const a = createSession({ mode: "timed", durationS: 60 });
    a.qualifyingInteraction(0);
    a.quit(5000, "therapist");
    expect(a.snapshot()).toMatchObject({ status: "abandoned", endReason: "quit_by_therapist", activeMs: 5000 });

    const b = createSession({ mode: "lives", lives: 3 });
    b.qualifyingInteraction(0);
    b.pause(2000);
    b.quit(9000, "player");
    expect(b.snapshot()).toMatchObject({ endReason: "quit_by_player", activeMs: 2000, pausedMs: 7000 });
  });

  it("closes a killed session as abandoned, once", () => {
    const s = createSession({ mode: "timed", durationS: 60 });
    s.qualifyingInteraction(0);
    s.markAppKilled();
    s.quit(1000, "player");
    expect(s.snapshot()).toMatchObject({ status: "abandoned", endReason: "app_killed" });
  });
});

describe("determinism", () => {
  it("produces identical snapshots for identical event logs", () => {
    const run = () => {
      const s = createSession({ mode: "timed_lives", durationS: 120, lives: 3, lifeLossGraceMs: 500 });
      const log: Array<[string, number]> = [
        ["first", 1000], ["loss", 4000], ["loss", 4200], ["pause", 9000], ["resume", 15000], ["loss", 20000], ["tick", 50000],
      ];
      for (const [e, t] of log) {
        if (e === "first") s.qualifyingInteraction(t);
        else if (e === "loss") s.lifeLossEvent(t);
        else if (e === "pause") s.pause(t);
        else if (e === "resume") s.resume(t);
        else s.tick(t);
      }
      return s.snapshot();
    };
    expect(run()).toEqual(run());
    expect(run()).toMatchObject({ activeMs: 43_000, pausedMs: 6000, livesRemaining: 1, lifeLossEvents: 3 });
  });
});

describe("timer display", () => {
  it("puts the timer in the corner opposite the trained hemisphere, styled by palette", () => {
    expect(timerLayout("left")).toEqual({ side: "right", style: "digital", palette: "warm" });
    expect(timerLayout("right")).toEqual({ side: "left", style: "bar", palette: "cold" });
  });

  it("stores the derived corner, or hidden", () => {
    expect(timerPositionFor("left", true)).toBe("right");
    expect(timerPositionFor("right", true)).toBe("left");
    expect(timerPositionFor("left", false)).toBe("hidden");
    expect(timerShown("hidden")).toBe(false);
    expect(timerShown("left")).toBe(true); // a v1 same-side row still shows the timer, in the derived corner
  });
});
