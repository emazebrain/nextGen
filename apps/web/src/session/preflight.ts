/**
 * Pre-flight before an offline start (offline devices spec §7.4): every step must be playable before the child gets
 * the tablet, never discovered missing halfway. Games are part of the installed app; an uploaded video must be
 * stored on the device unless it's online; a YouTube video always needs the Internet.
 */
import type { SessionPackage } from "@emb/contracts";

export type Preflight = { ok: true } | { ok: false; missing: Array<{ ordinal: number; kind: "game" | "video"; title: string }> };

export async function preflight(pkg: Pick<SessionPackage, "steps">, o: { online: boolean; hasVideo: (id: string, version: number) => Promise<boolean> }): Promise<Preflight> {
  if (o.online) return { ok: true };
  const missing: Array<{ ordinal: number; kind: "game" | "video"; title: string }> = [];
  for (const s of pkg.steps) {
    if (s.kind !== "video" || s.done) continue;
    const v = s.video;
    const stored = v.source === "upload" && !!v.file_url && (await o.hasVideo(v.id, v.version));
    if (!stored) missing.push({ ordinal: s.ordinal, kind: "video", title: v.title });
  }
  return missing.length ? { ok: false, missing } : { ok: true };
}
