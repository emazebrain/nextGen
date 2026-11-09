/** Offline sign-in on a shared tablet (offline devices spec §7.5): pick yourself, unlock your own space. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { DeviceProvider, useDevice } from "../src/device/session.tsx";
import { OfflineSignInPage } from "../src/routes/offline-sign-in.tsx";
import { createSpace, listSpaces, removeSpace } from "../src/device/spaces.ts";

const DAY = 86_400_000;
const secret = (n: number) => new Uint8Array(32).fill(n);
const space = (id: string, name: string, daysAgo = 1) => ({
  id, user_id: `u-${id}`, display_name: name, clinic_id: "c1", clinic_name: "Tel Aviv", last_online_at: new Date(Date.now() - daysAgo * DAY).toISOString(),
});

function Where() {
  const d = useDevice();
  return (
    <div>
      <p>Opened: {d.space?.info.display_name ?? "none"}</p>
      <button type="button" onClick={() => void d.signOut()}>Sign out here</button>
    </div>
  );
}

function renderOffline() {
  return render(
    <PrefsProvider initialLocale="en">
      <DeviceProvider>
        <MemoryRouter initialEntries={["/offline?next=/today"]}>
          <Routes>
            <Route path="/offline" element={<OfflineSignInPage />} />
            <Route path="/today" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </DeviceProvider>
    </PrefsProvider>,
  );
}

describe("offline sign-in", () => {
  beforeEach(async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    for (const s of await listSpaces()) await removeSpace(s.id);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offline, the sign-in lists this device's therapists and opens a space with its password", async () => {
    await createSpace(space("a", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    await createSpace(space("b", "Oren Katz"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
    renderOffline();
    expect(await screen.findByRole("heading", { name: "No connection" })).toBeTruthy();
    await screen.findByRole("radio", { name: /Oren Katz/ });
    const who = screen.getByRole("radiogroup", { name: "Who's using the tablet?" });
    expect(who.textContent).toContain("Tamar Golan");
    expect(who.textContent).toContain("Oren Katz");
    await userEvent.click(screen.getByRole("radio", { name: /Tamar Golan/ }));
    await userEvent.type(screen.getByLabelText("Offline password"), "tablet42!");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("Opened: Tamar Golan")).toBeTruthy();
  });

  it("a wrong password says how many tries are left", async () => {
    await createSpace(space("a", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    renderOffline();
    await userEvent.click(await screen.findByRole("radio", { name: /Tamar Golan/ }));
    await userEvent.type(screen.getByLabelText("Offline password"), "nope-nope");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    expect(await screen.findByText("That's not the password. 4 tries left.")).toBeTruthy();
  });

  it("a space last online 31 days ago asks for an online sign-in", async () => {
    await createSpace(space("a", "Tamar Golan", 31), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    renderOffline();
    await userEvent.click(await screen.findByRole("radio", { name: /Tamar Golan/ }));
    expect(await screen.findByText("Sign in online to continue — it's been more than 30 days.")).toBeTruthy();
    expect(screen.queryByLabelText("Offline password")).toBeNull();
  });

  it("signing out locks your space and keeps it, and everyone else's, on the device", async () => {
    await createSpace(space("a", "Tamar Golan"), { password: "tablet42!", secret: secret(1), iterations: 1000 });
    await createSpace(space("b", "Oren Katz"), { password: "oren-pass1", secret: secret(2), iterations: 1000 });
    renderOffline();
    await userEvent.click(await screen.findByRole("radio", { name: /Tamar Golan/ }));
    await userEvent.type(screen.getByLabelText("Offline password"), "tablet42!");
    await userEvent.click(screen.getByRole("button", { name: "Unlock" }));
    await userEvent.click(await screen.findByRole("button", { name: "Sign out here" }));
    expect(await screen.findByText("Opened: none")).toBeTruthy();
    expect((await listSpaces()).map((s) => s.display_name)).toEqual(["Oren Katz", "Tamar Golan"]);
  });
});
