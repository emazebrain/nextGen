/**
 * Installing the app (offline devices spec §7.1, §7.6): Chromium browsers offer an install prompt we can show from a
 * button; Safari on iPad/iPhone needs Share → Add to Home Screen, so the page explains that instead.
 */
import { useSyncExternalStore } from "react";
import { isInstalled } from "./session.tsx";

type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };
let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as PromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    emit();
  });
}

const isIos = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));

export function useInstall(): { installed: boolean; canPrompt: boolean; ios: boolean; prompt: () => Promise<void> } {
  const canPrompt = useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => deferred !== null,
  );
  return {
    installed: isInstalled(),
    canPrompt,
    ios: isIos(),
    prompt: async () => {
      if (!deferred) return;
      await deferred.prompt();
      await deferred.userChoice.catch(() => undefined);
      deferred = null;
      emit();
    },
  };
}
