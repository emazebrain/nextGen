/**
 * Keeps the open space's bundle fresh while online (offline devices spec §7.3): when the space opens, every 15
 * minutes while the app is open and online, and on "Update now" from the Device page.
 */
import { useEffect, useSyncExternalStore } from "react";
import { usePrefs } from "../i18n/index.tsx";
import { REFRESH_MS, refreshBundle } from "./bundle.ts";
import { useOptionalDevice } from "./session.tsx";

let refreshing = false;
let lastError = false;
let trigger: (() => Promise<void>) | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export function useRefreshState(): { refreshing: boolean; failed: boolean; refreshNow: () => Promise<void> } {
  const snap = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => `${refreshing}:${lastError}`,
  );
  const [r, f] = snap.split(":");
  return { refreshing: r === "true", failed: f === "true", refreshNow: () => trigger?.() ?? Promise.resolve() };
}

export function useBundleRefresh(): void {
  const device = useOptionalDevice();
  const { locale } = usePrefs();
  const space = device?.space ?? null;
  const deviceId = device?.deviceId ?? null;
  const online = device?.online ?? false;
  useEffect(() => {
    if (!space || !deviceId) return;
    const run = async () => {
      if (refreshing) return;
      refreshing = true;
      emit();
      try {
        await refreshBundle(space, deviceId, locale);
        lastError = false;
        await device?.refreshSpaces();
      } catch {
        lastError = true;
      } finally {
        refreshing = false;
        emit();
      }
    };
    trigger = run;
    if (online) void run();
    const timer = window.setInterval(() => {
      if (navigator.onLine) void run();
    }, REFRESH_MS);
    return () => {
      window.clearInterval(timer);
      if (trigger === run) trigger = null;
    };
    // device is stable enough: refreshSpaces is memoised in the provider
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [space, deviceId, online, locale]);
}
