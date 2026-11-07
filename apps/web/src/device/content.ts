/**
 * The on-device video store (offline devices spec §7.2; ADR 0019). Shared by every space on the device: videos hold
 * no patient data. A version is fetched once, checked against its sha256, and only then stored; versions nobody's
 * upcoming sessions use and that aren't wanted from the library are removed.
 */
import type { OfflineVideoRef } from "@emb/contracts";
import { deviceDb, getMeta, setMeta, type VideoIndexRow } from "./db.ts";

export type VideoRef = OfflineVideoRef;
export type WantedVideo = VideoRef & { priority: "upcoming" | "library" };
export type ContentMode = "local" | "network";
export const VIDEO_CACHE = "emb-videos-v1";
/** Leave this share of the quota free when adding library videos. */
const HEADROOM = 0.1;

const keyOf = (v: { id: string; version: number }) => `${v.id}:${v.version}`;

/** What the device should hold: every version upcoming sessions use (first), then the library's (if asked for). */
export function wantedVideos(spacesVideos: VideoRef[][], library: VideoRef[] | null): WantedVideo[] {
  const out = new Map<string, WantedVideo>();
  for (const list of spacesVideos) for (const v of list) if (!out.has(keyOf(v))) out.set(keyOf(v), { ...v, priority: "upcoming" });
  for (const v of library ?? []) if (!out.has(keyOf(v))) out.set(keyOf(v), { ...v, priority: "library" });
  return [...out.values()];
}

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");

export interface SyncOptions {
  fetch: typeof fetch;
  cache: Cache;
  estimate: () => Promise<{ usage: number; quota: number }>;
  onProgress?: (done: number, total: number) => void;
  base?: string;
}

export async function syncVideos(
  wanted: WantedVideo[],
  o: SyncOptions,
): Promise<{ stored: number; failed: WantedVideo[]; skipped_for_space: WantedVideo[] }> {
  const db = await deviceDb();
  const base = o.base ?? globalThis.location?.origin ?? "http://localhost";
  const urlOf = (v: VideoRef) => new URL(v.file_url, base).href;
  const have = new Map((await db.getAll("videos")).map((r) => [r.key, r]));
  const failed: WantedVideo[] = [];
  const skipped: WantedVideo[] = [];
  let done = 0;
  for (const v of wanted) {
    if (have.has(keyOf(v))) {
      o.onProgress?.(++done, wanted.length);
      continue;
    }
    if (v.priority === "library") {
      const { usage, quota } = await o.estimate();
      if (usage + v.bytes > quota * (1 - HEADROOM)) {
        skipped.push(v);
        continue;
      }
    }
    try {
      const res = await o.fetch(urlOf(v), { credentials: "same-origin" });
      if (!res.ok) throw new Error(`http_${res.status}`);
      const blob = await res.blob();
      const digest = hex(await crypto.subtle.digest("SHA-256", await blob.arrayBuffer()));
      if (digest !== v.sha256) throw new Error("sha256_mismatch");
      await o.cache.put(urlOf(v), new Response(blob, { headers: { "content-type": res.headers.get("content-type") ?? "video/mp4", "content-length": String(blob.size) } }));
      const now = new Date().toISOString();
      const row: VideoIndexRow = { key: keyOf(v), id: v.id, version: v.version, sha256: v.sha256, bytes: blob.size, url: urlOf(v), stored_at: now, last_used_at: now };
      await db.put("videos", row);
      have.set(row.key, row);
    } catch (e) {
      // Nothing half-written is indexed: a version counts as stored only after its hash matched and the put succeeded.
      await o.cache.delete(urlOf(v)).catch(() => undefined);
      (e instanceof DOMException && e.name === "QuotaExceededError" ? skipped : failed).push(v);
    }
    o.onProgress?.(++done, wanted.length);
  }
  // Remove what nothing wants any more.
  const keep = new Set(wanted.map(keyOf));
  for (const [key, row] of have) {
    if (keep.has(key)) continue;
    await o.cache.delete(row.url);
    await db.delete("videos", key);
  }
  if (wanted.length) await setMeta("videos_synced_at", new Date().toISOString());
  return { stored: [...have.keys()].filter((k) => keep.has(k)).length, failed, skipped_for_space: skipped };
}

/** Is this version on the device? (pre-flight, §7.4) */
export async function hasVideo(id: string, version: number): Promise<boolean> {
  return !!(await (await deviceDb()).get("videos", `${id}:${version}`));
}

export async function removeDownloadedVideos(cache?: Cache): Promise<void> {
  const db = await deviceDb();
  const c = cache ?? (await caches.open(VIDEO_CACHE));
  for (const row of await db.getAll("videos")) await c.delete(row.url);
  await db.clear("videos");
}

export async function storedSummary(): Promise<{ videos: number; bytes: number; last_update: string | null }> {
  const rows = await (await deviceDb()).getAll("videos");
  return { videos: rows.length, bytes: rows.reduce((n, r) => n + r.bytes, 0), last_update: (await getMeta<string>("videos_synced_at")) ?? null };
}

/** Installed apps keep videos by default; a plain browser tab streams until someone chooses otherwise. */
export async function getContentMode(): Promise<ContentMode> {
  const set = await getMeta<ContentMode>("content_mode");
  if (set) return set;
  const installed = typeof matchMedia === "function" && matchMedia("(display-mode: standalone)").matches;
  return installed ? "local" : "network";
}
export async function setContentMode(m: ContentMode): Promise<void> {
  await setMeta("content_mode", m);
}
