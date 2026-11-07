/** Video steps in the UI (ADR 0018): step order in both directions, and what a view says about completion. */
import { describe, expect, it } from "vitest";
import { joinSteps } from "../src/lib/steps.ts";
import { viewOutcome } from "../src/session/VideoStep.tsx";

describe("joinSteps", () => {
  it("points the arrows along the reading direction", () => {
    expect(joinSteps(["Tunnel Rush", "▶ Colour shapes", "Block Crasher"], "en")).toBe("Tunnel Rush → ▶ Colour shapes → Block Crasher");
    expect(joinSteps(["מנהרה", "▶ צורות", "לבנים"], "he")).toBe("מנהרה ← ▶ צורות ← לבנים");
  });
});

describe("viewOutcome", () => {
  it("an uploaded video is complete when it played to the end", () => {
    expect(viewOutcome({ source: "upload", ended: true, watchedS: 9.6, durationS: 10 })).toEqual({ watched_s: 10, completed: true });
    expect(viewOutcome({ source: "upload", ended: false, watchedS: 4.2, durationS: 10 })).toEqual({ watched_s: 4, completed: false });
  });
  it("a YouTube video is complete after 80% of its length, and unknown when nobody entered a length", () => {
    expect(viewOutcome({ source: "youtube", ended: false, watchedS: 50, durationS: 60 })).toEqual({ watched_s: 50, completed: true });
    expect(viewOutcome({ source: "youtube", ended: false, watchedS: 20, durationS: 60 })).toEqual({ watched_s: 20, completed: false });
    expect(viewOutcome({ source: "youtube", ended: false, watchedS: 45, durationS: null })).toEqual({ watched_s: 45, completed: null });
  });
});

describe("viewSummary", () => {
  it("says what the therapist can tell, including when completion is unknown", async () => {
    const { viewSummary } = await import("../src/session/VideoStep.tsx");
    expect(viewSummary({ completed: true, watched_s: 10 })).toEqual({ id: "run.video.watched", time: "0:10" });
    expect(viewSummary({ completed: null, watched_s: 75 })).toEqual({ id: "run.video.watchedFor", time: "1:15" });
    expect(viewSummary({ completed: false, watched_s: 4 })).toEqual({ id: "run.video.partly", time: "0:04" });
    expect(viewSummary({ completed: false, watched_s: 0 })).toEqual({ id: "run.video.notPlayed", time: "0:00" });
  });
});

describe("stepNames", () => {
  it("joins a protocol's steps along the reading direction", async () => {
    const { stepNames } = await import("../src/routes/protocols/pages.tsx");
    const items = [{ kind: "game" as const, game_id: "tunnel-rush" }, { kind: "video" as const, video_id: "v", title: "Colour shapes" }];
    const names = (ids: string[]) => ids.map((i) => i.toUpperCase());
    expect(stepNames({ games: [], items } as never, names, "he")).toBe("TUNNEL-RUSH ← ▶ Colour shapes");
  });
});

describe("builder.problem", () => {
  it("explains a video that is no longer in the library, in both languages", async () => {
    const { createIntl } = await import("react-intl");
    for (const lang of ["en", "he"] as const) {
      const msgs = (await import(`../src/i18n/messages/${lang}.json`)).default as Record<string, string>;
      const intl = createIntl({ locale: lang, messages: msgs });
      const say = (code: string) => intl.formatMessage({ id: "builder.problem" }, { code });
      expect(say("video_not_available")).not.toBe(say("something_else"));
    }
  });
});

describe("region filter", () => {
  const r = (id: string, kind: "hemisphere" | "lobe" | "area", code: string, parent_id: string | null, path: string) => ({ id, kind, code, parent_id, path, label: code, sort: 0 });
  const list = [
    r("L", "hemisphere", "left", null, "left"), r("R", "hemisphere", "right", null, "right"),
    r("LF", "lobe", "frontal", "L", "left.frontal"), r("RF", "lobe", "frontal", "R", "right.frontal"),
    r("L44", "area", "ba44", "LF", "left.frontal.ba44"), r("R44", "area", "ba44", "RF", "right.frontal.ba44"),
  ];
  it("asks the server for one node, or for a lobe or area code in both hemispheres", async () => {
    const { regionParams } = await import("../src/routes/admin/RegionPicker.tsx");
    expect(regionParams(null)).toEqual({});
    expect(regionParams({ kind: "node", id: "L44" })).toEqual({ region: "L44" });
    expect(regionParams({ kind: "both", code: null })).toEqual({});
    expect(regionParams({ kind: "both", code: "ba44" })).toEqual({ code: "ba44" });
  });
  it("shows which lobe and area a both-hemispheres code stands for", async () => {
    const { buildRegionTree, bothSelection } = await import("../src/routes/admin/RegionPicker.tsx");
    const tree = buildRegionTree(list as never);
    expect(bothSelection(tree, "ba44")).toEqual({ lobe: "frontal", area: "ba44" });
    expect(bothSelection(tree, "frontal")).toEqual({ lobe: "frontal", area: "" });
    expect(bothSelection(tree, null)).toEqual({ lobe: "", area: "" });
  });
});

describe("video editor", () => {
  it("reads a length typed as m:ss or seconds", async () => {
    const { parseClock } = await import("../src/routes/admin/videos.tsx");
    expect(parseClock("")).toBeNull();
    expect(parseClock("1:30")).toBe(90);
    expect(parseClock("45")).toBe(45);
    expect(parseClock("1:75")).toBeUndefined();
    expect(parseClock("abc")).toBeUndefined();
  });
  it("saves a new upload as a draft until its file is in, then publishes", async () => {
    const { savePlan } = await import("../src/routes/admin/videos.tsx");
    expect(savePlan({ want: "published", hasFile: false, pendingFile: true })).toEqual({ first: "draft", publishAfter: true });
    expect(savePlan({ want: "published", hasFile: true, pendingFile: true })).toEqual({ first: "published", publishAfter: false });
    expect(savePlan({ want: "draft", hasFile: false, pendingFile: true })).toEqual({ first: "draft", publishAfter: false });
    expect(savePlan({ want: "published", hasFile: false, pendingFile: false })).toEqual({ first: "published", publishAfter: false });
  });
});
