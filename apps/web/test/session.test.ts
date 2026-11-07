import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkPin, hasPin, LOCK_MS, MAX_TRIES, setPin } from "../src/session/kidmode.ts";
import { enqueue, flush, pending, send } from "../src/session/outbox.ts";
import type { ResultEnvelope } from "@emb/game-runtime/protocol";

beforeEach(() => localStorage.clear());
afterEach(() => vi.unstubAllGlobals());

describe("kid-mode PIN", () => {
  it("stores only a salted hash and checks it", async () => {
    expect(hasPin()).toBe(false);
    await setPin("2468");
    expect(hasPin()).toBe(true);
    expect(JSON.stringify(localStorage)).not.toContain("2468");
    expect(await checkPin("2468")).toEqual({ ok: true });
    expect(await checkPin("1111")).toEqual({ ok: false, locked_ms: 0, tries_left: MAX_TRIES - 1 });
  });

  it("locks for a minute after five wrong tries, even with the right PIN", async () => {
    await setPin("2468");
    const now = 1_000_000;
    for (let i = 1; i < MAX_TRIES; i++) expect((await checkPin("0000", now)).ok).toBe(false);
    expect(await checkPin("0000", now)).toEqual({ ok: false, locked_ms: LOCK_MS, tries_left: 0 });
    expect((await checkPin("2468", now + 1000)).ok).toBe(false);
    expect(await checkPin("2468", now + LOCK_MS + 1)).toEqual({ ok: true });
  });

  it("refuses PINs that aren't 4–6 digits", async () => {
    await expect(setPin("12")).rejects.toThrow();
    await expect(setPin("12ab")).rejects.toThrow();
  });
});

const env = (id: string) => ({ session_id: id, game_id: "catch-me-if-you-can" }) as unknown as ResultEnvelope;
const reply = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("results outbox", () => {
  it("keeps a result until the server has it", async () => {
    enqueue("t", env("a"));
    enqueue("t", env("a")); // same session id: stored once
    expect(pending()).toHaveLength(1);
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("offline"))));
    expect(await send(pending()[0]!)).toEqual({ state: "waiting", code: "network" });
    expect(pending()[0]).toMatchObject({ tries: 1, last_error: "network" });
    vi.stubGlobal("fetch", vi.fn(() => reply(201, { outcome: "accepted", session_id: "a", progression: null, planned_session_status: "done" })));
    expect((await send(pending()[0]!)).state).toBe("saved");
    expect(pending()).toHaveLength(0);
  });

  it("never drops an item the server refused: it is kept as needing help; 403 or 5xx wait for a retry", async () => {
    enqueue("t", env("a"));
    enqueue("t", env("b"));
    enqueue("t", env("c"));
    const answers: Record<string, [number, unknown]> = { a: [422, { error: "params_mismatch" }], b: [403, { error: "forbidden" }], c: [503, { error: "unavailable" }] };
    vi.stubGlobal(
      "fetch",
      vi.fn((_u: string, init: RequestInit) => {
        const id = JSON.parse(String(init.body)).envelope.session_id as string;
        return reply(...answers[id]!);
      }),
    );
    await flush();
    // Offline devices spec §7.3: an entry leaves only when the server stored it (accepted, duplicate, kept for review).
    expect(pending().map((i) => [i.envelope.session_id, i.last_error])).toEqual([
      ["a", "needs_help"],
      ["b", "forbidden"],
      ["c", "unavailable"],
    ]);
  });
});
