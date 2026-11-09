/** The brain-region filter on a game step (spec 2026-11-09 §7). */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import type { GameStepInput } from "@emb/contracts";
import type { GameManifest } from "@emb/game-sdk";
import { timerPositionFor } from "@emb/session-rules";
import { makeQueryClient } from "../src/App.tsx";
import { PrefsProvider, type Locale } from "../src/i18n/index.tsx";
import { findGame } from "../src/games/registry.ts";
import { defaultStep, StepEditor } from "../src/routes/protocols/steps.tsx";
import { StepRegion } from "../src/routes/protocols/StepRegion.tsx";
import { demoRegions } from "../src/demo/regions.ts";

const catchMe = findGame("catch-me-if-you-can")!.manifest;
const peekPeek = findGame("peek-peek")!.manifest;
const idOf = (path: string) => demoRegions("en").find((r) => r.path === path)!.id;

beforeEach(() => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    if (url.pathname === "/v1/brain-regions") return new Response(JSON.stringify({ regions: demoRegions(url.searchParams.get("lang") ?? "en") }), { status: 200, headers: { "content-type": "application/json" } });
    return new Response("{}", { status: 404, headers: { "content-type": "application/json" } });
  });
});
afterEach(() => vi.unstubAllGlobals());

let last: GameStepInput | null = null;
function Harness({ manifest, start, editor = false }: { manifest: GameManifest; start: Partial<GameStepInput>; editor?: boolean }) {
  const [s, setS] = useState<GameStepInput>({ ...defaultStep(manifest), ...start });
  const onChange = (n: GameStepInput) => {
    last = n;
    setS(n);
  };
  return editor ? <StepEditor step={s} manifest={manifest} onChange={onChange} /> : <StepRegion step={s} manifest={manifest} onChange={onChange} />;
}
function show(manifest: GameManifest, start: Partial<GameStepInput> = {}, locale: Locale = "en", editor = false) {
  last = null;
  return render(
    <PrefsProvider initialLocale={locale}>
      <QueryClientProvider client={makeQueryClient()}>
        <Harness manifest={manifest} start={start} editor={editor} />
      </QueryClientProvider>
    </PrefsProvider>,
  );
}

describe("StepRegion", () => {
  it("choosing a sub-lobe sets region_id and hemisphere together", async () => {
    show(catchMe);
    await userEvent.selectOptions(await screen.findByLabelText("Side"), "right");
    expect(last).toMatchObject({ hemisphere: "right", region_id: null, timer_position: timerPositionFor("right", true) });
    await userEvent.selectOptions(screen.getByLabelText("Lobe"), idOf("right.temporal"));
    expect(last!.region_id).toBe(idOf("right.temporal"));
    await userEvent.selectOptions(screen.getByLabelText("Sub-lobe"), idOf("right.temporal.superior_temporal"));
    expect(last).toMatchObject({ hemisphere: "right", region_id: idOf("right.temporal.superior_temporal") });
    await userEvent.selectOptions(screen.getByLabelText("Side"), "left");
    expect(last).toMatchObject({ hemisphere: "left", region_id: idOf("left.temporal.superior_temporal"), timer_position: timerPositionFor("left", true) });
  });

  it("the summary lists only what the game uses", async () => {
    const a = show(catchMe, { hemisphere: "right", region_id: idOf("right.frontal.dlpfc") });
    const summary = await screen.findByText(/This game uses/);
    expect(summary.textContent).toMatch(/right hemisphere/);
    expect(summary.textContent).toMatch(/background: cold, textured/);
    a.unmount();
    show(peekPeek, { hemisphere: "right", region_id: idOf("right.frontal.dlpfc") });
    const s2 = await screen.findByText(/This game uses/);
    expect(s2.textContent).toMatch(/right hemisphere/);
    expect(s2.textContent).not.toMatch(/background/);
  });

  it("left cerebellum shows the crossed note", async () => {
    show(catchMe, { hemisphere: "left", region_id: idOf("left.subcortical.cerebellum") });
    expect(await screen.findByText(/Runs with the right hemisphere's look and placement/)).toBeInTheDocument();
  });

  it("a lobe choice says each session uses one of its sub-lobes", async () => {
    show(catchMe, { hemisphere: "right", region_id: idOf("right.frontal") });
    expect(await screen.findByText("Each session uses one of: DLPFC (dorsolateral prefrontal), Orbitofrontal")).toBeInTheDocument();
    expect(screen.getByText("Draft settings, pending clinical review")).toBeInTheDocument();
  });

  it("Brodmann areas without a sub-lobe are disabled", async () => {
    show(catchMe, { hemisphere: "right" });
    await userEvent.click(await screen.findByRole("radio", { name: "Brodmann area" }));
    const area = screen.getByLabelText("Area") as HTMLSelectElement;
    const ba44 = [...area.options].find((o) => o.value === idOf("right.frontal.ba44"))!;
    const ba46 = [...area.options].find((o) => o.value === idOf("right.frontal.ba46"))!;
    expect(ba44.disabled).toBe(true);
    expect(ba44.textContent).toMatch(/no settings yet/);
    expect(ba46.disabled).toBe(false);
    expect(ba46.textContent).toMatch(/DLPFC/);
    await userEvent.selectOptions(area, idOf("right.frontal.ba46"));
    expect(last).toMatchObject({ hemisphere: "right", region_id: idOf("right.frontal.ba46") });
  });

  it("background controls are read-only under a region", async () => {
    show(catchMe, { hemisphere: "right", region_id: idOf("right.frontal.dlpfc") }, "en", true);
    const settings = await screen.findByRole("group", { name: "Game settings" });
    expect(within(settings).getAllByText("Set by the brain region").length).toBeGreaterThanOrEqual(1);
    expect(within(settings).queryByRole("radio", { name: /textured/i })).toBeNull();
  });

  it("shows the filter summary in Hebrew", async () => {
    const { container } = show(catchMe, { hemisphere: "right", region_id: idOf("right.temporal.superior_temporal") }, "he");
    expect(await screen.findByLabelText("תת-אונה")).toBeInTheDocument();
    expect((screen.getByLabelText("תת-אונה") as HTMLSelectElement).selectedOptions[0]!.textContent).toBe("רקתי עליון");
    expect(screen.getByText(/המשחק משתמש ב/)).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/margin-(left|right)|padding-(left|right)/);
  });
});
