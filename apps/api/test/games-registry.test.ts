/**
 * Every game in the repo can be put in a protocol: the API's list (src/games.ts) names each game package.
 * "It's Left, It's Right" shipped as a game package only and was missing here, so the Library showed it while the
 * API refused it in a protocol step as an unknown game.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GAME_MANIFESTS, checkStepAgainstGame } from "../src/games.ts";

const GAMES_DIR = join(import.meta.dirname, "../../../games");
/** Prototypes that are not offered to clinics. */
const NOT_PRODUCTS = new Set(["tunnel-rush-spike"]);

describe("the API's game list", () => {
  const packages = readdirSync(GAMES_DIR).filter((d) => !NOT_PRODUCTS.has(d) && existsSync(join(GAMES_DIR, d, "src/manifest.ts")));

  it("names every game package in the repo", async () => {
    expect(packages.length).toBeGreaterThan(0);
    const ids = await Promise.all(packages.map(async (d) => ((await import(join(GAMES_DIR, d, "src/manifest.ts"))) as { manifest: { id: string } }).manifest.id));
    expect(Object.keys(GAME_MANIFESTS).sort()).toEqual(ids.sort());
  });

  it("accepts It's Left, It's Right in a protocol step, in a mode the game supports", () => {
    const step = { step_type: "game", game_id: "its-left-its-right", session_mode: "timed_lives", duration_s: 300, lives: 3, lives_auto: false, monochrome: false, trial_window_ms: null, game_params: {} };
    expect(checkStepAgainstGame(step as never, 0)).toEqual([]);
    expect(checkStepAgainstGame({ ...step, game_params: { turbo: true } } as never, 0)).toEqual([{ path: "steps.0.game_params.turbo", code: "unknown_setting" }]);
  });
});
