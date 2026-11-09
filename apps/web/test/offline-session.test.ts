/** Offline sessions from packages, and the shared sealed outbox (offline devices spec §7.3–7.4). */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openDB } from "idb";
import { paramsWithinAllowed, type SessionPackage } from "@emb/contracts";
import { launchFromPackage } from "../src/session/package.ts";
import { preflight } from "../src/session/preflight.ts";
import { configureOutbox, enqueue, enqueueAndSend, enqueueView, flush, outboxStatus, retryNeedsHelp, send } from "../src/session/outbox.ts";
import { generateOutboxKeyPair } from "../src/device/crypto.ts";
import { deviceDb } from "../src/device/db.ts";

const rule = { metric: "accuracy" as const, up_at: 0.8, up_after: 1, down_below: 0.5, down_after: 1 };
const base = { session_mode: "timed", duration_s: 120, hemisphere: "left", timer_position: "left", lang: "en", context: "clinic", difficulty: 2, seed: 1, practice: "off", instructions: "short" };
const exact = Object.fromEntries(Object.entries(base).filter(([k]) => !["difficulty", "seed", "practice", "instructions"].includes(k)));

const pkg = (over: Partial<SessionPackage["steps"][number]> = {}): SessionPackage => ({
  planned_session_id: "ps2", planned_date: "2026-11-07", seq: 2, week: 1, total: 8,
  patient: { id: "p1", given_name: "Noa", family_name: "Levi", preferred_locale: "en", alert: null },
  assignment: { id: "as1", name: "Attention" },
  steps: [
    { kind: "game", assignment_step_id: "st1", ordinal: 1, game_id: "tunnel-rush", ticket: "T1", allowed: { exact, difficulty: { min: 1, max: 5 } }, base_params: base, practice_setting: "auto", sessions_completed: 1, progression: rule, difficulty: 2, history: [{ accuracy: 0.6, difficulty: 2, valid: true }], done: false, ...over } as SessionPackage["steps"][number],
    { kind: "video", assignment_step_id: "st2", ordinal: 2, ticket: "T2", video: { id: "v1", version: 2, source: "upload", youtube_id: null, title: "Colour shapes", duration_s: 10, file_url: "/v1/videos/v1/file?v=2", sha256: "ab" }, done: false },
    { kind: "video", assignment_step_id: "st3", ordinal: 3, video: { id: "v2", version: 1, source: "youtube", youtube_id: "abcdefghijk", title: "Breathing", duration_s: null, file_url: null, sha256: null }, done: false },
  ],
});

const envelope = (id: string) => ({ envelope_version: "1", session_id: id, game_id: "tunnel-rush", params: base, std: { accuracy: 0.9 } }) as never;
const view = (id: string) => ({ client_view_id: id, planned_session_id: "ps2", assignment_step_id: "st2", video_id: "v1", video_version: 2, started_at: "2026-11-07T08:00:00.000Z", ended_at: "2026-11-07T08:00:10.000Z", watched_s: 10, completed: true, ticket: "T2" });
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("offline sessions", () => {
  it("a second offline session starts at the difficulty the server would choose", () => {
    // History 0.6 at level 2, then a 0.9 played offline on this device: the rule moves it up to 3, as the server would.
    const first = launchFromPackage(pkg(), () => [], () => 7);
    expect(first.steps[0]).toMatchObject({ kind: "game", params: { difficulty: 2, seed: 7, practice: "off", instructions: "always" } });
    const second = launchFromPackage(pkg(), () => [{ accuracy: 0.9, difficulty: 2, valid: true }], () => 8);
    expect(second.steps[0]).toMatchObject({ params: { difficulty: 3, instructions: "short" } });
    // A 0.4 afterwards would bring it back down, step by step, like the server's in-order decisions.
    const third = launchFromPackage(pkg(), () => [{ accuracy: 0.9, difficulty: 2, valid: true }, { accuracy: 0.4, difficulty: 3, valid: true }], () => 9);
    expect(third.steps[0]).toMatchObject({ params: { difficulty: 2 } });
  });

  it("offline params stay within the ticket", () => {
    const tight = pkg({ allowed: { exact, difficulty: { min: 1, max: 2 } } } as never);
    const l = launchFromPackage(tight, () => [{ accuracy: 0.95, difficulty: 2, valid: true }], () => 3);
    const step = l.steps[0] as { params: Record<string, unknown>; ticket: string };
    expect(step.params.difficulty).toBe(2); // clamped to the ticket
    expect(paramsWithinAllowed({ exact, difficulty: { min: 1, max: 2 } }, step.params)).toBe(true);
    expect(step.ticket).toBe("T1");
    expect((l.steps[1] as { ticket?: string }).ticket).toBe("T2");
  });

  it("preflight warns when the package's offline pass has expired", async () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const expired = `${b64({ alg: "EdDSA" })}.${b64({ v: 2, exp: Math.floor(Date.now() / 1000) - 60 })}.sig`;
    const p = pkg({ ticket: expired } as never);
    const r = await preflight(p, { online: false, hasVideo: async () => true });
    expect(r).toMatchObject({ ok: false, expired: true });
    const fresh = `${b64({ alg: "EdDSA" })}.${b64({ v: 2, exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
    expect(await preflight(pkg({ ticket: fresh } as never), { online: false, hasVideo: async () => true })).toMatchObject({ ok: false, missing: [{ ordinal: 3 }] });
  });

  it("preflight names a video that isn't on the device when offline", async () => {
    const offline = await preflight(pkg(), { online: false, hasVideo: async () => false });
    expect(offline).toEqual({ ok: false, missing: [{ ordinal: 2, kind: "video", title: "Colour shapes" }, { ordinal: 3, kind: "video", title: "Breathing" }] });
    expect(await preflight(pkg(), { online: false, hasVideo: async (id) => id === "v1" })).toEqual({ ok: false, missing: [{ ordinal: 3, kind: "video", title: "Breathing" }] });
    expect(await preflight(pkg(), { online: true, hasVideo: async () => false })).toEqual({ ok: true });
  });
});

describe("sealed outbox", () => {
  let pair: { publicKey: string; privateKey: CryptoKey };
  beforeEach(async () => {
    localStorage.clear();
    await (await deviceDb()).clear("outbox");
    pair = await generateOutboxKeyPair();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    configureOutbox(null);
  });

  it("the outbox is written with the public key and sent by whoever opens it", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: null }); // offline: nobody signed in online
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    await enqueue("T1", envelope("01900000-0000-7000-8000-000000000001"));
    await enqueueView(view("01900000-0000-7000-8000-000000000002"));
    const raw = await (await openDB("emb.device.v1")).getAll("outbox");
    expect(raw).toHaveLength(2);
    expect(JSON.stringify(raw)).not.toMatch(/tunnel-rush|\\"T1\\"|\\"ps2\\"|"T1"|"ps2"/);
    expect((await outboxStatus()).waiting).toBe(2);
    // Later, someone else signs in online: their session holds the private key and sends everything, oldest first.
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    const calls: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return reply(201, { outcome: "accepted", review_reason: null });
    }));
    await flush();
    expect(calls.map((c) => c.url)).toEqual(["/v1/results", "/v1/video-views"]);
    expect(calls[0]!.body).toMatchObject({ ticket: "T1", envelope: { game_id: "tunnel-rush" } });
    expect(calls[1]!.body).toMatchObject({ ticket: "T2", client_view_id: "01900000-0000-7000-8000-000000000002" });
    expect((await outboxStatus()).waiting).toBe(0);
  });

  it("a flush with nobody signed in doesn't block the next one", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: null });
    await flush(); // offline, nobody signed in: nothing to open
    await enqueue("T1", envelope("01900000-0000-7000-8000-000000000008"));
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    const f = vi.fn(async () => reply(201, { outcome: "accepted", review_reason: null }));
    vi.stubGlobal("fetch", f);
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect((await outboxStatus()).waiting).toBe(0);
  });

  it("if the device copy can't be written, the result is still sent, and the caller is told it isn't stored", async () => {
    configureOutbox({ publicKey: "not-a-key", privateKey: null }); // sealing fails, like a full disk would
    const f = vi.fn(async () => reply(201, { outcome: "accepted", review_reason: null }));
    vi.stubGlobal("fetch", f);
    const r = await enqueueAndSend("T1", envelope("01900000-0000-7000-8000-000000000009"));
    expect(f).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ stored: false, result: { state: "saved" } });
  });

  it("each waiting result is labelled with its therapist (an account id, never patient data) until the server has it", async () => {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
    const forTamar = `${b64({ alg: "EdDSA" })}.${b64({ v: 2, sub: "u-tamar", exp: 9e9 })}.sig`;
    configureOutbox({ publicKey: pair.publicKey, privateKey: null });
    await enqueue(forTamar, envelope("01900000-0000-7000-8000-00000000000b"));
    await enqueueView({ ...view("01900000-0000-7000-8000-00000000000c"), ticket: forTamar });
    const raw = (await (await openDB("emb.device.v1")).getAll("outbox")) as Array<{ therapist_id: string | null }>;
    expect(raw.map((r) => r.therapist_id)).toEqual(["u-tamar", "u-tamar"]);
    expect((await outboxStatus()).byTherapist).toEqual({ "u-tamar": 2 });
  });

  it("a 401 keeps the outbox and asks for sign-in", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    vi.stubGlobal("fetch", vi.fn(async () => reply(401, { error: "unauthenticated" })));
    await enqueue("T1", envelope("01900000-0000-7000-8000-000000000003"));
    await flush();
    expect(await outboxStatus()).toMatchObject({ waiting: 1, needsSignIn: true });
  });

  it("kept_for_review removes the item; a network error keeps it", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    const e = envelope("01900000-0000-7000-8000-000000000004");
    await enqueue("T1", e);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("offline"); }));
    expect((await send({ ticket: "T1", envelope: e })).state).toBe("waiting");
    expect((await outboxStatus()).waiting).toBe(1);
    vi.stubGlobal("fetch", vi.fn(async () => reply(201, { outcome: "kept_for_review", review_reason: "consent_withdrawn" })));
    const r = await send({ ticket: "T1", envelope: e });
    expect(r).toMatchObject({ state: "saved", receipt: { outcome: "kept_for_review" } });
    expect((await outboxStatus()).waiting).toBe(0);
  });

  it("a refused result is kept, marked as needing help, and not retried", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    const e = envelope("01900000-0000-7000-8000-000000000005");
    await enqueue("T1", e);
    const f = vi.fn(async () => reply(409, { error: "session_id_reused" }));
    vi.stubGlobal("fetch", f);
    await flush();
    await flush();
    expect(f).toHaveBeenCalledTimes(1);
    expect(await outboxStatus()).toMatchObject({ waiting: 1, needsHelp: 1 });
  });

  it("results that needed help can be tried again", async () => {
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    await enqueue("T1", envelope("01900000-0000-7000-8000-00000000000a"));
    vi.stubGlobal("fetch", vi.fn(async () => reply(422, { error: "invalid_ticket" })));
    await flush();
    expect((await outboxStatus()).needsHelp).toBe(1);
    vi.stubGlobal("fetch", vi.fn(async () => reply(201, { outcome: "kept_for_review", review_reason: "ticket_expired" })));
    await retryNeedsHelp();
    expect((await outboxStatus()).waiting).toBe(0);
  });

  it("old localStorage results move into the sealed outbox once", async () => {
    localStorage.setItem("emb.outbox.v1", JSON.stringify([{ ticket: "OLD", envelope: envelope("01900000-0000-7000-8000-000000000006"), queued_at: 1, tries: 0 }]));
    localStorage.setItem("emb.outbox.views.v1", JSON.stringify([view("01900000-0000-7000-8000-000000000007")]));
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    // The status counts both queues, so wait for the move itself: the old keys gone, both items in the sealed outbox.
    await vi.waitFor(() => expect(localStorage.getItem("emb.outbox.v1")).toBeNull());
    expect((await outboxStatus()).waiting).toBe(2);
    expect(localStorage.getItem("emb.outbox.views.v1")).toBeNull();
    configureOutbox({ publicKey: pair.publicKey, privateKey: pair.privateKey });
    expect((await outboxStatus()).waiting).toBe(2);
  });
});
