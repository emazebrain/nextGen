/** Platform admins manage organizations, clinics and users; nobody else sees those screens. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

interface Call {
  method: string;
  path: string;
  body: any;
}

const ORG = { id: "o1", name: "Carmel Group", region: "il", default_locale: "he", status: "active", created_at: "2026-11-01T00:00:00Z" };
const ORG2 = { id: "o2", name: "Atlantic Care", region: "us", default_locale: "en", status: "suspended", created_at: "2026-11-02T00:00:00Z" };
const CLINIC = { id: "c1", organization_id: "o1", organization_name: "Carmel Group", name: "Haifa Clinic", country_code: "IL", timezone: "Asia/Jerusalem", status: "active", created_at: "2026-11-01T00:00:00Z" };
const INVITED = { id: "u2", email: "dana@synthetic.test", full_name: "Dana Levi", status: "invited", memberships: [{ organization_id: "o1", clinic_id: "c1", role: "therapist" }] };
const ACTIVE = { id: "u3", email: "omer@synthetic.test", full_name: "Omer Katz", status: "active", memberships: [{ organization_id: "o1", clinic_id: null, role: "org_admin" }] };

/** Answers the admin API from a small fixed data set and records what was sent. */
function mockServer(opts: { admin?: boolean; respond?: (call: Call) => { status: number; body: unknown } | undefined } = {}) {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const call: Call = { method, path: url.pathname + url.search, body: typeof init?.body === "string" ? JSON.parse(init.body) : null };
    calls.push(call);
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const custom = opts.respond?.(call);
    if (custom) return json(custom.status, custom.body);
    const p = url.pathname;
    if (p === "/v1/me") {
      return json(200, {
        user: { id: "u1", email: "admin@synthetic.test", name: "Ada Admin" },
        memberships: [{ clinic_id: null, organization_id: "o0", role: opts.admin === false ? "therapist" : "platform_admin", clinic_name: null }],
        is_platform_admin: opts.admin !== false,
        user_status: "active",
      });
    }
    if (!p.startsWith("/v1/admin/")) return json(200, {});
    if (opts.admin === false) return json(403, { error: "forbidden" });
    if (p === "/v1/admin/organizations" && method === "GET") return json(200, { organizations: [ORG2, ORG] });
    if (p === "/v1/admin/organizations" && method === "POST") return json(201, { organization: { ...ORG, id: "o9", ...call.body } });
    if (p === "/v1/admin/organizations/o1" && method === "GET") return json(200, { organization: ORG, clinics: [CLINIC], admins: [ACTIVE] });
    if (p === "/v1/admin/organizations/o1" && method === "PATCH") return json(200, { organization: { ...ORG, ...call.body } });
    if (p === "/v1/admin/organizations/o1/clinics" && method === "GET") return json(200, { clinics: [CLINIC] });
    if (p === "/v1/admin/organizations/o1/clinics" && method === "POST") return json(201, { clinic: { ...CLINIC, id: "c9", ...call.body } });
    if (p === "/v1/admin/clinics/c1" && method === "GET") return json(200, { clinic: CLINIC });
    if (p === "/v1/admin/clinics/c1" && method === "PATCH") return json(200, { clinic: { ...CLINIC, ...call.body } });
    if (p === "/v1/admin/users" && method === "GET") return json(200, { users: url.searchParams.get("clinic_id") ? [INVITED] : [INVITED, ACTIVE] });
    if (p === "/v1/admin/users" && method === "POST") return json(201, { user: { id: "u9", email: call.body.email, full_name: call.body.full_name, status: "invited" }, membership: { id: "m9" }, email_sent: true });
    if (p === "/v1/admin/users/u2/resend-invite") return json(200, { sent: true });
    if (/^\/v1\/admin\/users\/u\d$/.test(p) && method === "PATCH") return json(200, { user: { ...ACTIVE, ...call.body } });
    return json(404, { error: "not_found" });
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

const sent = (calls: Call[], method: string, path: string) => calls.filter((c) => c.method === method && c.path === path);

afterEach(() => vi.unstubAllGlobals());

describe("admin screens", () => {
  it("shows a therapist that the area is for platform admins, without asking the admin API", async () => {
    const calls = mockServer({ admin: false });
    renderAt("/admin/organizations");
    expect(await screen.findByRole("heading", { name: "Platform admins only" })).toBeInTheDocument();
    expect(calls.some((c) => c.path.startsWith("/v1/admin/"))).toBe(false);
    expect(screen.queryByRole("link", { name: "Organizations" })).not.toBeInTheDocument();
  });

  it("lists organizations with their status and links to each one", async () => {
    mockServer();
    renderAt("/admin/organizations");
    expect(await screen.findByRole("heading", { name: "Organizations", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Carmel Group" })).toHaveAttribute("href", "/admin/organizations/o1");
    expect(screen.getByText("Suspended")).toBeInTheDocument();
    expect(screen.getByText("United States")).toBeInTheDocument();
    expect(within(screen.getByRole("navigation", { name: "Main" })).getByRole("link", { name: "Organizations" })).toHaveAttribute("href", "/admin/organizations");
    expect(screen.getByRole("link", { name: "New organization" })).toHaveAttribute("href", "/admin/organizations/new");
  });

  it("asks for a name before creating an organization, then creates it and opens it", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    const router = renderAt("/admin/organizations/new");
    await user.click(await screen.findByRole("button", { name: "Create organization" }));
    expect(await screen.findByText("This field is required.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/v1/admin/organizations")).toHaveLength(0);
    await user.type(screen.getByLabelText("Name"), "  North Clinics ");
    await user.selectOptions(screen.getByLabelText("Region"), "eu");
    await user.selectOptions(screen.getByLabelText("Default language"), "en");
    await user.click(screen.getByRole("button", { name: "Create organization" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/organizations/o9"));
    expect(sent(calls, "POST", "/v1/admin/organizations")[0]!.body).toEqual({ name: "North Clinics", region: "eu", default_locale: "en" });
  });

  it("edits an organization's name and language but not its region", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    const router = renderAt("/admin/organizations/o1/edit");
    const name = await screen.findByLabelText("Name");
    expect(name).toHaveValue("Carmel Group");
    expect(screen.getByLabelText("Region")).toBeDisabled();
    await user.clear(name);
    await user.type(name, "Carmel Health");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/organizations/o1"));
    expect(sent(calls, "PATCH", "/v1/admin/organizations/o1")[0]!.body).toEqual({ name: "Carmel Health", default_locale: "he" });
  });

  it("shows an organization's clinics and users, and suspends it only after confirming", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/organizations/o1");
    expect(await screen.findByRole("heading", { name: "Carmel Group", level: 1 })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: "Haifa Clinic" })).toHaveAttribute("href", "/admin/clinics/c1");
    expect(await screen.findByText("Omer Katz")).toBeInTheDocument();
    expect(screen.getByText("Organization admin")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New clinic" })).toHaveAttribute("href", "/admin/organizations/o1/clinics/new");
    expect(screen.getByRole("link", { name: "New user" })).toHaveAttribute("href", "/admin/users/new?org=o1");
    await user.click(screen.getByRole("button", { name: "Suspend organization" }));
    expect(sent(calls, "PATCH", "/v1/admin/organizations/o1")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "Suspend Carmel Group?" });
    await user.click(within(dialog).getByRole("button", { name: "Suspend organization" }));
    await waitFor(() => expect(sent(calls, "PATCH", "/v1/admin/organizations/o1")).toHaveLength(1));
    expect(sent(calls, "PATCH", "/v1/admin/organizations/o1")[0]!.body).toEqual({ status: "suspended" });
  });

  it("creates a clinic with the region's suggested country and time zone", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    const router = renderAt("/admin/organizations/o1/clinics/new");
    await user.type(await screen.findByLabelText("Name"), "Tel Aviv Clinic");
    expect(screen.getByLabelText("Country")).toHaveValue("IL");
    expect(screen.getByLabelText("Time zone")).toHaveValue("Asia/Jerusalem");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/clinics/c9"));
    expect(sent(calls, "POST", "/v1/admin/organizations/o1/clinics")[0]!.body).toEqual({ name: "Tel Aviv Clinic", country_code: "IL", timezone: "Asia/Jerusalem" });
  });

  it("says so when the organization already has a clinic with that name", async () => {
    mockServer({ respond: (c) => (c.method === "POST" && c.path === "/v1/admin/organizations/o1/clinics" ? { status: 409, body: { error: "name_taken" } } : undefined) });
    const user = userEvent.setup();
    renderAt("/admin/organizations/o1/clinics/new");
    await user.type(await screen.findByLabelText("Name"), "Haifa Clinic");
    await user.click(screen.getByRole("button", { name: "Create clinic" }));
    expect(await screen.findByText("This organization already has a clinic with that name.")).toBeInTheDocument();
  });

  it("shows a clinic's users and resends an invitation to an invited user", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/clinics/c1");
    expect(await screen.findByRole("heading", { name: "Haifa Clinic", level: 1 })).toBeInTheDocument();
    expect(await screen.findByText("Dana Levi")).toBeInTheDocument();
    expect(screen.getByText("Invited")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "New user" })).toHaveAttribute("href", "/admin/users/new?org=o1&clinic=c1");
    await user.click(screen.getByRole("button", { name: "Resend invitation to Dana Levi" }));
    expect(await screen.findByText("Invitation sent.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/v1/admin/users/u2/resend-invite")).toHaveLength(1);
  });

  it("says so when an invitation couldn't be resent", async () => {
    mockServer({ respond: (c) => (c.path === "/v1/admin/users/u2/resend-invite" ? { status: 200, body: { sent: false } } : undefined) });
    const user = userEvent.setup();
    renderAt("/admin/clinics/c1");
    await user.click(await screen.findByRole("button", { name: "Resend invitation to Dana Levi" }));
    expect(await screen.findByText("The invitation couldn't be sent. Try again.")).toBeInTheDocument();
  });

  it("disables a user only after confirming", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/organizations/o1");
    await user.click(await screen.findByRole("button", { name: "Disable Omer Katz" }));
    expect(sent(calls, "PATCH", "/v1/admin/users/u3")).toHaveLength(0);
    const dialog = await screen.findByRole("dialog", { name: "Disable Omer Katz?" });
    await user.click(within(dialog).getByRole("button", { name: "Disable user" }));
    await waitFor(() => expect(sent(calls, "PATCH", "/v1/admin/users/u3")).toHaveLength(1));
    expect(sent(calls, "PATCH", "/v1/admin/users/u3")[0]!.body).toEqual({ status: "disabled" });
  });

  it("invites a user into the clinic the admin came from", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    const router = renderAt("/admin/users/new?org=o1&clinic=c1");
    await user.type(await screen.findByLabelText("Email"), "New.Person@synthetic.test");
    await user.type(screen.getByLabelText("Full name"), "New Person");
    await waitFor(() => expect(screen.getByLabelText("Clinic")).toHaveValue("c1"));
    expect(screen.getByLabelText("Organization")).toHaveValue("o1");
    await user.selectOptions(screen.getByLabelText("Role"), "clinic_manager");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/clinics/c1"));
    expect(sent(calls, "POST", "/v1/admin/users")[0]!.body).toEqual({ email: "New.Person@synthetic.test", full_name: "New Person", role: "clinic_manager", organization_id: "o1", clinic_id: "c1" });
    expect(await screen.findByText("New Person was invited. The email with their temporary password is on its way.")).toBeInTheDocument();
  });

  it("invites an organization-wide user and warns when the email didn't go out", async () => {
    const calls = mockServer({
      respond: (c) => (c.method === "POST" && c.path === "/v1/admin/users" ? { status: 201, body: { user: { id: "u9", full_name: "Org Wide", status: "invited" }, membership: {}, email_sent: false } } : undefined),
    });
    const user = userEvent.setup();
    const router = renderAt("/admin/users/new?org=o1");
    await user.type(await screen.findByLabelText("Email"), "org.wide@synthetic.test");
    await user.type(screen.getByLabelText("Full name"), "Org Wide");
    await user.selectOptions(screen.getByLabelText("Role"), "org_admin");
    await waitFor(() => expect(within(screen.getByLabelText("Clinic")).getByRole("option", { name: "Haifa Clinic" })).toBeInTheDocument());
    expect(screen.getByLabelText("Clinic")).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/organizations/o1"));
    expect(sent(calls, "POST", "/v1/admin/users")[0]!.body).toMatchObject({ organization_id: "o1", clinic_id: null, role: "org_admin" });
    expect(await screen.findByText("Org Wide's account was created, but the invitation email couldn't be sent. Use Resend invitation.")).toBeInTheDocument();
  });

  it("checks the email and name before sending, and reports a taken email", async () => {
    const calls = mockServer({ respond: (c) => (c.method === "POST" && c.path === "/v1/admin/users" ? { status: 409, body: { error: "email_taken" } } : undefined) });
    const user = userEvent.setup();
    renderAt("/admin/users/new?org=o1");
    await user.type(await screen.findByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    expect(await screen.findByText("Enter an email address like name@example.com.")).toBeInTheDocument();
    expect(screen.getByText("This field is required.")).toBeInTheDocument();
    expect(sent(calls, "POST", "/v1/admin/users")).toHaveLength(0);
    await user.clear(screen.getByLabelText("Email"));
    await user.type(screen.getByLabelText("Email"), "dana@synthetic.test");
    await user.type(screen.getByLabelText("Full name"), "Dana Again");
    // C1: therapist (default) needs a clinic — select one so the request reaches the server
    await waitFor(() => expect(within(screen.getByLabelText("Clinic")).getByRole("option", { name: "Haifa Clinic" })).toBeInTheDocument());
    await user.selectOptions(screen.getByLabelText("Clinic"), "c1");
    await user.click(screen.getByRole("button", { name: "Create user" }));
    expect(await screen.findByText("Someone already has an account with that email.")).toBeInTheDocument();
  });
});
