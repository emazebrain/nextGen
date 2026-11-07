// @vitest-environment node
/** The on-device video store (offline devices spec §7.2) and app updates (§7.1). */
import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { storedSummary, syncVideos, wantedVideos, type VideoRef } from "../src/device/content.ts";
import { createUpdater, setSessionRunning } from "../src/device/update.ts";
import { deviceDb } from "../src/device/db.ts";

const BASE = "http://clinic.test";
const body = (id: string, v: number, n = 100) => new Uint8Array(n).fill((id.charCodeAt(0) + v) % 255);
const ref = (id: string, version: number, n = 100): VideoRef => ({
  id, version, bytes: n, file_url: `/v1/videos/${id}/file?v=${version}`, sha256: createHash("sha256").update(body(id, version, n)).digest("hex"),
});

/** A Cache Storage stand-in and a fetch that serves the files above (or a broken one). */
function world(opts: { broken?: Set<string>; quota?: number } = {}) {
  const store = new Map<string, Response>();
  const cache = {
    put: async (k: string, r: Response) => void store.set(k, r),
    match: async (k: string) => store.get(k)?.clone(),
    delete: async (k: string) => store.delete(k),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  } as unknown as Cache;
  const fetched: string[] = [];
  const fetchFn = vi.fn(async (url: string) => {
    fetched.push(url);
    const m = /\/v1\/videos\/(\w+)\/file\?v=(\d+)/.exec(url)!;
    const b = body(m[1]!, Number(m[2]), opts.broken?.has(m[1]!) ? 99 : 100);
    return new Response(b, { status: 200, headers: { "content-type": "video/mp4" } });
  }) as unknown as typeof fetch;
  let usage = 0;
  const estimate = async () => ({ usage: usage + [...store.values()].length * 100, quota: opts.quota ?? 1e9 });
  return { store, cache, fetched, fetch: fetchFn, estimate, setUsage: (u: number) => (usage = u) };
}

describe("video store", () => {
  beforeEach(async () => {
    await (await deviceDb()).clear("videos");
  });

  it("upcoming videos download before the rest of the library", async () => {
    const w = world();
    const wanted = wantedVideos([[ref("b", 1)], [ref("a", 2)]], [ref("c", 1), ref("a", 2)]);
    expect(wanted.map((v) => `${v.id}:${v.priority}`)).toEqual(["b:upcoming", "a:upcoming", "c:library"]);
    const r = await syncVideos(wanted, { ...w, base: BASE });
    expect(r.stored).toBe(3);
    expect(w.fetched.map((u) => u.replace(BASE, ""))).toEqual(["/v1/videos/b/file?v=1", "/v1/videos/a/file?v=2", "/v1/videos/c/file?v=1"]);
    // Nothing is fetched again while the version is unchanged.
    await syncVideos(wanted, { ...w, base: BASE });
    expect(w.fetched).toHaveLength(3);
  });

  it("a failed or mismatched download leaves nothing behind", async () => {
    const w = world({ broken: new Set(["a"]) });
    const r = await syncVideos(wantedVideos([[ref("a", 1), ref("b", 1)]], null), { ...w, base: BASE });
    expect(r.stored).toBe(1);
    expect(r.failed.map((v) => v.id)).toEqual(["a"]);
    expect([...w.store.keys()]).toEqual([`${BASE}/v1/videos/b/file?v=1`]);
    expect((await (await deviceDb()).getAll("videos")).map((v) => v.key)).toEqual(["b:1"]);
  });

  it("a newer version replaces the old one once no package uses it", async () => {
    const w = world();
    await syncVideos(wantedVideos([[ref("a", 1)]], null), { ...w, base: BASE });
    // One package still plays version 1, the library already has 2: both stay.
    await syncVideos(wantedVideos([[ref("a", 1)]], [ref("a", 2)]), { ...w, base: BASE });
    expect([...w.store.keys()].sort()).toEqual([`${BASE}/v1/videos/a/file?v=1`, `${BASE}/v1/videos/a/file?v=2`]);
    // That session is gone: version 1 is removed.
    await syncVideos(wantedVideos([[ref("a", 2)]], null), { ...w, base: BASE });
    expect([...w.store.keys()]).toEqual([`${BASE}/v1/videos/a/file?v=2`]);
    expect((await storedSummary()).videos).toBe(1);
  });

  it("library videos that won't fit are skipped and reported", async () => {
    const w = world({ quota: 1000 });
    w.setUsage(850);
    const r = await syncVideos(wantedVideos([[ref("a", 1)]], [ref("b", 1), ref("c", 1)]), { ...w, base: BASE });
    expect(r.stored).toBe(1); // upcoming first, even when tight
    expect(r.skipped_for_space.map((v) => v.id)).toEqual(["b", "c"]);
  });
});

describe("app updates", () => {
  it("an update is not applied during a session", () => {
    const post = vi.fn();
    const u = createUpdater(post);
    u.markReady();
    setSessionRunning(true);
    expect(u.apply()).toBe(false);
    expect(post).not.toHaveBeenCalled();
    setSessionRunning(false);
    expect(u.apply()).toBe(true);
    expect(post).toHaveBeenCalledWith({ type: "apply-update" });
  });
});
