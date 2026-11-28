/** A parent is signed out after four minutes without activity; playing counts as activity. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router";

const signOut = vi.fn(async () => undefined);
vi.mock("../src/api/auth.ts", () => ({ authClient: { signOut: () => signOut() } }));
import { PARENT_IDLE_LIMIT_MS, useParentIdleSignOut } from "../src/routes/parent/idle.ts";
import { noteActivity } from "../src/lib/idle.ts";

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>
    <MemoryRouter initialEntries={["/parent"]}>{children}</MemoryRouter>
  </QueryClientProvider>
);
const mount = () => renderHook(() => (useParentIdleSignOut(), useLocation()), { wrapper });

describe("parent inactivity sign-out", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    signOut.mockClear();
  });
  afterEach(() => vi.useRealTimers());

  it("is four minutes", () => expect(PARENT_IDLE_LIMIT_MS).toBe(240_000));

  it("signs out after four minutes with no activity, and says why", async () => {
    const h = mount();
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    expect(signOut).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(70_000);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(h.result.current.pathname + h.result.current.search).toBe("/sign-in?reason=idle");
  });

  it("a game or a video playing keeps the parent signed in", async () => {
    mount();
    for (let i = 0; i < 10; i++) {
      await vi.advanceTimersByTimeAsync(60_000);
      noteActivity();
    }
    expect(signOut).not.toHaveBeenCalled();
  });

  it("coming back after the tab was closed for longer signs out at once, and the next sign-in starts fresh", async () => {
    localStorage.setItem("emb.parent.lastActive", String(Date.now() - 5 * 60_000));
    const first = mount();
    await vi.advanceTimersByTimeAsync(0);
    expect(signOut).toHaveBeenCalledTimes(1);
    first.unmount();
    mount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signOut).toHaveBeenCalledTimes(1);
  });
});
