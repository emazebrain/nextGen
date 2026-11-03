/**
 * Progress maths for the patient Progress view (design doc §5.9, §11.6).
 *
 * Every point is compared with this child's own baseline: the mean of their
 * first sessions of the same game at the same difficulty, on the same side
 * (hemisphere) and in the same colour mode (ADR 0009: the sides look and
 * reward differently, so they are different visual tasks). Scores are
 * direction-adjusted so that higher is always better and 100 means "the same
 * as their baseline". A harder level gets a fresh baseline, so moving up a
 * difficulty never reads as a decline.
 *
 * Deliberately absent: age norms, percentiles, "at risk" or "below level"
 * labels. Those stay behind a regulatory review (§11.6).
 *
 * Pure: no clock, no I/O, deterministic. Inputs are not mutated.
 */

/** One game played, as the API returns it (subset of GameSessionView). */
export interface SessionInput {
  id: string;
  game_id: string;
  /** ISO timestamp. */
  ended_at: string;
  difficulty: number;
  accuracy: number | null;
  rt_median_ms: number | null;
  metrics: Record<string, unknown>;
  /** Play time with pauses excluded. */
  active_ms?: number;
  /** Side trained; baselines are kept per side (ADR 0009). Missing counts as one shared side. */
  hemisphere?: "left" | "right";
  /** Black and white; baselines are kept apart from colour (ADR 0009). Missing counts as colour. */
  monochrome?: boolean;
}

/** What makes two sessions comparable for a baseline: game, difficulty, side and colour mode. */
export function baselineGroup(s: SessionInput): string {
  return `${s.game_id}|${s.difficulty}|${s.hemisphere ?? "-"}|${s.monochrome ? "bw" : "colour"}`;
}

/** What a metric means, from the game's manifest. */
export interface MetricInfo {
  key: string;
  lowerIsBetter: boolean;
  skills?: string[] | undefined;
}

export interface GameInfo {
  id: string;
  metrics: MetricInfo[];
}

/** Metrics every game reports (results envelope "std", design doc §8.3). */
export const STANDARD_METRICS: readonly MetricInfo[] = [
  { key: "accuracy", lowerIsBetter: false },
  { key: "rt_median_ms", lowerIsBetter: true },
];
export type StandardKey = "accuracy" | "rt_median_ms";

export type View = { kind: "standard"; key: StandardKey } | { kind: "skill"; skill: string };

export type Summary = "not_enough" | "improving" | "steady" | "declining";

export interface TrendPoint {
  sessionId: string;
  gameId: string;
  endedAt: string;
  difficulty: number;
  /** Raw value for standard views (accuracy 0–1, ms); null for skill views. */
  value: number | null;
  /** 100 = this child's baseline at this game and difficulty; higher is better. Null if it can't be scored. */
  score: number | null;
  /** True while this session is one of the sessions that set the baseline. */
  isBaseline: boolean;
  /** True when difficulty differs from the previous point of the same game. */
  difficultyChanged: boolean;
}

export interface Trend {
  points: TrendPoint[];
  summary: Summary;
  /** Mean score of the latest scored sessions after the baseline (null when not_enough). */
  recentScore: number | null;
  /** Sessions with a score, baseline included. */
  scoredCount: number;
}

export interface TrendOptions {
  /** Sessions that set a baseline for each game × difficulty. Design doc §5.9 assumption: 2. */
  baselineSessions?: number;
  /** Fewest scored sessions before a summary is offered. */
  minSessions?: number;
  /** How many recent post-baseline sessions the summary averages. */
  recentWindow?: number;
  /** Scores at or above this read as "improving"; at or below 200 − this, "declining". */
  improvingAt?: number;
}

const DEFAULTS: Required<TrendOptions> = { baselineSessions: 2, minSessions: 3, recentWindow: 3, improvingAt: 110 };

function finite(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Reads a metric's value from a session: standard metrics from columns, the rest from the game's metrics. */
export function metricValue(s: SessionInput, key: string): number | null {
  if (key === "accuracy") return finite(s.accuracy);
  if (key === "rt_median_ms") return finite(s.rt_median_ms);
  return finite(s.metrics?.[key]);
}

/**
 * Score of a value against a baseline: 100 = same; higher is better whatever
 * the metric's direction. Null when the ratio is undefined (zero baseline for
 * a higher-is-better metric, or a zero value for a lower-is-better one).
 */
export function scoreAgainst(value: number, baseline: number, lowerIsBetter: boolean): number | null {
  if (lowerIsBetter) {
    if (value <= 0 || baseline <= 0) return null;
    return (baseline / value) * 100;
  }
  if (baseline <= 0) return null;
  return (value / baseline) * 100;
}

const byTime = (a: SessionInput, b: SessionInput) => a.ended_at.localeCompare(b.ended_at) || a.id.localeCompare(b.id);

/** The metrics a view draws on, for one game. */
export function metricsForView(game: GameInfo | undefined, view: View): MetricInfo[] {
  if (view.kind === "standard") return STANDARD_METRICS.filter((m) => m.key === view.key);
  return (game?.metrics ?? []).filter((m) => m.skills?.includes(view.skill));
}

/** Skills that at least one played game has a metric for, in first-played order. */
export function skillsPlayed(sessions: readonly SessionInput[], games: readonly GameInfo[]): string[] {
  const out: string[] = [];
  for (const s of [...sessions].sort(byTime)) {
    for (const m of games.find((g) => g.id === s.game_id)?.metrics ?? []) {
      for (const skill of m.skills ?? []) if (!out.includes(skill)) out.push(skill);
    }
  }
  return out;
}

export function trend(sessions: readonly SessionInput[], games: readonly GameInfo[], view: View, options: TrendOptions = {}): Trend {
  const o = { ...DEFAULTS, ...options };
  const ordered = [...sessions].sort(byTime);

  // Baselines: per game × difficulty × side × colour mode × metric, mean of the first N sessions that have a value.
  const seen = new Map<string, number[]>(); // key → values so far
  const lastDifficulty = new Map<string, number>(); // game → difficulty
  const points: TrendPoint[] = [];

  for (const s of ordered) {
    const game = games.find((g) => g.id === s.game_id);
    const metrics = metricsForView(game, view);
    if (metrics.length === 0) continue;

    const scores: number[] = [];
    let isBaseline = false;
    let values = 0;
    for (const m of metrics) {
      const v = metricValue(s, m.key);
      if (v === null) continue;
      values += 1;
      const k = `${baselineGroup(s)}|${m.key}`;
      const prior = seen.get(k) ?? [];
      if (prior.length < o.baselineSessions) {
        // This session helps set the baseline; score it against the baseline as it will stand.
        isBaseline = true;
        prior.push(v);
        seen.set(k, prior);
      }
      const base = mean(prior);
      const sc = scoreAgainst(v, base, m.lowerIsBetter);
      if (sc !== null) scores.push(sc);
    }

    // A session that reported none of this view's metrics isn't part of this trend.
    if (values === 0) continue;
    const prevDiff = lastDifficulty.get(s.game_id);
    lastDifficulty.set(s.game_id, s.difficulty);
    const value = view.kind === "standard" ? metricValue(s, view.key) : null;

    points.push({
      sessionId: s.id,
      gameId: s.game_id,
      endedAt: s.ended_at,
      difficulty: s.difficulty,
      value,
      score: scores.length ? round1(mean(scores)) : null,
      isBaseline,
      difficultyChanged: prevDiff !== undefined && prevDiff !== s.difficulty,
    });
  }

  // Baseline sessions were scored against a partial baseline while they arrived; re-score them
  // against the final baseline so the chart doesn't show artificial wobble at the start.
  for (const p of points) {
    if (!p.isBaseline) continue;
    const s = ordered.find((x) => x.id === p.sessionId)!;
    const scores: number[] = [];
    for (const m of metricsForView(games.find((g) => g.id === s.game_id), view)) {
      const v = metricValue(s, m.key);
      const base = seen.get(`${baselineGroup(s)}|${m.key}`);
      if (v === null || !base?.length) continue;
      const sc = scoreAgainst(v, mean(base), m.lowerIsBetter);
      if (sc !== null) scores.push(sc);
    }
    p.score = scores.length ? round1(mean(scores)) : null;
  }

  const scored = points.filter((p) => p.score !== null);
  const after = scored.filter((p) => !p.isBaseline);
  if (scored.length < o.minSessions || after.length === 0) {
    return { points, summary: "not_enough", recentScore: null, scoredCount: scored.length };
  }
  const recent = round1(mean(after.slice(-o.recentWindow).map((p) => p.score!)));
  const summary: Summary = recent >= o.improvingAt ? "improving" : recent <= 200 - o.improvingAt ? "declining" : "steady";
  return { points, summary, recentScore: recent, scoredCount: scored.length };
}

/** Plain totals for the summary tiles. `now` is passed in (no clock here). */
export function activity(sessions: readonly SessionInput[], now: Date, days = 30) {
  const since = now.getTime() - days * 86_400_000;
  const recent = sessions.filter((s) => Date.parse(s.ended_at) >= since);
  const activeMs = recent.reduce((sum, s) => sum + (s.active_ms ?? 0), 0);
  const last = [...sessions].sort(byTime).at(-1);
  return { sessions: recent.length, minutes: Math.round(activeMs / 60_000), lastPlayed: last?.ended_at ?? null };
}

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
