/** The app background: a platform admin sets it on /admin/appearance, and every screen paints it. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider, createMemoryRouter } from "react-router";
import { makeQueryClient, routes } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { AppBackground } from "../src/shell/AppBackground.tsx";
import { safeAppearance } from "../src/api/appearance.ts";

interface Call {
  method: string;
  path: string;
  body: unknown;
  type: string | null;
}

const DEFAULT = { kind: "default", color: null, blur: "light", version: 1, image_url: null, has_image: false };

function mockServer(opts: { admin?: Record<string, unknown>; site?: Record<string, unknown> } = {}) {
  const calls: Call[] = [];
  let saved: Record<string, unknown> = { ...DEFAULT, ...opts.admin };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, "http://localhost");
    const method = (init?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers);
    calls.push({ method, path: url.pathname + url.search, body: typeof init?.body === "string" ? JSON.parse(init.body) : (init?.body ?? null), type: headers.get("content-type") });
    const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    const p = url.pathname;
    if (p === "/v1/me") {
      return json(200, { user: { id: "u1", email: "admin@synthetic.test", name: "Ada Admin" }, memberships: [{ clinic_id: null, organization_id: "o0", role: "platform_admin", clinic_name: null }], is_platform_admin: true, user_status: "active" });
    }
    if (p === "/api/appearance") return json(200, { ...DEFAULT, ...opts.site });
    if (p === "/v1/admin/appearance" && method === "GET") return json(200, { appearance: saved });
    if (p === "/v1/admin/appearance" && method === "PUT") {
      saved = { ...saved, ...(calls.at(-1)!.body as object), version: Number(saved.version) + 1 };
      return json(200, { appearance: saved });
    }
    if (p === "/v1/admin/appearance/image" && method === "PUT") {
      saved = { ...saved, kind: "image", has_image: true, version: Number(saved.version) + 1, image_url: `/api/appearance/image?v=${Number(saved.version) + 1}` };
      return json(200, { appearance: saved });
    }
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
}

const puts = (calls: Call[], path = "/v1/admin/appearance") => calls.filter((c) => c.method === "PUT" && c.path === path);

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete document.documentElement.dataset.appBg;
});

describe("appearance admin page", () => {
  it("saves a colour picked from the palette", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/appearance");
    await user.click(await screen.findByRole("radio", { name: "Solid color" }));
    await user.click(screen.getByRole("radio", { name: "Sky" }));
    await user.click(screen.getByRole("button", { name: "Save background" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toEqual({ kind: "color", color: "#cfe6f3", blur: "light" });
    expect(await screen.findByText(/Background saved/)).toBeInTheDocument();
  });

  it("accepts a pasted hex code and refuses anything else", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/appearance");
    await user.click(await screen.findByRole("radio", { name: "Solid color" }));
    const hex = screen.getByLabelText("Hex code");
    await user.clear(hex);
    await user.type(hex, "blue");
    await user.click(screen.getByRole("button", { name: "Save background" }));
    expect(await screen.findByText(/six-digit hex code/)).toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);

    await user.clear(hex);
    await user.type(hex, "2A2550"); // pasted without the #
    await user.click(screen.getByRole("button", { name: "Save background" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls)[0]!.body).toMatchObject({ kind: "color", color: "#2a2550" });
  });

  it("uploads a chosen image, then saves the blur level", async () => {
    const calls = mockServer();
    const user = userEvent.setup();
    renderAt("/admin/appearance");
    await user.click(await screen.findByRole("radio", { name: "Image" }));
    // Nothing chosen yet: Save explains instead of sending.
    await user.click(screen.getByRole("button", { name: "Save background" }));
    expect(await screen.findByText(/Choose an image/)).toBeInTheDocument();
    expect(puts(calls)).toHaveLength(0);

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "clinic.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("Choose image"), file);
    await user.click(screen.getByRole("radio", { name: "Strong" }));
    await user.click(screen.getByRole("button", { name: "Save background" }));
    await waitFor(() => expect(puts(calls)).toHaveLength(1));
    expect(puts(calls, "/v1/admin/appearance/image")).toHaveLength(1);
    expect(puts(calls, "/v1/admin/appearance/image")[0]!.type).toBe("image/png");
    expect(puts(calls)[0]!.body).toEqual({ kind: "image", blur: "strong" });
  });

  it("shows what is saved today", async () => {
    mockServer({ admin: { kind: "color", color: "#c7d6c3" } });
    renderAt("/admin/appearance");
    expect(await screen.findByRole("radio", { name: "Solid color" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sage" })).toBeChecked();
    expect(screen.getByLabelText("Hex code")).toHaveValue("#c7d6c3");
  });
});

describe("the background on every screen", () => {
  const show = () =>
    render(
      <QueryClientProvider client={makeQueryClient()}>
        <AppBackground />
      </QueryClientProvider>,
    );

  it("paints the uploaded image with its blur level", async () => {
    mockServer({ site: { kind: "image", blur: "strong", version: 7, image_url: "/api/appearance/image?v=7" } });
    show();
    await waitFor(() => expect(document.documentElement.dataset.appBg).toBe("image"));
    const layer = document.querySelector<HTMLElement>(".app-bg")!;
    expect(layer.style.backgroundImage).toContain("/api/appearance/image?v=7");
    expect(layer.dataset.blur).toBe("strong");
    expect(layer).toHaveAttribute("aria-hidden", "true");
  });

  it("paints a solid colour", async () => {
    mockServer({ site: { kind: "color", color: "#e9d5c0", version: 3 } });
    show();
    await waitFor(() => expect(document.documentElement.dataset.appBg).toBe("color"));
    expect(document.querySelector<HTMLElement>(".app-bg")!.style.backgroundColor).toBe("rgb(233, 213, 192)");
  });

  it("leaves the page alone for the standard background, or when the server can't be reached", async () => {
    mockServer();
    show();
    await waitFor(() => expect(vi.mocked(fetch)).toBeDefined());
    expect(document.querySelector(".app-bg")).toBeNull();
    expect(document.documentElement.dataset.appBg).toBeUndefined();
  });

  it("uses the last known background straight away, before the server answers", () => {
    localStorage.setItem("emb.appearance", JSON.stringify({ kind: "color", color: "#cfe6f3", blur: "light", version: 2, image_url: null }));
    vi.stubGlobal("fetch", () => new Promise(() => {}));
    show();
    expect(document.querySelector<HTMLElement>(".app-bg")!.style.backgroundColor).toBe("rgb(207, 230, 243)");
  });

  it("never passes anything but a hex colour or the image address into styles", () => {
    expect(safeAppearance({ kind: "color", color: "red; background:url(//evil.test)", blur: "light", version: 1, image_url: null })).toBeNull();
    expect(safeAppearance({ kind: "image", color: null, blur: "light", version: 1, image_url: "https://evil.test/x.png" })).toBeNull();
    expect(safeAppearance({ kind: "image", color: null, blur: "weird", version: 1, image_url: "/api/appearance/image?v=1" })).toMatchObject({ blur: "light" });
    expect(safeAppearance("nonsense")).toBeNull();
    expect(safeAppearance({ kind: "default" })).toBeNull();
  });
});
