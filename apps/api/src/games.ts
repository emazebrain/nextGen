/**
 * The games the API accepts in protocol steps, from their SDK manifests
 * (design doc §8.3). Manifests are plain data, so the API reads them
 * without loading any renderer code.
 */
import type { GameManifest } from "@emb/game-sdk";
import { manifest as catchMe } from "../../../games/catch-me-if-you-can/src/manifest.ts";
import { manifest as orbitalOrder } from "../../../games/orbital-order/src/manifest.ts";
import { manifest as beepBeep } from "../../../games/beep-beep/src/manifest.ts";
import { manifest as echoKeys } from "../../../games/echo-keys/src/manifest.ts";
import { manifest as blockCrasher } from "../../../games/block-crasher/src/manifest.ts";
import { manifest as tunnelRush } from "../../../games/tunnel-rush/src/manifest.ts";
import { manifest as peekPeek } from "../../../games/peek-peek/src/manifest.ts";
import type { GameStepInput } from "../../../packages/contracts/src/index.ts";

export const GAME_MANIFESTS: Record<string, GameManifest> = { [catchMe.id]: catchMe, [peekPeek.id]: peekPeek, [orbitalOrder.id]: orbitalOrder, [tunnelRush.id]: tunnelRush, [beepBeep.id]: beepBeep, [echoKeys.id]: echoKeys, [blockCrasher.id]: blockCrasher };

/** Checks a step against its game: the game exists, supports the mode, and its own settings match the schema. */
export function checkStepAgainstGame(step: GameStepInput, index: number): Array<{ path: string; code: string }> {
  const m = GAME_MANIFESTS[step.game_id];
  const at = (p: string) => `steps.${index}.${p}`;
  if (!m) return [{ path: at("game_id"), code: "unknown_game" }];
  const issues: Array<{ path: string; code: string }> = [];
  if (!m.capabilities.modes.includes(step.session_mode)) issues.push({ path: at("session_mode"), code: "mode_not_supported" });
  if (step.trial_window_ms !== null) {
    const tw = m.capabilities.trialWindow;
    if (!tw || step.trial_window_ms < tw.minMs || step.trial_window_ms > tw.maxMs) issues.push({ path: at("trial_window_ms"), code: "trial_window_not_supported" });
  }
  if (step.monochrome && !m.capabilities.monochrome) issues.push({ path: at("monochrome"), code: "monochrome_not_supported" });
  if (step.lives_auto && !m.capabilities.livesAuto) issues.push({ path: at("lives"), code: "lives_auto_not_supported" });
  for (const [key, value] of Object.entries(step.game_params)) {
    const def = m.paramsSchema.properties[key];
    if (!def) {
      issues.push({ path: at(`game_params.${key}`), code: "unknown_setting" });
      continue;
    }
    const ok =
      (def.type === "boolean" && typeof value === "boolean") ||
      ((def.type === "integer" || def.type === "number") &&
        typeof value === "number" &&
        (def.type === "number" || Number.isInteger(value)) &&
        (def.minimum === undefined || value >= def.minimum) &&
        (def.maximum === undefined || value <= def.maximum) &&
        (!def.enum || def.enum.includes(value))) || // e.g. Tunnel Rush lanes: 6, 8, 10 or 12 only
      (def.type === "string" && typeof value === "string" && (!def.enum || def.enum.includes(value)));
    if (!ok) issues.push({ path: at(`game_params.${key}`), code: "invalid_setting" });
  }
  return issues;
}
