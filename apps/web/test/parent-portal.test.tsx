/** The parent portal: who you are with, a way out, messages, and results a parent can read. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

const at = (d: number) => new Date(Date.now() - d * 86_400_000).toISOString();
const ymd = (d: number) => new Date(Date.now() + d * 86_400_000).toLocaleDateString("en-CA");
/** Synthetic sessions of one game at one difficulty: accuracy rising or falling against the first two. */
const session = (i: number, accuracy: number) => ({
  id: `s${i}`, game_id: "catch-me-if-you-can", game_version: "1.0.0", assignment_id: "a1", assignment_name: "Visual attention starter", planned_session_id: null,
  difficulty: 2, hemisphere: "right", status: "completed", end_reason: "lives_out", started_at: at(20 - i), ended_at: at(20 - i), active_ms: 300_000,
  accuracy, rt_median_ms: 640, score: 100, metrics: {}, counts: true, mode: "timed_lives", monochrome: false,
});
const RISING = [0.5, 0.5, 0.62, 0.7, 0.78, 0.84].map((a, i) => session(i, a));
const FALLING = [0.9, 0.9, 0.7, 0.6, 0.5, 0.45].map((a, i) => session(i, a));

function mockApi(over: { sessions?: unknown[]; unread?: number; nothingLeft?: boolean } = {}) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const p = url.pathname;
    calls.push(`${init?.method ?? "GET"} ${p}`);
    const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    // The staff API refuses a guardian: they sign in without two-step sign-in.
    if (!p.startsWith("/v1/parent/")) return new Response(JSON.stringify({ error: "mfa_required" }), { status: 403, headers: { "content-type": "application/json" } });
    if (p === "/v1/parent/me")
      return ok({
        user: { id: "u", email: "dan@synthetic.test", name: "Dan Navon" },
        guardians: [{ id: "g1", full_name: "Dan Navon", email: "dan@synthetic.test", phone: null, preferred_locale: "en", has_pin: true }],
        children: [{ id: "c1", given_name: "Ella", family_name: "Navon", date_of_birth: "2019-05-26", status: "active", preferred_locale: "en", relationship: "parent", clinic_name: "Synthetic Clinic" }],
      });
    if (p === "/v1/parent/messages/threads") return ok({ threads: [{ id: "t1", patient_id: "c1", therapist_id: "th", guardian_id: "g1", status: "open", last_message_at: at(0), created_at: at(3), patient_given_name: "Ella", patient_family_name: "Navon", guardian_name: "Dan Navon", therapist_name: "Yael Bar", unread_count: over.unread ?? 2 }] });
    if (p.endsWith("/progress")) return ok({ patient: { id: "c1", given_name: "Ella", family_name: "Navon", status: "active" }, stats: { total_sessions: 6, last_session: at(1) }, protocols: [] });
    if (p.endsWith("/history")) return ok({ sessions: over.sessions ?? RISING });
    if (p.endsWith("/launch")) return ok({ launch: { planned_session_id: "ps1", seq: 4, week: 2, total: 8, patient: { id: "c1", given_name: "Ella", family_name: "Navon", preferred_locale: "en", alert: null }, assignment: { id: "a1", name: "Visual attention starter" }, steps: [{ kind: "video", assignment_step_id: "st1", ordinal: 1, done: !!over.nothingLeft, video: { id: "v1", version: 1, source: "youtube", youtube_id: "aaaaaaaaaaa", duration_s: 60, title: "Warm-up stretches", file_url: null, sha256: null } }] } });
    if (p.endsWith("/sessions")) {
      const items = [{ kind: "video", video_id: "v1", title: "Warm-up stretches" }, { kind: "game", game_id: "catch-me-if-you-can" }];
      const base = { status: "planned", assignment_id: "a1", assignment_name: "Visual attention starter", total: 8, items };
      return ok({
        upcoming: [
          { ...base, id: "ps1", seq: 4, week: 2, planned_date: ymd(2), location: "home", startable: true },
          { ...base, id: "ps2", seq: 5, week: 3, planned_date: ymd(4), location: "clinic", setting: "clinic", startable: false },
          { ...base, id: "ps3", seq: 6, week: 3, planned_date: ymd(6), location: "home", startable: false },
        ],
        recent: [],
      });
    }
    if (p.endsWith("/appointments"))
      return ok({ appointments: [{ id: "ap2", date: ymd(2), start_time: "10:00", end_time: "10:45", title: "", clinic_name: "Synthetic Clinic" }, { id: "ap1", date: ymd(1), start_time: "09:00", end_time: "09:30", title: "First visit", clinic_name: "Synthetic Clinic" }] });
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

  it("shows the clinic's appointments on the calendar with the home sessions, in date order, to read only", async () => {
    const calls = mockApi();
    show("/parent/calendar");
    const first = await screen.findByText("First visit");
    const items = [...first.closest("ul")!.children] as HTMLElement[]; // the top-level rows, not the steps inside a session
    expect(items).toHaveLength(5);
    expect(items[0]).toHaveTextContent(/First visit.*9:00.*9:30.*at .?Synthetic Clinic/);
    // The same day: the appointment (it has a time) before the home session; an untitled one is called "Appointment".
    expect(items[1]).toHaveTextContent(/Appointment.*10:00.*10:45/);
    expect(items[2]).toHaveTextContent(/Visual attention starter.*Home session/);
    // Nothing on the page sets or changes an appointment (the only button starts the next home session), and
    // nothing was sent but reads.
    expect(within(first.closest("section")!).queryAllByRole("button").map((b) => b.textContent)).toEqual(["Start"]);
    for (const row of items.slice(0, 2)) expect(within(row).queryAllByRole("button")).toHaveLength(0);
    expect(calls.filter((c) => !c.startsWith("GET "))).toEqual([]);
    expect(screen.getByText(/The clinic sets appointments/)).toBeInTheDocument();
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

  it("opens a child from their name and shows each session's game-based activities and videos", async () => {
    mockApi();
    show("/parent");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("link", { name: "Ella Navon" }));
    expect(await screen.findByRole("heading", { level: 1, name: "Ella Navon" })).toBeInTheDocument();
    // One session at a time, opening on the one to start: its contents and the only Start button.
    expect(await screen.findByText("Warm-up stretches")).toBeInTheDocument();
    expect(screen.getByText("Catch Me If You Can")).toBeInTheDocument();
    expect(screen.getAllByText("Visual attention starter")).toHaveLength(1);
    expect(screen.getByText("1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous session" })).toBeDisabled();
    // The arrows look ahead: the clinic session and the later one have no Start, and say why.
    await user.click(screen.getByRole("button", { name: "Next session" }));
    expect(screen.getByText("2 of 3")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start" })).toBeNull();
    expect(screen.getByText(/set for the clinic/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next session" }));
    expect(screen.getByText("Opens when the session before it is done")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next session" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Back to the one to start" }));
    expect(screen.getByRole("button", { name: "Start" })).toBeInTheDocument();
  });

  it("starts the next home session from the kids page even before its planned day, and stays in the player", async () => {
    const calls = mockApi();
    const router = show("/parent");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(calls).toContain("POST /v1/parent/children/c1/sessions/ps1/launch");
    // The player opens for the guardian on the portal's own route and goes straight into the first step:
    // no hand-off screen, no PIN, and no staff sign-in involved.
    await waitFor(() => expect(router.state.location.pathname).toBe("/parent/session/ps1"));
    expect(await screen.findByTitle("Warm-up stretches")).toBeInTheDocument();
    expect(screen.queryByText(/PIN/i)).toBeNull();
    expect(screen.queryByText(/Ready for/)).toBeNull();
    expect(calls.filter((c) => !c.includes("/v1/parent/"))).toEqual([]);
  });

  it("when the session ends the guardian is taken back to the list of kids, without a PIN", async () => {
    mockApi({ nothingLeft: true });
    const router = show("/parent");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Start" }));
    expect(await screen.findByText(/Well done/)).toBeInTheDocument();
    expect(screen.queryByText(/PIN/i)).toBeNull();
    await waitFor(() => expect(router.state.location.pathname).toBe("/parent"), { timeout: 5000 });
    expect(await screen.findByRole("link", { name: "Ella Navon" })).toBeInTheDocument();
  });

  it("a guardian who opens a session address directly goes back to the portal", async () => {
    mockApi();
    const router = show("/parent/session/ps1");
    expect(await screen.findByRole("link", { name: "Ella Navon" })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/parent");
  });

  it("shows what is in a session on the calendar, with Start for the one that is next", async () => {
    mockApi();
    show("/parent/calendar");
    expect((await screen.findAllByText(/Warm-up stretches → Catch Me If You Can/)).length).toBe(3);
    expect(screen.getAllByRole("button", { name: "Start" })).toHaveLength(1);
  });
});
