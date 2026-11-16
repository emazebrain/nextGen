/** Invited staff must replace their temporary password before they reach the app. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

interface Call {
  method: string;
  path: string;
  body: unknown;
}

/** A tiny server: /v1/me answers with the current status; the test decides what the password change says. */
function mockServer(opts: { status?: string; changePassword?: number } = {}) {
  const calls: Call[] = [];
  let status = opts.status ?? "invited";
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = input instanceof Request ? input : null;
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
    const raw = typeof init?.body === "string" ? init.body : req && method !== "GET" ? await req.clone().text() : "";
    const path = url.pathname;
    calls.push({ method, path, body: raw ? JSON.parse(raw) : null });
    const json = (code: number, body: unknown) => new Response(JSON.stringify(body), { status: code, headers: { "content-type": "application/json" } });
    if (path === "/v1/me" && method === "GET") {
      return json(200, {
        user: { id: "u1", email: "new@synthetic.test", name: "New Person" },
        memberships: [{ clinic_id: "c1", organization_id: "o1", role: "therapist", clinic_name: "Clinic" }],
        user_status: status,
      });
    }
    if (path === "/api/auth/change-password") {
      const code = opts.changePassword ?? 200;
      return code === 200 ? json(200, { token: null, user: { id: "u1" } }) : json(code, { code: "INVALID_PASSWORD", message: "Invalid password" });
    }
    if (path === "/v1/me/status" && method === "PATCH") {
      status = "active";
      return json(200, { status: "active" });
    }
    if (path === "/api/auth/get-session") return json(200, { session: { id: "s" }, user: { id: "u1", email: "new@synthetic.test", twoFactorEnabled: true } });
    return json(200, {});
  });
  return calls;
}

function renderAt(path: string) {
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

async function fill(temporary: string, next: string, confirm: string) {
  const user = userEvent.setup();
  await user.type(await screen.findByLabelText("Temporary password"), temporary);
  await user.type(screen.getByLabelText("New password"), next);
  await user.type(screen.getByLabelText("Confirm password"), confirm);
  await user.click(screen.getByRole("button", { name: "Change password" }));
}

const posted = (calls: Call[], path: string) => calls.filter((c) => c.path === path && c.method !== "GET");

afterEach(() => vi.unstubAllGlobals());

describe("forced password change", () => {
  it("sends an invited user to the password change from any staff page", async () => {
    mockServer();
    const router = renderAt("/patients");
    expect(await screen.findByRole("heading", { name: "Change your password", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/change-password");
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("sends an invited user away from a full-screen staff page too", async () => {
    mockServer();
    const router = renderAt("/patients/p1/consent");
    expect(await screen.findByRole("heading", { name: "Change your password", level: 1 })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/change-password");
  });

  it("does not show the password change to a user who is already active", async () => {
    mockServer({ status: "active" });
    const router = renderAt("/change-password");
    await waitFor(() => expect(router.state.location.pathname).toBe("/today"));
  });

  it("refuses passwords that don't match, without calling the server", async () => {
    const calls = mockServer();
    renderAt("/change-password");
    await fill("temp-password-1234", "a-long-new-password", "a-long-new-passw0rd");
    expect(await screen.findByText("The passwords don't match.")).toBeInTheDocument();
    expect(posted(calls, "/api/auth/change-password")).toHaveLength(0);
  });

  it("refuses a new password shorter than 12 characters, without calling the server", async () => {
    const calls = mockServer();
    renderAt("/change-password");
    await fill("temp-password-1234", "short-pass", "short-pass");
    expect(await screen.findByText("Use at least 12 characters.")).toBeInTheDocument();
    expect(posted(calls, "/api/auth/change-password")).toHaveLength(0);
  });

  it("changes the password, activates the account, then opens the app", async () => {
    const calls = mockServer();
    const router = renderAt("/change-password");
    await fill("temp-password-1234", "a-long-new-password", "a-long-new-password");
    await waitFor(() => expect(router.state.location.pathname).toBe("/today"));
    const change = posted(calls, "/api/auth/change-password");
    expect(change).toHaveLength(1);
    expect(change[0]!.body).toMatchObject({ currentPassword: "temp-password-1234", newPassword: "a-long-new-password", revokeOtherSessions: true });
    const order = calls.filter((c) => c.method !== "GET").map((c) => c.path);
    expect(order).toEqual(["/api/auth/change-password", "/v1/me/status"]);
    expect(posted(calls, "/v1/me/status")[0]!.body).toEqual({ status: "active" });
  });

  it("keeps the account invited when the temporary password is wrong", async () => {
    const calls = mockServer({ changePassword: 400 });
    const router = renderAt("/change-password");
    await fill("not-the-temp-password", "a-long-new-password", "a-long-new-password");
    expect(await screen.findByText("That temporary password isn't right. Check the invitation email and try again.")).toBeInTheDocument();
    expect(posted(calls, "/v1/me/status")).toHaveLength(0);
    expect(router.state.location.pathname).toBe("/change-password");
  });
});
