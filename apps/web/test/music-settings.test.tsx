/** Settings → Session music: the levels a role may upload to, the rights notice and confirmation, and the list. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";

const track = (id: string, title: string, hemisphere: string, scope: string, can_manage: boolean) => ({ id, title, hemisphere, scope, can_manage, mine: can_manage, uploaded_by: "Yael Bar", bytes: 1000, mime: "audio/mpeg", created_at: "2026-11-27T10:00:00Z" });

function mockApi(over: { scopes?: string[]; role?: string; durable?: boolean } = {}) {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = init?.method ?? "GET";
    calls.push({ method, url: url.pathname + url.search });
    const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/me") return ok({ user: { id: "u", email: "y@synthetic.test", name: "Yael Bar" }, memberships: [{ clinic_id: "c1", organization_id: "o", role: over.role ?? "therapist", clinic_name: "Clinic" }] });
    if (p === "/v1/music" && method === "GET")
      return ok({ upload_scopes: over.scopes ?? ["personal"], tracks: [track("t1", "Sea at night", "right", "personal", true), track("t2", "Clinic pop", "left", "clinic", false)] });
    if (p === "/v1/files/status") return ok({ durable: over.durable ?? true });
    if (p === "/v1/music/complete" && method === "POST") return ok({ track: track("t3", url.searchParams.get("title")!, url.searchParams.get("hemisphere")!, url.searchParams.get("scope")!, true) }, 201);
    return ok({});
  });
  // The file itself goes up in parts with XMLHttpRequest (it reports progress); every part is accepted here.
  vi.stubGlobal("XMLHttpRequest", class {
    status = 200;
    responseText = '{"ok":true}';
    upload = {} as { onprogress?: (e: unknown) => void };
    withCredentials = false;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    private url = "";
    open(method: string, url: string) { this.url = url; calls.push({ method, url }); }
    setRequestHeader() {}
    send() { queueMicrotask(() => this.onload?.()); }
  });
  return calls;
}

function show() {
  const router = createMemoryRouter(routes, { initialEntries: ["/settings/music"] });
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

describe("session music settings", () => {
  it("shows the rights notice and will not upload until the uploader confirms the rights", async () => {
    const calls = mockApi();
    show();
    const user = userEvent.setup();
    expect(await screen.findByText("Rights and royalties")).toBeInTheDocument();
    expect(screen.getByText(/paying any royalties is your responsibility/)).toBeInTheDocument();
    const send = screen.getByRole("button", { name: "Upload" });
    expect(send).toBeDisabled();

    await user.upload(screen.getByLabelText("Audio file"), new File([new Uint8Array(64)], "Morning song.mp3", { type: "audio/mpeg" }));
    expect(screen.getByLabelText(/^Name/)).toHaveValue("Morning song"); // taken from the file name
    expect(send).toBeDisabled(); // still no confirmation
    await user.click(screen.getByRole("radio", { name: "Left hemisphere" }));
    await user.click(screen.getByRole("checkbox", { name: /I confirm that I own this music/ }));
    expect(send).toBeEnabled();
    await user.click(send);

    expect(await screen.findByText("“Morning song” was uploaded.")).toBeInTheDocument();
    // One small file is one part, sent before the server is asked to make it a track.
    expect(calls.filter((c) => c.method === "PUT").map((c) => c.url.replace(/[0-9a-f-]{36}/, "ID"))).toEqual(["/v1/music/parts/ID/0"]);
    const post = calls.find((c) => c.method === "POST")!;
    expect(post.url.startsWith("/v1/music/complete?")).toBe(true);
    const q = new URL(post.url, "http://localhost").searchParams;
    expect(Object.fromEntries(q)).toEqual({ scope: "personal", hemisphere: "left", title: "Morning song", rights: "confirmed", clinic: "c1" });
    // Each upload is confirmed on its own.
    expect(screen.getByRole("checkbox", { name: /I confirm that I own this music/ })).not.toBeChecked();
  });

  it("a therapist uploads for their own patients only; a manager can choose the clinic too", async () => {
    mockApi();
    show();
    expect(await screen.findByText("My patients only", { selector: "p, p *" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "Available to" })).toBeNull();
    cleanup();

    mockApi({ scopes: ["clinic", "personal"], role: "clinic_manager" });
    show();
    const levels = within(await screen.findByRole("combobox", { name: "Available to" })).getAllByRole("option").map((o) => o.textContent);
    expect(levels).toEqual(["My patients only", "Everyone in this clinic"]); // the narrowest first, and it is the default
  });

  it("lists the music by side, with remove and move only where the role allows it", async () => {
    mockApi();
    show();
    const right = within(await screen.findByRole("region", { name: "Right hemisphere" }));
    expect(right.getByText("Sea at night")).toBeInTheDocument();
    expect(right.getByRole("button", { name: "Remove" })).toBeInTheDocument();
    expect(right.getByRole("button", { name: "Move to the Left hemisphere" })).toBeInTheDocument();
    const left = within(screen.getByRole("region", { name: "Left hemisphere" }));
    expect(left.getByText("Clinic pop")).toBeInTheDocument();
    expect(left.getByText("Everyone in this clinic")).toBeInTheDocument();
    expect(left.queryByRole("button", { name: "Remove" })).toBeNull(); // the clinic's track is not a therapist's to remove
  });

  it("says so when the role cannot upload here", async () => {
    mockApi({ scopes: [] });
    show();
    expect(await screen.findByText(/Your role can't upload music here/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Upload" })).toBeNull();
  });

  it("warns before uploading while the server has no permanent file storage", async () => {
    mockApi({ durable: false });
    show();
    expect(await screen.findByText("Uploads are temporary for now")).toBeInTheDocument();
    cleanup();
    mockApi();
    show();
    await screen.findByText("Rights and royalties");
    expect(screen.queryByText("Uploads are temporary for now")).toBeNull();
  });
});
