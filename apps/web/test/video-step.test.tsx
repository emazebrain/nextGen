/** A video step must never strand the child: with nothing to play, Continue is there at once (ADR 0018). */
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { VideoStep } from "../src/session/VideoStep.tsx";

describe("VideoStep", () => {
  it("offers Continue when an uploaded video has no file", () => {
    const step = {
      kind: "video" as const,
      assignment_step_id: "s1",
      ordinal: 1,
      video: { id: "v1", version: 1, source: "upload" as const, youtube_id: null, title: "Colour shapes", duration_s: 10, file_url: null, sha256: null },
    };
    render(
      <PrefsProvider initialLocale="en">
        <VideoStep step={step as never} plannedSessionId="p1" onDone={() => {}} finishRef={{ current: null }} />
      </PrefsProvider>,
    );
    expect(screen.getByRole("button", { name: /continue/i })).toBeTruthy();
  });
});
