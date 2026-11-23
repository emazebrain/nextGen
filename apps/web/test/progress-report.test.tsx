/** Progress reports: issuing one with a written summary, the printable document, and the family's view. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

const DATA = {
  patient: { given_name: "Dana", family_name: "Katz", date_of_birth: "2018-03-01" },
  clinic: { name: "Haifa Clinic", address: "1 Example St", phone: "+972 3 000 0000", license_no: "LIC-0001" },
  author: { name: "Yael Bar" },
  totals: { sessions: 4, minutes: 40, days_active: 4, clinic_sessions: 3, home_sessions: 1 },
  plan: { planned: 5, done: 4, missed: 1 },
  activities: [{ game_id: "tunnel-rush", sessions: 4, avg_accuracy: 0.625, first_difficulty: 2, last_difficulty: 3 }],
  trend: { summary: "improving", points: [110, 120, 130, 140].map((score, i) => ({ ended_at: `2026-11-0${i + 1}T10:00:00.000Z`, score })) },
  changes: [{ decided_at: "2026-11-03T10:00:00.000Z", game_id: "tunnel-rush", action: "up", from: 2, to: 3 }],
};
const REPORT = { id: "r1", patient_id: "p1", created_at: "2026-11-23T09:00:00.000Z", period_from: "2026-10-24", period_to: "2026-11-23", audience: "formal", locale: "en", shared_with_family: false, author_name: "Yael Bar", summary: "Dana took part in every planned session.", data: DATA };

interface Call {
  method: string;
  path: string;
  body: any;
}
function mockApi(report: Record<string, unknown> = REPORT) {
  const calls: Call[] = [];
  let current = { ...report };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, body });
    const ok = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/me") return ok({ user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: "therapist", clinic_name: "Clinic" }] });
    if (p === "/v1/patients/p1/progress-reports" && method === "POST") {
      current = { ...current, ...body, period_from: body.from, period_to: body.to };
      return ok({ report: current }, 201);
    }
    if (p === "/v1/progress-reports/r1" && method === "PATCH") {
      current = { ...current, ...body };
      return ok({ report: current });
    }
    if (p === "/v1/progress-reports/r1") return ok({ report: current });
    if (p === "/v1/parent/me") return ok({ user: { id: "g", email: "m@synthetic.test", name: "Miri Katz" }, guardians: [], children: [{ id: "p1", given_name: "Dana", family_name: "Katz", date_of_birth: "2018-03-01", status: "active", preferred_locale: "he", relationship: "mother", clinic_name: "Haifa Clinic" }] });
    if (p === "/v1/parent/reports/r1") return ok({ report: { ...current, shared_with_family: true } });
    return ok({});
  });
  return calls;
}

function show(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <PrefsProvider initialLocale="en">
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

describe("progress reports", () => {
  it("issues a report with the therapist's summary, then opens it", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    const router = show("/patients/p1/reports/new");
    await user.type(await screen.findByLabelText("Your summary"), "Dana took part in every planned session.");
    await user.click(screen.getByRole("radio", { name: "Insurance or records" }));
    await user.click(screen.getByRole("radio", { name: "English" }));
    await user.click(screen.getByRole("checkbox", { name: /Show this report to the family/ }));
    await user.click(screen.getByRole("button", { name: "Create report" }));

    await waitFor(() => expect(router.state.location.pathname).toBe("/patients/p1/reports/r1"));
    const sent = calls.find((c) => c.method === "POST")!;
    expect(sent.body).toMatchObject({ audience: "formal", locale: "en", summary: "Dana took part in every planned session.", shared_with_family: true });
    expect(sent.body.from < sent.body.to).toBe(true);
    expect(await screen.findByRole("heading", { name: "Progress report" })).toBeInTheDocument();
  });

  it("refuses a period that ends before it starts, without asking the server", async () => {
    const calls = mockApi();
    const user = userEvent.setup();
    show("/patients/p1/reports/new");
    const from = await screen.findByLabelText("From");
    await user.clear(from);
    await user.type(from, "2030-01-01");
    await user.click(screen.getByRole("button", { name: "Create report" }));
    expect(await screen.findByText(/start date on or before the end date/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("shows the document: letterhead, summary, figures, activities, changes and a signature line", async () => {
    mockApi();
    show("/patients/p1/reports/r1");
    const doc = within(await screen.findByRole("article"));
    expect(doc.getByText("Haifa Clinic")).toBeInTheDocument();
    expect(doc.getByText("LIC-0001")).toBeInTheDocument();
    expect(doc.getByText("Dana Katz")).toBeInTheDocument();
    expect(doc.getByRole("heading", { name: "Therapist's summary" })).toBeInTheDocument();
    expect(doc.getByText("Dana took part in every planned session.")).toBeInTheDocument();
    expect(doc.getByText("4 of 5")).toBeInTheDocument();
    expect(doc.getByRole("rowheader", { name: "Tunnel Rush" })).toBeInTheDocument();
    expect(doc.getByText("63%")).toBeInTheDocument();
    expect(doc.getByText("2 → 3")).toBeInTheDocument();
    expect(doc.getByText(/recent results are above their own earlier sessions/)).toBeInTheDocument();
    expect(doc.getByRole("img", { name: /100 is .Dana.'s own starting level/ })).toBeInTheDocument();
    expect(doc.getByText(/Tunnel Rush moved up from level 2 to 3/)).toBeInTheDocument();
    expect(doc.getByText("Signature")).toBeInTheDocument();
    expect(doc.getByText(/does not state clinical conclusions/)).toBeInTheDocument();
  });

  it("prints from the button, and shares with the family on request", async () => {
    const calls = mockApi();
    const print = vi.fn();
    vi.stubGlobal("print", print);
    const user = userEvent.setup();
    show("/patients/p1/reports/r1");
    await user.click(await screen.findByRole("button", { name: "Print or save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);

    expect(screen.getByText("Not shared")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Share with the family" }));
    expect(await screen.findByRole("button", { name: "Stop sharing" })).toBeInTheDocument();
    expect(calls.find((c) => c.method === "PATCH")!.body).toEqual({ shared_with_family: true });
  });

  it("writes the document in its own language and direction, whatever the app's language", async () => {
    mockApi({ ...REPORT, locale: "he", audience: "family" });
    show("/patients/p1/reports/r1");
    const article = await screen.findByRole("article");
    expect(article).toHaveAttribute("dir", "rtl");
    expect(article).toHaveAttribute("lang", "he");
    expect(within(article).getByRole("heading", { name: "דוח התקדמות" })).toBeInTheDocument();
    // The family version carries no licence number and no signature line.
    expect(within(article).queryByText("LIC-0001")).toBeNull();
    expect(within(article).queryByText("חתימה")).toBeNull();
    // The app's own controls stay in the reader's language.
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeInTheDocument();
  });

  it("the family opens a shared report in the parent portal", async () => {
    mockApi();
    show("/parent/reports/r1");
    expect(await screen.findByRole("article")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Print or save as PDF" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share with the family" })).toBeNull();
  });
});
