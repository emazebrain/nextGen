/**
 * The offline bundle on the device (offline devices spec §7.3–7.4; ADR 0019): fetched into the open space while
 * online, read back when there's no connection.
 *
 * Every read that has an offline answer goes through offlineOr(): online it fetches (and keeps a copy of what the
 * therapist saw in the space); with no connection it answers from the bundle, or from that last copy.
 */
import { useSyncExternalStore } from "react";
import type { OfflineBundle, OfflineVideoRef, StepItem, TodayItem } from "@emb/contracts";
import { ApiError, apiGet } from "../api/http.ts";
import { getContentMode, syncVideos, VIDEO_CACHE, wantedVideos } from "./content.ts";
import { getMeta, setMeta } from "./db.ts";
import { listSpaces, removeSpace, type OpenSpace } from "./spaces.ts";

export const REFRESH_MS = 15 * 60_000;

// ---- "showing saved data" status ---------------------------------------------------------------------------------

let savedFrom: string | null = null;
const subs = new Set<() => void>();
function setSavedFrom(v: string | null) {
  if (v === savedFrom) return;
  savedFrom = v;
  for (const f of subs) f();
}
/** When answers come from the device, the time the bundle was fetched; null while online answers arrive. */
export function useSavedFrom(): string | null {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => savedFrom,
  );
}

export const isNetworkError = (e: unknown) => e instanceof ApiError && e.status === 0;

/**
 * Who /v1/me last confirmed as signed in online. Online answers are copied into a space only when it belongs to that
 * person: a stale cookie of another therapist must never fill someone else's space (review finding, ADR 0019).
 */
let onlineUser: string | null = null;
export function setOnlineUser(id: string | null): void {
  onlineUser = id;
}

export async function offlineOr<T>(space: OpenSpace | null, name: string, fetcher: () => Promise<T>, fromBundle?: (b: OfflineBundle, done: Set<string>) => T | undefined): Promise<T> {
  try {
    const v = await fetcher();
    setSavedFrom(null);
    if (space && onlineUser && space.info.user_id === onlineUser) void space.write(`q:${name}`, v).catch(() => undefined);
    return v;
  } catch (e) {
    if (!space || !isNetworkError(e)) throw e;
    const b = await space.read<OfflineBundle>("bundle");
    const at = (await space.read<string>("bundle_at")) ?? b?.generated_at ?? null;
    const fromB = b && fromBundle ? fromBundle(b, new Set((await space.read<string[]>("done_sessions")) ?? [])) : undefined;
    const value = fromB !== undefined ? fromB : await space.read<T>(`q:${name}`);
    if (value === undefined) throw e;
    setSavedFrom(at ?? new Date().toISOString());
    return value;
  }
}

// ---- answers from the bundle ----------------------------------------------------------------------------------------

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Today from the packages, like the server: each patient's earliest open session planned up to today (7 days late at most). */
export function todayFromBundle(b: OfflineBundle, done: Set<string>, today = localToday()): TodayItem[] {
  const byPatient = new Map<string, OfflineBundle["packages"]>();
  for (const p of b.packages) {
    if (done.has(p.planned_session_id)) continue;
    byPatient.set(p.patient.id, [...(byPatient.get(p.patient.id) ?? []), p]);
  }
  const out: TodayItem[] = [];
  for (const [pid, list] of byPatient) {
    const first = [...list].sort((x, y) => x.seq - y.seq)[0]!;
    if (first.planned_date > today || first.planned_date < addDays(today, -7)) continue;
    const patient = b.caseload.find((c) => c.id === pid);
    const assignment = b.assignments.find((a) => a.id === first.assignment.id);
    const items: StepItem[] = first.steps.map((s) => (s.kind === "game" ? { kind: "game", game_id: s.game_id } : { kind: "video", video_id: s.video.id, title: s.video.title }));
    out.push({
      planned_session_id: first.planned_session_id,
      planned_date: first.planned_date,
      seq: first.seq,
      week: first.week,
      total: first.total,
      patient: { id: pid, given_name: first.patient.given_name, family_name: first.patient.family_name, date_of_birth: patient?.date_of_birth ?? "", alert: first.patient.alert, can_play: true },
      assignment: { id: first.assignment.id, name: first.assignment.name, weeks: (assignment as { weeks?: number } | undefined)?.weeks ?? 0 },
      games: items.flatMap((i) => (i.kind === "game" ? [i.game_id] : [])),
      items,
    });
  }
  return out.sort((x, y) => x.planned_date.localeCompare(y.planned_date) || x.patient.family_name.localeCompare(y.patient.family_name));
}

// ---- refreshing ---------------------------------------------------------------------------------------------------

/** Fetches the bundle into the space, drops spaces the server ended, records the videos this space needs. */
export async function refreshBundle(space: OpenSpace, deviceId: string, lang: string, o: { syncVideos?: boolean } = {}): Promise<OfflineBundle> {
  const q = new URLSearchParams({ device: deviceId, lang, clinic: space.info.clinic_id });
  const b = await apiGet<OfflineBundle>(`/v1/offline/bundle?${q}`);
  await space.write("bundle", b);
  await space.write("bundle_at", new Date().toISOString());
  // Sessions the server already has as played no longer need to be marked done on the device.
  const done = (await space.read<string[]>("done_sessions")) ?? [];
  await space.write("done_sessions", done.filter((id) => b.packages.some((p) => p.planned_session_id === id)));
  const here = new Set((await listSpaces()).map((s) => s.id));
  for (const id of b.ended_spaces) if (id !== space.id && here.has(id)) await removeSpace(id);
  // Video refs hold no patient data, so they live outside the space: the store serves every space on the device.
  await setMeta(`space_videos:${space.id}`, b.videos);
  if (o.syncVideos !== false && (await getContentMode()) === "local") await syncDeviceVideos();
  return b;
}

/** Brings the device's video store in line with what every space on it needs, plus the library if asked for. */
export async function syncDeviceVideos(onProgress?: (done: number, total: number) => void) {
  if (typeof caches === "undefined") return null;
  const lists: OfflineVideoRef[][] = [];
  for (const s of await listSpaces()) lists.push((await getMeta<OfflineVideoRef[]>(`space_videos:${s.id}`)) ?? []);
  const library = (await getMeta<OfflineVideoRef[] | null>("library_wanted")) ?? null;
  return syncVideos(wantedVideos(lists, library), {
    fetch: (url, init) => fetch(url, init),
    cache: await caches.open(VIDEO_CACHE),
    estimate: async () => {
      const e = await navigator.storage?.estimate?.();
      return { usage: e?.usage ?? 0, quota: e?.quota ?? Number.MAX_SAFE_INTEGER };
    },
    ...(onProgress ? { onProgress } : {}),
  });
}

/** Marks a planned session as played on this device, so Today moves on before the server hears about it. */
export async function markSessionDone(space: OpenSpace, plannedSessionId: string): Promise<void> {
  const done = (await space.read<string[]>("done_sessions")) ?? [];
  if (!done.includes(plannedSessionId)) await space.write("done_sessions", [...done, plannedSessionId]);
}
