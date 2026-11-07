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
    const next = await screen.findByRole("region", { name: "Next up" });
    await waitFor(() => expect(next.textContent).toContain("Noa Levi"));
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
