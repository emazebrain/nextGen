/** A game's artwork credit shows on its library page (Picture Trail, ADR 0021: Twemoji, CC-BY 4.0). */
import { describe, expect, it, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { createMemoryRouter, RouterProvider } from "react-router";
import { makeQueryClient } from "../src/App.tsx";
import { PrefsProvider } from "../src/i18n/index.tsx";
import { GamePage } from "../src/routes/library.tsx";

afterEach(() => vi.unstubAllGlobals());

describe("library game page", () => {
  it("shows the picture credit", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 404, headers: { "content-type": "application/json" } }));
    const router = createMemoryRouter([{ path: "/library/:gameId", element: <GamePage /> }], { initialEntries: ["/library/picture-trail"] });
    render(
      <PrefsProvider initialLocale="en">
        <QueryClientProvider client={makeQueryClient()}>
          <RouterProvider router={router} />
        </QueryClientProvider>
      </PrefsProvider>,
    );
    expect(await screen.findByText(/Pictures: Twemoji .* CC-BY 4\.0/)).toBeInTheDocument();
  });
});

describe("game skills", () => {
  it("every game's skills have an English and a Hebrew label", async () => {
    const { GAMES } = await import("../src/games/registry.ts");
    const en = (await import("../src/i18n/messages/en.json")).default as Record<string, string>;
    const he = (await import("../src/i18n/messages/he.json")).default as Record<string, string>;
    for (const g of GAMES) {
      const skills = new Set([...g.manifest.taxonomy.skills, ...g.manifest.metrics.flatMap((m) => m.skills ?? [])]);
      for (const s of skills) {
        expect(en[`skill.${s}`], `${g.manifest.id}: ${s}`).toBeTruthy();
        expect(he[`skill.${s}`], `${g.manifest.id}: ${s}`).toBeTruthy();
      }
    }
  });
});
