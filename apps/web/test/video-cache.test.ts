/** Videos are kept on the device after the first play; a new version is fetched once and replaces the old copy. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { canKeepVideos, dropVideo, keepVideo, storedVideo } from "../src/session/videoCache.ts";

function fakeCaches() {
  const store = new Map<string, Response>();
  const cache = {
    match: async (k: string) => store.get(k)?.clone(),
    put: async (k: string, r: Response) => void store.set(k, r),
    delete: async (k: string) => store.delete(k),
  };
  vi.stubGlobal("caches", { open: async () => cache });
  return store;
}
const file = (bytes: number, status = 200) => async () => new Response(new Uint8Array(bytes), { status, headers: { "content-type": "video/mp4", "content-length": String(bytes) } });
const V1 = "/v1/parent/videos/abc/file?v=1";
const V2 = "/v1/parent/videos/abc/file?v=2";

describe("video cache", () => {
  let store: Map<string, Response>;
  beforeEach(() => {
    localStorage.clear();
    store = fakeCaches();
    URL.createObjectURL = vi.fn(() => "blob:local");
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads a video once and then plays it from the device", async () => {
    expect(await storedVideo(V1)).toBeNull();
    const fetcher = vi.fn(file(10));
    expect(await keepVideo(V1, fetcher as unknown as typeof fetch)).toBe(true);
    expect(await keepVideo(V1, fetcher as unknown as typeof fetch)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(await storedVideo(V1)).toBe("blob:local");
  });

  it("fetches a new version once and removes the copy of the old one", async () => {
    await keepVideo(V1, file(10) as unknown as typeof fetch);
    expect(await storedVideo(V2)).toBeNull();
    await keepVideo(V2, file(12) as unknown as typeof fetch);
    expect([...store.keys()].map((k) => new URL(k).search)).toEqual(["?v=2"]);
  });

  it("keeps only whole files: not an error, not a part, not a short download", async () => {
    expect(await keepVideo(V1, file(10, 404) as unknown as typeof fetch)).toBe(false);
    expect(await keepVideo(V1, file(10, 206) as unknown as typeof fetch)).toBe(false);
    const short = async () => new Response(new Uint8Array(4), { status: 200, headers: { "content-length": "10" } });
    expect(await keepVideo(V1, short as unknown as typeof fetch)).toBe(false);
    expect(store.size).toBe(0);
  });

  it("leaves an address without a version alone, and can drop a copy that will not play", async () => {
    expect(canKeepVideos("/v1/videos/abc/file")).toBe(false);
    await keepVideo(V1, file(10) as unknown as typeof fetch);
    await dropVideo(V1);
    expect(await storedVideo(V1)).toBeNull();
  });
});
