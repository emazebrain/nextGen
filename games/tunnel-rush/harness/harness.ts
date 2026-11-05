// Dev-only harness: runs the game without the host, for visual checks. Not shipped.
import game from "../src/index.ts";
const q = new URLSearchParams(location.search);
let s = 7;
const rng = () => ((s = (s * 16807) % 2147483647) / 2147483647);
const mount = document.getElementById("stage")!;
const g = game.create();
const strings = (game.strings as Record<string, Record<string, string>>)[q.get("lang") ?? "en"]!;
const params: Record<string, unknown> = { session_mode: "timed", duration_s: 120, difficulty: Number(q.get("d") ?? 3), hemisphere: q.get("h") ?? "left", lang: "en", show_score: false };
for (const [k, v] of q) if (k.startsWith("tunnel_rush.")) params[k] = isNaN(Number(v)) ? v : Number(v);
const log: string[] = [];
(window as unknown as { __log: string[] }).__log = log;
await g.init({
  params: params as never, assets: null, rng, mount, reducedMotion: q.get("rm") === "1", palette: q.get("h") === "right" ? "cold" : "warm", tokens: {},
  t: (k: string, v?: Record<string, string | number>) => (strings[k] ?? k).replace(/\{(\w+)\}/g, (_, n) => String(v?.[n] ?? "")),
  session: { qualifyingInteraction: () => log.push("qualify"), trial: (t: unknown) => log.push("trial " + JSON.stringify(t)), lifeLossEvent: (id: string) => log.push("life " + id), levelComplete: (r: unknown) => log.push("level " + JSON.stringify(r)), contentExhausted: () => log.push("exhausted"), log: () => {}, onLifeLost: () => {}, onTrialWindow: () => {}, onEnd: () => {}, state: { activeMs: 0, livesRemaining: null, mode: "timed", paused: false } } as never,
} as never);
g.start();
(window as unknown as { __end: () => unknown }).__end = () => g.end("time_up");
