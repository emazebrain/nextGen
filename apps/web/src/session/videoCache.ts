/**
 * Uploaded videos are kept on the device after they are first played, so the next session that shows the same
 * video plays it from the device instead of downloading it again. A video's address names its version
 * (`…/file?v=3`), so a newly uploaded version is a new address: it is downloaded once, and the copies of earlier
 * versions that this module stored are removed. Videos hold no patient data. It shares the cache that offline
 * devices use (device/content.ts) and never removes what that store put there.
 */
const CACHE = "emb-videos-v1";
const MINE = "emb.videoCache.keys";
/** Leave this share of the device's quota free. */
const HEADROOM = 0.1;

const available = () => typeof caches !== "undefined" && typeof URL.createObjectURL === "function";
const absolute = (fileUrl: string) => new URL(fileUrl, globalThis.location?.origin ?? "http://localhost");
/** Only a versioned address names fixed bytes; anything else always comes from the network. */
const versioned = (fileUrl: string) => absolute(fileUrl).searchParams.has("v");

function mine(): string[] {
  try {
    const list = JSON.parse(localStorage.getItem(MINE) ?? "[]") as unknown;
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
function setMine(list: string[]) {
  try {
    localStorage.setItem(MINE, JSON.stringify(list));
  } catch {
    /* the copies stay; they are just not tidied later */
  }
}

/** Whether videos can be kept on this device at all. */
export const canKeepVideos = (fileUrl: string | null | undefined): boolean => !!fileUrl && available() && versioned(fileUrl);

/** A local address for the stored copy of this video version, or null when it is not on the device. Revoke it when done. */
export async function storedVideo(fileUrl: string): Promise<string | null> {
  if (!canKeepVideos(fileUrl)) return null;
  try {
    const hit = await (await caches.open(CACHE)).match(absolute(fileUrl).href, { ignoreVary: true });
    if (!hit) return null;
    const blob = await hit.blob();
    return blob.size > 0 ? URL.createObjectURL(blob) : null;
  } catch {
    return null;
  }
}

/** Forget a stored copy that would not play. */
export async function dropVideo(fileUrl: string): Promise<void> {
  if (!available()) return;
  const key = absolute(fileUrl).href;
  await caches.open(CACHE).then((c) => c.delete(key)).catch(() => undefined);
  setMine(mine().filter((k) => k !== key));
}

const inFlight = new Map<string, Promise<boolean>>();

/** Download this video version and keep it. Resolves true when it is on the device afterwards. Never throws. */
export function keepVideo(fileUrl: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!canKeepVideos(fileUrl)) return Promise.resolve(false);
  const url = absolute(fileUrl);
  const key = url.href;
  const running = inFlight.get(key);
  if (running) return running;
  const job = (async () => {
    try {
      const cache = await caches.open(CACHE);
      if (await cache.match(key, { ignoreVary: true })) return true;
      const res = await fetcher(key, { credentials: "same-origin" });
      // Only a whole file is kept: never a part of one, never an error page.
      if (res.status !== 200) return false;
      const blob = await res.blob();
      const declared = Number(res.headers.get("content-length") ?? "");
      if (blob.size === 0 || (declared > 0 && declared !== blob.size)) return false;
      const estimate = await navigator.storage?.estimate?.().catch(() => undefined);
      if (estimate?.quota && (estimate.usage ?? 0) + blob.size > estimate.quota * (1 - HEADROOM)) return false;
      await cache.put(key, new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "video/mp4", "content-length": String(blob.size) } }));
      // Earlier versions of the same video that were kept here are no longer needed.
      const stale = mine().filter((k) => k !== key && new URL(k).pathname === url.pathname);
      for (const k of stale) await cache.delete(k).catch(() => undefined);
      setMine([...mine().filter((k) => k !== key && !stale.includes(k)), key]);
      return true;
    } catch {
      await caches.open(CACHE).then((c) => c.delete(key)).catch(() => undefined);
      return false;
    } finally {
      inFlight.delete(key);
    }
  })();
  inFlight.set(key, job);
  return job;
}
