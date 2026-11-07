/** Reading from the device when there's no connection (offline devices spec §7.3, §5.3 offline banner). */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import type { OfflineBundle } from "@emb/contracts";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { DeviceProvider } from "../src/device/session.tsx";
import { createSpace, listSpaces, removeSpace, unlockWithPassword, type OpenSpace } from "../src/device/spaces.ts";
import { refreshBundle } from "../src/device/bundle.ts";
import { openDB } from "idb";

const today = new Date().toISOString().slice(0, 10);
const secret = (n: number) => new Uint8Array(32).fill(n);
const space = (id: string, name: string) => ({ id, user_id: `u-${id}`, display_name: name, clinic_id: "c1", clinic_name: "Tel Aviv", last_online_at: new Date().toISOString() });

const bundle = (over: Partial<OfflineBundle> = {}): OfflineBundle => ({
  generated_at: `${today}T08:42:00.000Z`,
  me: { user: { id: "u-a", email: "tamar@synthetic.test", name: "Tamar Golan" }, memberships: [{ clinic_id: "c1", organization_id: "o1", role: "therapist", clinic_name: "Tel Aviv" }] },
  today: [],
  caseload: [{ id: "p1", clinic_id: "c1", given_name: "Noa", family_name: "Levi", date_of_birth: "2018-03-01", status: "active", has_alert: false, archived: false }],
  patients: {},
  templates: [],
  assignments: [],
  packages: [
    {
      planned_session_id: "ps1", planned_date: today, seq: 2, week: 1, total: 8,
      patient: { id: "p1", given_name: "Noa", family_name: "Levi", preferred_locale: "en", alert: null },
      assignment: { id: "as1", name: "Attention", weeks: 4 } as never,
      steps: [
        { kind: "game", assignment_step_id: "st1", ordinal: 1, game_id: "tunnel-rush", ticket: "t", allowed: { exact: {}, difficulty: { min: 1, max: 5 } }, base_params: {}, practice_setting: "off", sessions_completed: 1, progression: null, difficulty: 2, history: [], done: false },
        { kind: "video", assignment_step_id: "st2", ordinal: 2, video: { id: "v1", version: 2, source: "upload", youtube_id: null, title: "Colour shapes", duration_s: 10, file_url: "/v1/videos/v1/file?v=2", sha256: "ab" }, done: false },
      ],
    },
  ],
  videos: [],
  ended_spaces: [],
  ...over,
});

async function openTamar(): Promise<OpenSpace> {
  await createSpace(space("a", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
  const s = (await unlockWithPassword("a", "tablet42!")) as OpenSpace;
  await s.write("me", bundle().me);
  await s.write("bundle", bundle());
  await s.write("bundle_at", `${today}T08:42:00.000Z`);
  return s;
}

async function renderAndUnlock(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(
    <PrefsProvider initialLocale="en">
      <DeviceProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </DeviceProvider>
    </PrefsProvider>,
  );
  await userEvent.type(await screen.findByLabelText("Offline password", {}, { timeout: 8000 }), "tablet42!");
  await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
  return router;
}

describe("offline data", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    for (const s of await listSpaces()) await removeSpace(s.id);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offline, Today shows the saved sessions with the saved-data banner", async () => {
    await openTamar();
    await renderAndUnlock("/today");
    const next = await screen.findByRole("region", { name: "Next up" }, { timeout: 5000 });
    await waitFor(() => expect(next.textContent).toContain("Noa Levi"), { timeout: 5000 });
    expect(next.textContent).toContain("Tunnel Rush → ▶ Colour shapes");
    expect(screen.getByRole("status").textContent).toMatch(/Showing saved data from/);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toMatch(/Tamar/);
  });

  it("offline, the app stays up instead of looping on failed requests", async () => {
    await openTamar();
    const calls = vi.fn(async () => {
      throw new TypeError("offline");
    });
    vi.stubGlobal("fetch", calls);
    const online = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    await renderAndUnlock("/today");
    await screen.findByRole("region", { name: "Next up" });
    const before = calls.mock.calls.length;
    await new Promise((r) => setTimeout(r, 1500));
    expect(calls.mock.calls.length - before).toBeLessThan(5);
    expect(screen.queryByText("Loading…")).toBeNull();
    online.mockRestore();
  });

  it("back online with another therapist's cookie, the open space is locked and nothing is copied into it", async () => {
    await openTamar();
    await renderAndUnlock("/today");
    await screen.findByRole("region", { name: "Next up" });
    // The network returns, and the browser still holds Oren's session from this morning.
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      calls.push(url);
      const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
      if (url.includes("/v1/me")) return json({ user: { id: "u-oren", email: "oren@synthetic.test", name: "Oren Katz" }, memberships: [{ clinic_id: "c1", organization_id: "o1", role: "therapist", clinic_name: "Tel Aviv" }] });
      if (url.includes("/v1/today")) return json({ items: [{ planned_session_id: "x", planned_date: today, seq: 1, week: 1, total: 4, patient: { id: "p9", given_name: "Shai", family_name: "Paz", date_of_birth: "2018-01-01", alert: null, can_play: true }, assignment: { id: "a9", name: "X", weeks: 2 }, games: [], items: [] }], review_count: 0 });
      return json({});
    }));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" }, { timeout: 8000 })).toBeTruthy();
    expect(screen.queryByText(/Shai Paz/)).toBeNull();
    expect(calls.some((u) => u.includes("sign-out"))).toBe(true);
    // Tamar's space is still on the device, and holds no copy of anything fetched with Oren's session.
    expect((await listSpaces()).map((s) => s.id)).toEqual(["a"]);
    const db = await openDB("emb.space.a.v1");
    const keys = (await db.getAllKeys("records")).map(String);
    db.close();
    expect(keys.filter((k) => k.startsWith("q:"))).toEqual([]);
  }, 20_000);

  it("back online with an expired cookie, it asks to sign in and keeps the space open", async () => {
    await openTamar();
    await renderAndUnlock("/today");
    await screen.findByRole("region", { name: "Next up" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: { "content-type": "application/json" } })));
    window.dispatchEvent(new Event("offline"));
    window.dispatchEvent(new Event("online"));
    expect(await screen.findByRole("heading", { level: 1, name: "Sign in" }, { timeout: 8000 })).toBeTruthy();
    expect((await listSpaces()).map((s) => s.id)).toEqual(["a"]);
  }, 20_000);

  it("Wi-Fi without Internet: starting from the device's package still checks the video is here", async () => {
    await openTamar(); // its package has an uploaded video that this device never downloaded
    await renderAndUnlock("/session/ps1"); // the browser reports online; every request fails
    expect(await screen.findByText("One step isn't on this device:", {}, { timeout: 8000 })).toBeTruthy();
  }, 20_000);

  it("offline, editing a protocol is disabled and says it needs a connection", async () => {
    await openTamar();
    await renderAndUnlock("/protocols/new");
    const save = await screen.findByRole("button", { name: "Save template" });
    expect(save).toBeDisabled();
    expect(screen.getByText(/Needs a connection/)).toBeTruthy();
  });

  it("a refresh removes spaces the server reports as ended", async () => {
    const tamar = await openTamar();
    await createSpace(space("b", "Oren Katz"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(bundle({ ended_spaces: ["b"] })), { status: 200, headers: { "content-type": "application/json" } })));
    await refreshBundle(tamar, "dev1", "en", { syncVideos: false });
    expect((await listSpaces()).map((s) => s.id)).toEqual(["a"]);
    expect((await tamar.read<OfflineBundle>("bundle"))?.ended_spaces).toEqual(["b"]);
  });
});
