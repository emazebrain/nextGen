/** Patient → Progress: totals, a trend with a plain-language summary, a table view, difficulty changes and history. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider, type Locale } from "../src/i18n/index.tsx";

const patient = {
  id: "0192f3a0-0000-7000-8000-000000000001",
  clinic_id: "c1",
  given_name: "Noa",
  family_name: "Synthetic",
  date_of_birth: "2018-03-01",
  preferred_locale: "he",
  status: "active",
  sex: null,
  handedness: null,
  alert: null,
  colour_vision_deficiency: false,
  archived: false,
  can_play: true,
  care_team: [],
  guardians: [],
  consents: [],
};

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
function session(i: number, ageDays: number, difficulty: number, accuracy: number, jnd: number) {
  return {
    id: `0192f3a0-0000-7000-8000-${String(100 + i).padStart(12, "0")}`,
    game_id: "catch-me-if-you-can",
    status: "time_up",
    session_mode: "timed_lives",
    difficulty,
    hemisphere: "left",
    started_at: null,
    ended_at: day(ageDays),
    active_ms: 300_000,
    accuracy,
    rt_median_ms: 900,
    trials_total: 20,
    correct: Math.round(20 * accuracy),
    errors: 20 - Math.round(20 * accuracy),
    lives_lost: 1,
    highest_level: 3,
    planned_session_id: null,
    seq: i,
    metrics: { final_jnd: jnd },
  };
}

function mockApi(sessions: unknown[], decisions: unknown[] = []) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const p = url.pathname;
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (p === "/v1/me") return ok({ user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: "therapist", clinic_name: "Clinic" }] });
    if (p === `/v1/patients/${patient.id}`) return ok({ patient });
    if (p === `/v1/patients/${patient.id}/sessions`) return ok({ sessions });
    if (p === `/v1/patients/${patient.id}/progression`) return ok({ decisions });
    if (p.includes("/assignment")) return ok({ assignment: null });
    return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { "content-type": "application/json" } });
  });
}

function renderProgress(locale: Locale = "en") {
  render(
    <PrefsProvider initialLocale={locale}>
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [`/patients/${patient.id}/progress`] })} />
      </QueryClientProvider>
    </PrefsProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

describe("Progress tab", () => {
  it("says when there's nothing to show yet", async () => {
    mockApi([]);
    renderProgress();
    expect(await screen.findByRole("heading", { name: "No sessions yet" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Progress", current: "page" })).toBeInTheDocument();
  });

  it("explains a trend in words, offers a table, and lists difficulty changes and history", async () => {
    // Newest first, as the API returns them. Baseline at difficulty 2 is 0.70, then 0.84 and 0.80.
    const sessions = [session(4, 1, 2, 0.8, 9), session(3, 3, 2, 0.84, 9), session(2, 5, 2, 0.7, 12), session(1, 40, 2, 0.7, 12)];
    mockApi(sessions, [
      { id: "d1", game_session_id: sessions[0]!.id, game_id: "catch-me-if-you-can", decided_at: day(1), action: "up", from_difficulty: 2, to_difficulty: 3, reason: "streak_up" },
    ]);
    renderProgress();

    expect(await screen.findByRole("heading", { name: "Accuracy compared with ⁨Noa⁩'s first sessions" })).toBeInTheDocument();
    const tiles = screen.getByText("Sessions, last 30 days").closest("div")!;
    expect(within(tiles).getByText("3")).toBeInTheDocument(); // one session is older than 30 days
    expect(screen.getByText("Above baseline")).toBeInTheDocument();
    expect(screen.getByText(/Recent sessions average 117, above/)).toBeInTheDocument();
    expect(screen.getByRole("group", { name: /Trend chart: Accuracy, 4 sessions/ })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Show as table" }));
    const table = screen.getByRole("table", { name: "Accuracy: each session compared with baseline" });
    const rows = within(table).getAllByRole("row");
    expect(rows).toHaveLength(5);
    expect(rows[1]).toHaveTextContent("Session 4");
    expect(rows[1]).toHaveTextContent("80%");
    expect(rows[1]).toHaveTextContent("114");
    expect(rows[4]).toHaveTextContent("Sets the baseline");

    // A skill view from the game's metrics (final_jnd is lower-is-better: 9 vs 12 → 133).
    await userEvent.selectOptions(screen.getByLabelText("Show"), "Visual discrimination");
    expect(screen.getByRole("heading", { name: /Visual discrimination compared with/ })).toBeInTheDocument();
    expect(screen.getByText(/Recent sessions average 133/)).toBeInTheDocument();

    expect(screen.getByText("Raised from 2 to 3 after strong sessions in a row")).toBeInTheDocument();
    // No screen width in the test browser, so history uses its card layout (a list).
    const history = screen.getByRole("list", { name: "Every game played, newest first" });
    expect(within(history).getAllByRole("listitem")).toHaveLength(4);
  });

  it("needs three sessions before it offers a summary, in Hebrew too", async () => {
    mockApi([session(2, 1, 3, 0.8, 10), session(1, 2, 3, 0.7, 10)]);
    renderProgress("he");
    expect(await screen.findByText("מוקדם לדעת")).toBeInTheDocument();
    expect(screen.getByText(/מגמות יופיעו אחרי 3 מפגשים/)).toBeInTheDocument();
    expect(screen.getByText("רמת הקושי עדיין לא השתנתה. היא מתעדכנת אוטומטית כשלשלב בפרוטוקול יש כלל התקדמות.")).toBeInTheDocument();
  });

  it("lets a keyboard user step through the chart and hear each point", async () => {
    mockApi([session(3, 1, 2, 0.9, 9), session(2, 2, 2, 0.8, 9), session(1, 3, 2, 0.8, 9)]);
    renderProgress();
    const chart = await screen.findByRole("group", { name: /Trend chart/ });
    chart.focus();
    await userEvent.keyboard("{End}");
    expect(chart).toHaveTextContent("Score 113");
    expect(document.querySelector('[aria-live="polite"].emb-vh')).toHaveTextContent(/Session 3, .*Score 113, 90%, Difficulty 2/);
    await userEvent.keyboard("{Home}");
    expect(document.querySelector('[aria-live="polite"].emb-vh')).toHaveTextContent(/Session 1, .*Sets the baseline/);
  });
});

describe("Progress history and brain regions", () => {
  it("each session shows its region label", async () => {
    const { demoRegions } = await import("../src/demo/regions.ts");
    const withRegion = { ...session(2, 1, 2, 0.8, 9), hemisphere: "right", region: { path: "right.temporal.ba21", sublobe: "right.temporal.middle_temporal", drawn: false, revision: 1 } };
    const drawn = { ...session(1, 2, 2, 0.7, 9), hemisphere: "right", region: { path: "right.frontal", sublobe: "right.frontal.dlpfc", drawn: true, revision: 1 } };
    mockApi([withRegion, drawn]);
    const base = globalThis.fetch;
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
      if (url.pathname === "/v1/brain-regions") return new Response(JSON.stringify({ regions: demoRegions("en") }), { status: 200, headers: { "content-type": "application/json" } });
      return base(input, init);
    });
    renderProgress();
    const history = await screen.findByRole("list", { name: "Every game played, newest first" });
    expect(await within(history).findByText("Right · BA21")).toBeInTheDocument();
    expect(within(history).getByText("Right · Frontal lobe (DLPFC (dorsolateral prefrontal))")).toBeInTheDocument();
  });
});
