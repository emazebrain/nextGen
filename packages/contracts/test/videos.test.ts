import { describe, expect, it } from "vitest";
import { isVideoStep, stepInput, templateInput, videoInput, videoViewInput, youtubeId } from "../src/index.ts";

const VIDEO = "0192f3a4-5b6c-7d8e-9f01-23456789abcd";
const game = { game_id: "tunnel-rush", session_mode: "timed", duration_s: 300, lives: null, difficulty_start: 3, hemisphere: "left", timer_position: "left", practice: "auto", trial_window_ms: null, game_params: {}, progression: null };

describe("youtubeId", () => {
  it("reads the id from every common YouTube link form", () => {
    for (const url of [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?feature=share&v=dQw4w9WgXcQ",
      "https://youtu.be/dQw4w9WgXcQ?t=10",
      "https://www.youtube.com/shorts/dQw4w9WgXcQ",
      "https://www.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "dQw4w9WgXcQ",
    ])
      expect(youtubeId(url), url).toBe("dQw4w9WgXcQ");
  });

  it("rejects links that are not YouTube videos", () => {
    for (const url of ["https://vimeo.com/1", "https://www.youtube.com/watch?v=short", "https://evil.example/watch?v=dQw4w9WgXcQ", ""]) expect(youtubeId(url), url).toBeNull();
  });
});

describe("steps", () => {
  it("a step without a type is a game step (older apps)", () => {
    const s = stepInput.parse(game);
    expect(s.step_type).toBe("game");
    expect(isVideoStep(s)).toBe(false);
  });

  it("a video step holds only the video", () => {
    const s = stepInput.parse({ step_type: "video", video_id: VIDEO });
    expect(s).toEqual({ step_type: "video", video_id: VIDEO });
    expect(isVideoStep(s)).toBe(true);
    expect(stepInput.safeParse({ step_type: "video", video_id: VIDEO, session_mode: "timed" }).success).toBe(false);
    expect(stepInput.safeParse({ step_type: "video", video_id: "nope" }).success).toBe(false);
  });

  it("a template may mix games and videos", () => {
    const t = templateInput.parse({ clinic_id: VIDEO, name: "Mix", weeks: 4, sessions_per_week: 2, setting: "clinic", visibility: "private", steps: [game, { step_type: "video", video_id: VIDEO }, game] });
    expect(t.steps.map((s) => s.step_type)).toEqual(["game", "video", "game"]);
  });

  it("game steps keep their mode rules", () => {
    const r = stepInput.safeParse({ ...game, step_type: "game", duration_s: null });
    expect(r.success).toBe(false);
  });
});

describe("videoInput", () => {
  const base = { source: "youtube", youtube_url: "https://youtu.be/dQw4w9WgXcQ", titles: { en: "Calm breathing" }, region_ids: [], age_min: null, age_max: null, status: "draft" };

  it("accepts a YouTube video with one title", () => {
    expect(videoInput.parse(base).titles).toEqual({ en: "Calm breathing" });
  });

  it("needs a YouTube link for a YouTube video", () => {
    const r = videoInput.safeParse({ ...base, youtube_url: "https://vimeo.com/1" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.path).toEqual(["youtube_url"]);
  });

  it("needs at least one non-empty title", () => {
    expect(videoInput.safeParse({ ...base, titles: { en: "  ", he: "" } }).success).toBe(false);
  });

  it("keeps the age range in order", () => {
    expect(videoInput.safeParse({ ...base, age_min: 10, age_max: 6 }).success).toBe(false);
  });
});

describe("videoViewInput", () => {
  it("needs a UUIDv7 view id and a sane watch time", () => {
    const v = { client_view_id: "0192f3a4-5b6c-7d8e-9f01-23456789abcd", planned_session_id: VIDEO, assignment_step_id: VIDEO, video_id: VIDEO, video_version: 1, started_at: "2026-11-07T10:00:00.000Z", ended_at: "2026-11-07T10:01:00.000Z", watched_s: 60, completed: true };
    expect(videoViewInput.safeParse(v).success).toBe(true);
    expect(videoViewInput.safeParse({ ...v, client_view_id: "0192f3a4-5b6c-4d8e-9f01-23456789abcd" }).success).toBe(false);
    expect(videoViewInput.safeParse({ ...v, watched_s: -1 }).success).toBe(false);
  });
});
