/**
 * A parent is signed out after four minutes without activity. The portal is used on family phones and shared
 * computers, so it must not stay open. Activity is a touch, a key, a scroll, and — during a session — the game
 * being played or the video playing, so a child is never signed out in the middle of an activity.
 *
 * The time of the last activity is also kept on the device: a parent who closed the tab without signing out and
 * comes back later is signed out on return, rather than finding the portal still open.
 */
import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { authClient } from "../../api/auth.ts";
import { useIdleTimeout } from "../../lib/idle.ts";

export const PARENT_IDLE_LIMIT_MS = 4 * 60 * 1000;
const KEY = "emb.parent.lastActive";
const ACTIVITY = ["pointerdown", "keydown", "wheel", "touchstart", "scroll", "emb:activity"] as const;

const read = (): number | null => {
  try {
    const n = Number(localStorage.getItem(KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
};
const write = (at: number | null) => {
  try {
    if (at === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, String(at));
  } catch {
    /* the timer on this page still applies */
  }
};

/** Forget the last activity (on signing out, so the next sign-in starts fresh). */
export const forgetParentActivity = () => write(null);

export function useParentIdleSignOut(enabled = true, limitMs = PARENT_IDLE_LIMIT_MS) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = useCallback(async () => {
    write(null);
    await authClient.signOut().catch(() => {});
    qc.clear();
    navigate("/sign-in?reason=idle", { replace: true });
  }, [navigate, qc]);

  useEffect(() => {
    if (!enabled) return;
    // Back after the tab was closed for longer than the limit: sign out now.
    const last = read();
    if (last !== null && Date.now() - last >= limitMs) {
      void signOut();
      return;
    }
    write(Date.now());
    let stamped = Date.now();
    const touch = () => {
      const now = Date.now();
      if (now - stamped < 5_000) return; // often enough for a four-minute limit
      stamped = now;
      write(now);
    };
    for (const e of ACTIVITY) window.addEventListener(e, touch, { passive: true, capture: true });
    return () => {
      for (const e of ACTIVITY) window.removeEventListener(e, touch, { capture: true });
    };
  }, [enabled, limitMs, signOut]);

  useIdleTimeout(() => {
    if (enabled) void signOut();
  }, limitMs, 10_000);
}
