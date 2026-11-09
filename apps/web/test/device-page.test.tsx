/** The Device page and result review (offline devices spec §7.4, §7.6). */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router";
import type { GameSessionView } from "@emb/contracts";
import { makeQueryClient } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { ClinicProvider } from "../src/lib/clinic.tsx";
import { DeviceProvider } from "../src/device/session.tsx";
import { DevicePage } from "../src/routes/device.tsx";
import { ReviewCell } from "../src/routes/patients/progress.tsx";
import { createSpace, listSpaces, removeSpace } from "../src/device/spaces.ts";
import { getContentMode } from "../src/device/content.ts";
import { deviceDb, setMeta } from "../src/device/db.ts";

const secret = (n: number) => new Uint8Array(32).fill(n);
const space = (id: string, userId: string, name: string) => ({ id, user_id: userId, display_name: name, clinic_id: "c1", clinic_name: "Tel Aviv", last_online_at: new Date().toISOString() });
const reply = (status: number, body: unknown) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Call = { url: string; method: string };
function api(routes: Record<string, unknown>, calls: Call[] = []) {
  routes = { "/v1/me": { user: { id: "u-me", email: "tamar@synthetic.test", name: "Tamar Golan" }, memberships: [] }, ...routes };
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method });
    const key = Object.keys(routes).find((k) => url.startsWith(k));
    if (method === "DELETE") return reply(204, null);
    return key ? reply(200, routes[key]) : reply(404, { error: "not_found" });
  }));
  return calls;
}

function renderPage(role: "therapist" | "clinic_manager", node = <DevicePage />) {
  const me = { user: { id: "u-me", email: "tamar@synthetic.test", name: "Tamar Golan" }, memberships: [{ clinic_id: "c1", organization_id: "o1", role, clinic_name: "Tel Aviv" }] };
  return render(
    <PrefsProvider initialLocale="en">
      <DeviceProvider>
        <QueryClientProvider client={makeQueryClient()}>
          <ClinicProvider memberships={me.memberships as never}>
            <MemoryRouter>{node}</MemoryRouter>
          </ClinicProvider>
        </QueryClientProvider>
      </DeviceProvider>
    </PrefsProvider>,
  );
}

describe("device page", () => {
  beforeEach(async () => {
    for (const s of await listSpaces()) await removeSpace(s.id);
    const db = await deviceDb();
    await db.clear("meta");
    await setMeta("device_id", "dev-1");
    await createSpace(space("s-me", "u-me", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    await createSpace(space("s-oren", "u-oren", "Oren Katz"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("switching to play from the network keeps games and says videos will stream", async () => {
    api({ "/v1/offline/library": { videos: [] }, "/v1/devices/dev-1/spaces": [] });
    await setMeta("content_mode", "local");
    renderPage("therapist");
    await userEvent.click(await screen.findByRole("radio", { name: /Play from the network/ }));
    expect(await screen.findByText("Games stay on this device. Videos stream when they play.")).toBeTruthy();
    await waitFor(async () => expect(await getContentMode()).toBe("network"));
  });

  it("Download everything shows its size and asks first", async () => {
    const calls = api({
      "/v1/offline/library": { videos: [{ id: "v1", version: 1, sha256: "a", bytes: 150_000_000, file_url: "/v1/videos/v1/file?v=1" }, { id: "v2", version: 1, sha256: "b", bytes: 100_000_000, file_url: "/v1/videos/v2/file?v=1" }] },
      "/v1/devices/dev-1/spaces": [],
    });
    renderPage("therapist");
    const button = await screen.findByRole("button", { name: /Download everything \(250 MB\)/ });
    await userEvent.click(button);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(/250 MB/)).toBeTruthy();
    expect(calls.some((c) => c.url.includes("/file?v="))).toBe(false); // nothing fetched before confirming
  });

  it("a manager can remove another therapist's space; a therapist can't", async () => {
    api({ "/v1/offline/library": { videos: [] }, "/v1/devices/dev-1/spaces": [] });
    const t = renderPage("therapist");
    const list = await screen.findByRole("list", { name: "Therapists on this device" });
    await waitFor(() => expect(list.textContent).toContain("Oren Katz"));
    expect(within(list).getAllByRole("button", { name: /Remove/ })).toHaveLength(1); // only her own
    t.unmount();
    const calls = api({ "/v1/offline/library": { videos: [] }, "/v1/devices/dev-1/spaces": [] });
    renderPage("clinic_manager");
    const list2 = await screen.findByRole("list", { name: "Therapists on this device" });
    await waitFor(() => expect(within(list2).getAllByRole("button", { name: /Remove/ })).toHaveLength(2));
    await userEvent.click(within(list2).getByRole("button", { name: "Remove Oren Katz" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Remove" }));
    await waitFor(async () => expect((await listSpaces()).map((s) => s.display_name)).toEqual(["Tamar Golan"]));
    expect(calls).toContainEqual({ url: "/v1/devices/dev-1/spaces/s-oren", method: "DELETE" });
  });
});

describe("removing data from the device", () => {
  beforeEach(async () => {
    for (const s of await listSpaces()) await removeSpace(s.id);
    const db = await deviceDb();
    await db.clear("meta");
    await db.clear("outbox");
    await setMeta("device_id", "dev-1");
    await createSpace(space("s-me", "u-me", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a therapist's data can't be removed while their results wait to be sent", async () => {
    const db = await deviceDb();
    await db.put("outbox", { id: "r1", kind: "result", created_at: new Date().toISOString(), therapist_id: "u-me", sealed: { iv: "", data: "", epk: "" } });
    await db.put("outbox", { id: "r2", kind: "view", created_at: new Date().toISOString(), therapist_id: "u-me", sealed: { iv: "", data: "", epk: "" } });
    api({ "/v1/offline/library": { videos: [] }, "/v1/devices/dev-1/spaces": [] });
    renderPage("therapist");
    const list = await screen.findByRole("list", { name: "Therapists on this device" });
    await waitFor(() => expect(list.textContent).toContain("2 results waiting to be sent"));
    expect(within(list).getByRole("button", { name: "Remove Tamar Golan" })).toBeDisabled();
  });
});

describe("result review", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("a flagged result shows why and can be counted", async () => {
    const calls = api({ "/v1/results/g1/review": { decision: "accept" } });
    const s = { id: "g1", counts: false, review: { reason: "consent_withdrawn", decision: null } } as unknown as GameSessionView;
    renderPage("therapist", <ReviewCell session={s} patientId="p1" />);
    expect(await screen.findByText("Arrived after consent was withdrawn")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Count it" }));
    await waitFor(() => expect(calls).toContainEqual({ url: "/v1/results/g1/review", method: "POST" }));
  });
});
