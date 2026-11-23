/** Reports, caseload first: who is worth a look, how each patient is doing, and whether the plan is followed. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider, type Locale } from "../src/i18n/index.tsx";

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const DANA = { patient_id: "p1", given_name: "Dana", family_name: "Katz", scores: [100, 100, 110, 120, 130, 140], summary: "improving", week: { done: 2, planned: 3 }, difficulty: 4, last_change: "up", last_session_at: day(0), reasons: [] };
const AMIT = {
  patient_id: "p2",
  given_name: "Amit",
  family_name: "Lavi",
  scores: [100, 100, 75, 69, 63],
  summary: "declining",
  week: { done: 1, planned: 4 },
  difficulty: 3,
  last_change: "down",
  last_session_at: day(1),
  reasons: [{ kind: "review", count: 1 }, { kind: "missed_home", count: 2 }, { kind: "declining" }, { kind: "stepped_down" }],
};
const ELI = { patient_id: "p3", given_name: "Eli", family_name: "Baron", scores: [100], summary: "not_enough", week: { done: 0, planned: 0 }, difficulty: 2, last_change: null, last_session_at: day(20), reasons: [{ kind: "inactive", days: 20 }] };

const OVERVIEW = {
  sessions: 12,
  sessions_this_week: 11,
  active_patients: 3,
  in_care: 3,
  avg_duration_ms: 600_000,
  plan_followed: 0.5,
  weekly: [0, 0, 0, 1, 0, 11].map((sessions, i) => ({ week_start: `2026-10-${10 + i}`, sessions, avg_duration_ms: sessions ? 600_000 : null })),
};
const ADHERENCE = { weeks: [1, 2, 3, 4, 5, 6].map((n) => ({ week_start: `2026-10-${10 + n}`, planned: n + 2, done_clinic: n, done_home: 1 })) };

function mockApi(over: { patients?: unknown[]; overview?: Record<string, unknown> } = {}) {
  const paths: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    paths.push(url.pathname + url.search);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/me") return ok({ user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: "therapist", clinic_name: "Clinic" }] });
    if (p === "/v1/reports/caseload") return ok({ patients: over.patients ?? [AMIT, ELI, DANA] });
    if (p === "/v1/reports/overview") return ok({ ...OVERVIEW, ...over.overview });
    if (p === "/v1/reports/adherence") return ok(ADHERENCE);
    if (p === "/v1/reports/activity-breakdown") return ok({ data: [{ game_id: "tunnel-rush", count: 8, avg_accuracy: 0.81 }, { game_id: "picture-trail", count: 4, avg_accuracy: 0.74 }] });
    return ok({});
  });
  return paths;
}

function show(locale: Locale = "en") {
  const router = createMemoryRouter(routes, { initialEntries: ["/reports"] });
  render(
    <PrefsProvider initialLocale={locale}>
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PrefsProvider>,
  );
  return router;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Reports", () => {
  it("lists the patients worth a look, each with its reasons and a way in", async () => {
    mockApi();
    show();
    const look = within(await screen.findByRole("region", { name: /Worth a look/ }));
    const items = look.getAllByRole("listitem");
    expect(items).toHaveLength(2); // Dana has no reason to be here
    const amit = within(items[0]!);
    expect(amit.getByText("Amit Lavi")).toBeInTheDocument();
    expect(amit.getByText("1 result waiting for review")).toBeInTheDocument();
    expect(amit.getByText("2 home sessions missed")).toBeInTheDocument();
    expect(amit.getByText("Below own earlier sessions")).toBeInTheDocument();
    expect(amit.getByText("Difficulty stepped down twice")).toBeInTheDocument();
    expect(amit.getByRole("link", { name: /^Review results for .Amit Lavi.$/ })).toHaveAttribute("href", "/patients/p2/progress");
    const eli = within(items[1]!);
    expect(eli.getByText("No sessions for 20 days")).toBeInTheDocument();
    expect(eli.getByRole("link", { name: /^Open .Eli Baron.$/ })).toHaveAttribute("href", "/patients/p3/progress");
  });

  it("shows one caseload row per patient and sorts by a column on request", async () => {
    mockApi();
    const user = userEvent.setup();
    show();
    const table = within(await screen.findByRole("table", { name: "Caseload" }));
    const names = () => table.getAllByRole("row").slice(1).map((r) => within(r).getByRole("link").textContent);
    expect(names()).toEqual(["Amit Lavi", "Eli Baron", "Dana Katz"]); // as the server ordered them
    const dana = within(table.getByRole("row", { name: /Dana Katz/ }));
    expect(dana.getByText("Improving")).toBeInTheDocument();
    expect(dana.getByText("2 of 3")).toBeInTheDocument();
    expect(dana.getByRole("img", { name: /last 6 sessions/ })).toBeInTheDocument();
    expect(dana.getByRole("link", { name: "Dana Katz" })).toHaveAttribute("href", "/patients/p1/progress");
    expect(within(table.getByRole("row", { name: /Eli Baron/ })).getByText("Not enough sessions yet")).toBeInTheDocument();
    expect(within(table.getByRole("row", { name: /Amit Lavi/ })).getByText("Below earlier sessions")).toBeInTheDocument();

    await user.click(table.getByRole("button", { name: "Sort by Patient" }));
    expect(names()).toEqual(["Amit Lavi", "Dana Katz", "Eli Baron"]);
    await user.click(table.getByRole("button", { name: "Sort by Patient" }));
    expect(names()).toEqual(["Eli Baron", "Dana Katz", "Amit Lavi"]);
    await user.click(table.getByRole("button", { name: "Sort by Last session" }));
    expect(names()).toEqual(["Dana Katz", "Amit Lavi", "Eli Baron"]); // most recent first
  });

  it("shows the totals, and asks again when the date range changes", async () => {
    const paths = mockApi();
    const user = userEvent.setup();
    show();
    const tiles = within(await screen.findByRole("region", { name: "Summary" }));
    expect(tiles.getByText("12")).toBeInTheDocument();
    expect(tiles.getByText("11 in the last 7 days")).toBeInTheDocument();
    expect(tiles.getByText("of 3 patients")).toBeInTheDocument();
    expect(tiles.getByText("50%")).toBeInTheDocument();
    expect(tiles.getByText("10 min")).toBeInTheDocument();
    expect(paths).toContain("/v1/reports/overview?clinic=c1&days=30");

    await user.selectOptions(screen.getByLabelText("Date range"), "7");
    await waitFor(() => expect(paths).toContain("/v1/reports/overview?clinic=c1&days=7"));
  });

  it("draws the plan chart and the activity mix", async () => {
    mockApi();
    show();
    expect(await screen.findByRole("img", { name: "Sessions planned and done per week" })).toBeInTheDocument();
    const acts = within(screen.getByRole("region", { name: "Game-based activities" }));
    expect(await acts.findByText("Tunnel Rush")).toBeInTheDocument();
    expect(acts.getByText("81%")).toBeInTheDocument();
  });

  it("says so when nobody needs a look, and when there is nothing to report yet", async () => {
    mockApi({ patients: [DANA] });
    show();
    expect(await screen.findByText("Nothing needs a look right now.")).toBeInTheDocument();
    cleanup();

    mockApi({ patients: [], overview: { sessions: 0, sessions_this_week: 0, active_patients: 0, in_care: 0, avg_duration_ms: null, plan_followed: null } });
    show();
    expect(await screen.findByText(/No session data yet/)).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Caseload" })).toBeNull();
  });

  it("reads in Hebrew, with plurals", async () => {
    mockApi();
    show("he");
    expect(await screen.findByText("2 מפגשי בית הוחמצו")).toBeInTheDocument();
    expect(screen.getByText("אין מפגשים כבר 20 ימים")).toBeInTheDocument();
  });
});
