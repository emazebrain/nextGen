/**
 * Pre-flight before an offline start (offline devices spec §7.4): every step must be playable before the child gets
 * the tablet, never discovered missing halfway. Games are part of the installed app; an uploaded video must be
 * stored on the device unless it's online; a YouTube video always needs the Internet.
 */
import type { SessionPackage } from "@emb/contracts";

export type Preflight = { ok: true } | { ok: false; missing: Array<{ ordinal: number; kind: "game" | "video"; title: string }>; expired?: true };

/** A ticket's expiry, read from its payload (the device can't check the signature; the server does). */
function ticketExp(ticket: string): number | null {
  try {
    const part = ticket.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
    const exp = (JSON.parse(atob(part)) as { exp?: unknown }).exp;
    return typeof exp === "number" ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export async function preflight(pkg: Pick<SessionPackage, "steps">, o: { online: boolean; hasVideo: (id: string, version: number) => Promise<boolean> }): Promise<Preflight> {
  const missing: Array<{ ordinal: number; kind: "game" | "video"; title: string }> = [];
  for (const s of o.online ? [] : pkg.steps) {
    if (s.kind !== "video" || s.done) continue;
    const v = s.video;
    const stored = v.source === "upload" && !!v.file_url && (await o.hasVideo(v.id, v.version));
    if (!stored) missing.push({ ordinal: s.ordinal, kind: "video", title: v.title });
  }
  // The offline pass ran out (no online refresh for a month): results will be kept but flagged for review.
  const now = Date.now();
  const expired = pkg.steps.some((s) => s.kind === "game" && !s.done && (ticketExp(s.ticket) ?? Infinity) < now);
  if (expired) return { ok: false, missing, expired: true };
  return missing.length ? { ok: false, missing } : { ok: true };
}
