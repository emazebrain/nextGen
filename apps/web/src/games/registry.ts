/**
 * Games the app knows about. Each game's manifest drives the Library and,
 * later, the protocol step editor (design doc §8.3); its frame bundle is
 * loaded only when someone plays, so the app's own bundle stays small.
 */
import type { GameManifest, LocalText, PlatformParams } from "@emb/game-sdk";
import { timerPositionFor } from "@emb/session-rules";
import { manifest as catchMe } from "@emb/game-catch-me/manifest";

export interface GameEntry {
  manifest: GameManifest;
  loadFrame: () => Promise<string>;
}

export const GAMES: GameEntry[] = [
  { manifest: catchMe, loadFrame: () => import("@emb/game-runtime/frames/catch-me-if-you-can.js?raw").then((m) => m.default) },
];

/** The other v1 games, being rebuilt on the SDK (design doc §8.4). */
export const UPCOMING: Array<{ id: string; name: LocalText }> = [
  { id: "peek-peek", name: { en: "Peek Peek" } },
  { id: "orbital-order", name: { en: "Orbital Order" } },
  { id: "beep-beep", name: { en: "Beep Beep" } },
  { id: "echo-keys", name: { en: "Echo Keys" } },
  { id: "block-crasher", name: { en: "Block Crasher" } },
  { id: "tunnel-rush", name: { en: "Tunnel Rush" } },
];

export const findGame = (id: string) => GAMES.find((g) => g.manifest.id === id);

export function localText(t: LocalText, locale: string): string {
  return (t as Record<string, string | undefined>)[locale] ?? t.en;
}

/** Platform defaults (design doc §8.2) with overrides. */
export function launchParams(overrides: Partial<PlatformParams> & Record<string, unknown> = {}): PlatformParams & Record<string, unknown> {
  const hemisphere = (overrides.hemisphere as PlatformParams["hemisphere"]) ?? "left";
  return {
    session_mode: "timed_lives",
    duration_s: 300,
    lives: 3,
    difficulty: 3,
    start_level: "from_difficulty",
    hemisphere,
    timer_position: timerPositionFor(hemisphere, true),
    trial_window_ms: null,
    practice: "auto",
    instructions: "auto",
    lang: "he",
    sound: "off",
    reduce_motion: "os",
    high_contrast: false,
    show_score: true,
    context: "clinic",
    seed: Math.floor(Math.random() * 2 ** 31),
    input_assist: "none",
    speed_scale: 1,
    ...overrides,
  };
}
