/**
 * App updates (offline devices spec §7.1): a new build waits until it is applied, and never in the middle of a
 * session. The session runner reports when a session is running.
 */
import { useSyncExternalStore } from "react";

let running = false;
export function setSessionRunning(on: boolean): void {
  running = on;
}
export const sessionRunning = () => running;

export interface Updater {
  ready(): boolean;
  markReady(): void;
  /** Asks the waiting service worker to take over; refused (false) while a session runs. */
  apply(): boolean;
  subscribe(fn: () => void): () => void;
}

export function createUpdater(post: (msg: { type: "apply-update" }) => void): Updater {
  let isReady = false;
  const subs = new Set<() => void>();
  return {
    ready: () => isReady,
    markReady() {
      isReady = true;
      for (const f of subs) f();
    },
    apply() {
      if (!isReady || running) return false;
      post({ type: "apply-update" });
      return true;
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

let shared: Updater | null = null;

/** Registers the service worker (not in the demo build) and wires the shared updater. */
export async function registerServiceWorker(): Promise<void> {
  if (import.meta.env.MODE === "demo" || !("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.register("/sw.js").catch(() => null);
  if (!reg) return;
  shared = createUpdater((msg) => reg.waiting?.postMessage(msg));
  const watch = (w: ServiceWorker | null) => {
    if (!w) return;
    w.addEventListener("statechange", () => {
      if (w.state === "installed" && navigator.serviceWorker.controller) shared!.markReady();
    });
  };
  if (reg.waiting && navigator.serviceWorker.controller) shared.markReady();
  reg.addEventListener("updatefound", () => watch(reg.installing));
  let reloaded = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (reloaded) return;
    reloaded = true;
    location.reload();
  });
}

export function useAppUpdate(): { ready: boolean; apply(): boolean } {
  const ready = useSyncExternalStore(
    (fn) => shared?.subscribe(fn) ?? (() => undefined),
    () => shared?.ready() ?? false,
  );
  return { ready, apply: () => shared?.apply() ?? false };
}
