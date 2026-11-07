/**
 * Starting a session from an offline package (offline devices spec §7.4; ADR 0019). The device decides what the
 * server would have: difficulty from the step's recent results plus the ones played on this device since the bundle
 * (same pure @emb/progression rule, applied in order), practice and instructions from the number of sessions done,
 * a fresh seed. Everything else is exactly as the ticket signs it.
 */
import { offlineParams, paramsWithinAllowed, type LaunchPackage, type LaunchStep, type SessionPackage } from "@emb/contracts";
import { decide, type SessionPoint } from "@emb/progression";

export type { SessionPoint };

export function launchFromPackage(pkg: SessionPackage, localHistory: (assignmentStepId: string) => SessionPoint[], seed: () => number): LaunchPackage {
  const steps = pkg.steps.map((s): LaunchStep => {
    if (s.kind === "video") return s;
    const local = localHistory(s.assignment_step_id);
    // Replay the server's in-order decisions over what this device has played since the package was made.
    let current = s.difficulty;
    const history = [...s.history];
    for (const r of local) {
      history.push(r);
      current = decide(s.progression, history, current).to;
    }
    const { min, max } = s.allowed.difficulty;
    const difficulty = Math.min(max, Math.max(min, current));
    const params = offlineParams(s.base_params, {
      difficulty,
      sessionsCompleted: s.sessions_completed + local.filter((r) => r.valid).length,
      practiceSetting: s.practice_setting,
      seed: seed(),
    });
    if (!paramsWithinAllowed(s.allowed, params)) throw new Error("params_outside_ticket");
    return { kind: "game", assignment_step_id: s.assignment_step_id, ordinal: s.ordinal, game_id: s.game_id, params, ticket: s.ticket, done: s.done };
  });
  const { planned_date: _d, ...rest } = pkg;
  return { ...rest, steps };
}
