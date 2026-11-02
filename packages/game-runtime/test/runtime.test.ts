/**
 * The runtime with a stand-in game: the clock waits for the first real
 * interaction, lives end the session, quitting needs the pause menu, and one
 * results envelope comes out with standard metrics.
 */
import { afterEach, describe, expect, it } from "vitest";
import type { GameDefinition, InitContext } from "@emb/game-sdk";
import { boot } from "../src/runtime.ts";
import type { FrameToHost, LaunchParams, ResultEnvelope } from "../src/protocol.ts";
import { stars, stdMetrics } from "../src/stats.ts";

const params = (extra: Partial<LaunchParams> = {}): LaunchParams => ({
  session_mode: "timed_lives",
  duration_s: 120,
  lives: 3,
  difficulty: 3,
  start_level: "from_difficulty",
  hemisphere: "left",
  timer_position: "left",
  practice: "off",
  instructions: "auto",
  lang: "en",
  sound: "off",
  reduce_motion: "on",
  high_contrast: false,
  show_score: true,
  context: "clinic",
  seed: 7,
  input_assist: "none",
  speed_scale: 1,
  ...extra,
});

function fakeGame(onInit: (ctx: InitContext) => void): GameDefinition {
  return {
    manifest: { id: "fake", version: "1.0.0", capabilities: { practice: false } } as GameDefinition["manifest"],
    strings: { en: { "instructions.title": "Fake", "instructions.text": "Tap things." } },
    create: () => ({
      init: async (ctx) => onInit(ctx),
      start: () => {},
      pause: () => {},
      resume: () => {},
      end: () => ({ best_streak: 2 }),
      destroy: () => {},
    }),
  };
}

const messages: FrameToHost[] = [];
window.addEventListener("message", (e) => {
  if (e.data && typeof e.data.type === "string" && !["launch", "pause", "resume", "quit"].includes(e.data.type)) messages.push(e.data);
});
/** jsdom doesn't set event.source on postMessage, so host messages are dispatched by hand. */
const send = (data: unknown) => window.dispatchEvent(new MessageEvent("message", { data, source: window }));
const until = async <T>(fn: () => T | undefined, ms = 2000): Promise<T> => {
  const start = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - start > ms) throw new Error("timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
};

afterEach(() => {
  messages.length = 0;
  document.body.innerHTML = "";
});

async function launch(p: LaunchParams): Promise<InitContext> {
  let ctx: InitContext | undefined;
  boot(fakeGame((c) => (ctx = c)), window);
  await until(() => messages.find((m) => m.type === "ready"));
  send({ type: "launch", sessionId: "0192f3a0-0000-7000-8000-000000000001", params: p, demo: false });
  await until(() => ctx);
  (document.querySelector("[data-play]") as HTMLButtonElement).click();
  return ctx!;
}

describe("game runtime", () => {
  it("doesn't start the clock until the first real interaction, then ends on the last heart", async () => {
    const ctx = await launch(params());
    await new Promise((r) => setTimeout(r, 60));
    expect(ctx.session.state.activeMs).toBe(0);
    expect(document.querySelector(".hud-timer .time")!.textContent).toBe("2:00");
    ctx.session.qualifyingInteraction();
    await until(() => messages.find((m) => m.type === "started"));
    ctx.session.trial({ trialId: "1", level: 2, stimulusOnMs: 0, responseMs: 800, outcome: "correct", target: { x: 1, y: 1, hemifield: "L" } });
    ctx.session.trial({ trialId: "2", level: 2, stimulusOnMs: 0, responseMs: 900, outcome: "error", target: { x: 1, y: 1, hemifield: "R" } });
    for (let i = 0; i < 3; i++) ctx.session.lifeLossEvent("wrong_tile");
    const ended = await until(() => messages.find((m): m is Extract<FrameToHost, { type: "ended" }> => m.type === "ended"));
    const env: ResultEnvelope = ended.envelope;
    expect(env).toMatchObject({ status: "out_of_lives", end_reason: "lives_depleted", lives_start: 3, lives_lost: 3, lives_remaining: 0, game_id: "fake" });
    expect(env.std).toMatchObject({ trials_total: 2, correct: 1, errors: 1, accuracy: 0.5, left_accuracy: 1, right_accuracy: 0 });
    expect(env.metrics).toEqual({ best_streak: 2 });
    expect(env.started_at).not.toBeNull();
    // The child sees encouragement, never "Game over".
    expect(document.querySelector(".summary h1")!.textContent).toBe("Great effort!");
    expect(messages.filter((m) => m.type === "ended")).toHaveLength(1);
  });

  it("left hemisphere: a warm four-digit clock in the top right corner", async () => {
    await launch(params({ hemisphere: "left", timer_position: "right" }));
    const timer = document.querySelector(".hud-timer")!;
    expect([...timer.classList]).toEqual(expect.arrayContaining(["t-digital", "side-right"]));
    expect(document.querySelector(".hud-hearts")!.classList.contains("side-left")).toBe(true);
    // 2:00 lit as 0, 2, 0, 0 on the seven-segment display.
    const lit = [...timer.querySelectorAll(".lcd .digit")].map((g) => [...g.querySelectorAll(".seg")].map((x) => (x.classList.contains("on") ? 1 : 0)).join(""));
    expect(lit).toEqual(["1111110", "1101101", "1111110", "1111110"]);
    expect(timer.querySelector(".bar")).toBeNull();
  });

  it("right hemisphere: a cold emptying bar in the top left corner, even in Hebrew", async () => {
    await launch(params({ hemisphere: "right", timer_position: "left", lang: "he" }));
    expect(document.documentElement.dir).toBe("rtl");
    const timer = document.querySelector(".hud-timer")!;
    expect([...timer.classList]).toEqual(expect.arrayContaining(["t-bar", "side-left"]));
    expect(document.querySelector(".hud-hearts")!.classList.contains("side-right")).toBe(true);
    expect((timer.querySelector(".bar .fill") as HTMLElement).style.transform).toBe("scaleX(1)"); // full before the first tap
    expect(timer.querySelector(".lcd")).toBeNull();
  });

  it("follows the hemisphere even for steps saved with the old same-side timer, and can hide it", async () => {
    await launch(params({ hemisphere: "right", timer_position: "right" }));
    expect(document.querySelector(".hud-timer")!.classList.contains("side-left")).toBe(true);
    document.body.innerHTML = "";
    await launch(params({ hemisphere: "left", timer_position: "hidden" }));
    expect((document.querySelector(".hud-timer") as HTMLElement).hidden).toBe(true);
  });

  it("hides hearts in timed mode, and records mistakes without ending the session", async () => {
    const timed = params({ session_mode: "timed" });
    delete (timed as Partial<LaunchParams>).lives;
    const ctx = await launch(timed);
    ctx.session.qualifyingInteraction();
    for (let i = 0; i < 5; i++) ctx.session.lifeLossEvent("wrong_tile");
    await new Promise((r) => setTimeout(r, 50));
    expect(messages.some((m) => m.type === "ended")).toBe(false);
    expect((document.querySelector(".hud-hearts") as HTMLElement).hidden).toBe(true);
  });

  it("a therapist's quit from the host abandons the session with partial results", async () => {
    const ctx = await launch(params());
    ctx.session.qualifyingInteraction();
    send({ type: "quit", by: "therapist" });
    const ended = await until(() => messages.find((m): m is Extract<FrameToHost, { type: "ended" }> => m.type === "ended"));
    expect(ended.envelope).toMatchObject({ status: "abandoned", end_reason: "quit_by_therapist" });
  });

  it("the pause menu stops the clock", async () => {
    const ctx = await launch(params());
    ctx.session.qualifyingInteraction();
    (document.querySelector(".hud-pause") as HTMLButtonElement).click();
    expect(ctx.session.state.paused).toBe(true);
    expect(document.querySelector(".overlay h1")!.textContent).toBe("Paused");
    const at = ctx.session.state.activeMs;
    await new Promise((r) => setTimeout(r, 80));
    expect(ctx.session.state.activeMs).toBe(at);
    (document.querySelector("[data-resume]") as HTMLButtonElement).click(); // reduced motion: "Ready?" + tap
    (document.querySelector("[data-go]") as HTMLButtonElement).click();
    expect(ctx.session.state.paused).toBe(false);
  });
});

describe("standard metrics", () => {
  it("summarises accuracy and reaction times from trials", () => {
    const m = stdMetrics([
      { trialId: "a", level: 1, stimulusOnMs: 0, responseMs: 400, outcome: "correct" },
      { trialId: "b", level: 1, stimulusOnMs: 0, responseMs: 600, outcome: "correct" },
      { trialId: "c", level: 1, stimulusOnMs: 0, responseMs: null, outcome: "timeout" },
      { trialId: "d", level: 1, stimulusOnMs: 0, responseMs: 1000, outcome: "error" },
    ]);
    expect(m).toMatchObject({ trials_total: 4, correct: 2, errors: 1, timeouts: 1, accuracy: 0.5, rt_mean_ms: 500, rt_median_ms: 500, rt_min_ms: 400 });
  });
  it("gives 1–3 stars, never zero", () => {
    expect([null, 0, 0.6, 0.75, 0.9].map(stars)).toEqual([1, 1, 1, 2, 3]);
  });
});
