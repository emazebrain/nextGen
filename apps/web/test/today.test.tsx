/** Today answers "what next": who needs a look, how each patient is doing, and a reminder to set the kid-mode PIN. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { collapseRepeats } from "../src/lib/steps.ts";

const day = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const patient = (id: string, given_name: string, family_name: string) => ({ id, given_name, family_name, date_of_birth: "2019-03-02", status: "active", can_play: true });
const AMIT = { patient_id: "p2", given_name: "Amit", family_name: "Lavi", scores: [100, 80, 70], summary: "declining", week: { done: 1, planned: 4 }, difficulty: 3, last_change: "down", last_session_at: day(1), reasons: [{ kind: "missed_clinic", count: 2 }, { kind: "declining" }] };
const DANA = { patient_id: "p1", given_name: "Dana", family_name: "Katz", scores: [100, 120, 130], summary: "improving", week: { done: 2, planned: 3 }, difficulty: 4, last_change: "up", last_session_at: day(0), reasons: [] };

function mockApi(over: { caseload?: unknown[] | "fail" } = {}) {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/me") return ok({ user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: "therapist", clinic_name: "Clinic" }] });
    if (p === "/v1/patients") return ok({ data: [patient("p1", "Dana", "Katz"), patient("p2", "Amit", "Lavi"), patient("p3", "Eli", "Baron")] });
    if (p === "/v1/today") return ok({ items: [], appointments: [], review_count: 0 });
    if (p === "/v1/reports/caseload") return over.caseload === "fail" ? new Response("{}", { status: 500 }) : ok({ patients: over.caseload ?? [AMIT, DANA] });
    return ok({});
  });
}

function show() {
  const router = createMemoryRouter(routes, { initialEntries: ["/today"] });
  render(
    <PrefsProvider initialLocale="en">
      <QueryClientProvider client={makeQueryClient()}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </PrefsProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Today", () => {
  it("lists who needs attention, with the reasons, each row opening the patient's progress", async () => {
    mockApi();
    show();
    const card = within(await screen.findByRole("region", { name: /Needs attention/ }));
    expect(await card.findByText("2 clinic sessions missed")).toBeInTheDocument();
    expect(card.getByText("Below own earlier sessions")).toBeInTheDocument();
    expect(card.getByRole("link", { name: "Amit Lavi" })).toHaveAttribute("href", "/patients/p2/progress");
    expect(card.queryByText("Dana Katz")).toBeNull(); // no reason to look
  });

  it("says all caught up only when nobody needs a look", async () => {
    mockApi({ caseload: [DANA] });
    show();
    const card = within(await screen.findByRole("region", { name: /Needs attention/ }));
    expect(await card.findByText("You're all caught up.")).toBeInTheDocument();
  });

  it("does not claim all is well when the caseload could not be loaded", async () => {
    mockApi({ caseload: "fail" });
    show();
    const card = within(await screen.findByRole("region", { name: /Needs attention/ }));
    expect(await card.findByText("Not available right now.", {}, { timeout: 8000 })).toBeInTheDocument();
    expect(card.queryByText("You're all caught up.")).toBeNull();
  }, 12_000);

  it("shows how each patient is doing, most in need first", async () => {
    mockApi();
    show();
    const list = within(await screen.findByRole("region", { name: "Your patients" }));
    await list.findByText(/Improving · 2 of 3 this week/);
    const names = list.getAllByRole("link").map((a) => a.textContent).filter((n) => n !== "All patients");
    expect(names).toEqual(["Amit Lavi", "Dana Katz", "Eli Baron"]);
    expect(list.getByText(/Below earlier sessions · 1 of 4 this week · Last played yesterday/)).toBeInTheDocument();
    expect(list.getByText(/Improving · 2 of 3 this week · Last played today/)).toBeInTheDocument();
  });

  it("reminds the therapist to set the kid-mode PIN before the first session", async () => {
    mockApi();
    show();
    expect(await screen.findByRole("link", { name: "Set the PIN" })).toHaveAttribute("href", "/settings");
  });
});

describe("collapseRepeats", () => {
  it("shows a step played twice in a row once, with a count", () => {
    expect(collapseRepeats(["A", "A", "B", "A"])).toEqual(["A ×2", "B", "A"]);
    expect(collapseRepeats([])).toEqual([]);
  });
});
