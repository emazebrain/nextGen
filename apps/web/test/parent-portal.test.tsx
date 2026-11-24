/** The parent portal: who you are with, a way out, messages, and results a parent can read. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
/** Synthetic sessions of one game at one difficulty: accuracy rising or falling against the first two. */
const session = (i: number, accuracy: number) => ({
  id: `s${i}`, game_id: "catch-me-if-you-can", game_version: "1.0.0", assignment_id: "a1", assignment_name: "Visual attention starter", planned_session_id: null,
  difficulty: 2, hemisphere: "right", status: "completed", end_reason: "lives_out", started_at: at(20 - i), ended_at: at(20 - i), active_ms: 300_000,
  accuracy, rt_median_ms: 640, score: 100, metrics: {}, counts: true, mode: "timed_lives", monochrome: false,
});
const RISING = [0.5, 0.5, 0.62, 0.7, 0.78, 0.84].map((a, i) => session(i, a));
const FALLING = [0.9, 0.9, 0.7, 0.6, 0.5, 0.45].map((a, i) => session(i, a));

function mockApi(over: { sessions?: unknown[]; unread?: number } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const p = url.pathname;
    calls.push(`${init?.method ?? "GET"} ${p}`);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    if (p === "/v1/parent/me")
      return ok({
        user: { id: "u", email: "dan@synthetic.test", name: "Dan Navon" },
        guardians: [{ id: "g1", full_name: "Dan Navon", email: "dan@synthetic.test", phone: null, preferred_locale: "en", has_pin: true }],
        children: [{ id: "c1", given_name: "Ella", family_name: "Navon", date_of_birth: "2019-05-26", status: "active", preferred_locale: "en", relationship: "parent", clinic_name: "Synthetic Clinic" }],
      });
    if (p === "/v1/parent/messages/threads") return ok({ threads: [{ id: "t1", patient_id: "c1", therapist_id: "th", guardian_id: "g1", status: "open", last_message_at: at(0), created_at: at(3), patient_given_name: "Ella", patient_family_name: "Navon", guardian_name: "Dan Navon", therapist_name: "Yael Bar", unread_count: over.unread ?? 2 }] });
    if (p.endsWith("/progress")) return ok({ patient: { id: "c1", given_name: "Ella", family_name: "Navon", status: "active" }, stats: { total_sessions: 6, last_session: at(1) }, protocols: [] });
    if (p.endsWith("/history")) return ok({ sessions: over.sessions ?? RISING });
    if (p.endsWith("/sessions")) return ok({ upcoming: [], recent: [] });
    if (p.endsWith("/reports")) return ok({ reports: [] });
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

describe("parent portal", () => {
  it("names the clinic and offers the other language and a way to sign out", async () => {
    mockApi();
    const user = userEvent.setup();
    show("/parent");
    await screen.findByText("Synthetic Clinic");
    const header = within(document.querySelector<HTMLElement>(".parent-shell__header")!);
    expect(header.getByText("Synthetic Clinic")).toBeInTheDocument();
    expect(header.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
    await user.click(header.getByRole("button", { name: "עברית" }));
    expect(await screen.findByRole("button", { name: "English" })).toBeInTheDocument();
  });

  it("has a Messages tab that shows how many are unread, and opens the conversation list", async () => {
    mockApi({ unread: 2 });
    const user = userEvent.setup();
    const router = show("/parent");
    const tab = await screen.findByRole("link", { name: /Messages.*2 unread/ });
    await user.click(tab);
    expect(router.state.location.pathname).toBe("/parent/messages");
    expect(await screen.findByRole("button", { name: /Yael Bar/ })).toBeInTheDocument();
  });

  it("shows results in a parent's words, without the clinic-side columns", async () => {
    mockApi();
    show("/parent/results");
    expect((await screen.findAllByText(/Correct answers/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Activity/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 min").length).toBeGreaterThan(0);
    expect(screen.queryByText(/Out of hearts|Difficulty|Reaction/)).toBeNull();
  });

  it("tells the parent when it is going better than the first sessions", async () => {
    mockApi({ sessions: RISING });
    show("/parent/results");
    expect(await screen.findByText("Ella is doing better than in their first sessions.")).toBeInTheDocument();
  });

  it("says nothing about the trend when results are lower: that is for the therapist to explain", async () => {
    mockApi({ sessions: FALLING });
    show("/parent/results");
    await screen.findAllByText(/Correct answers/);
    expect(screen.queryByText(/first sessions/)).toBeNull();
  });
});
