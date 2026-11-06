/**
 * Echo Keys measures (design doc §8.4 "Game metrics"). Pure: built from the object outcomes.
 *
 * - response_ms: from when a note became tappable (its arrival − the hit window) to the tap; mean, median, fastest.
 * - timing_error_ms_mean: signed, tap − arrival (negative = early).
 * - go/no-go: hits and misses on notes, false alarms and correct rejections on balls, and d′ with the log-linear
 *   correction (Hautus 1995), so a perfect run still gives a finite value.
 */
import type { FallingObject } from "./engine.ts";

interface MelodyRecord {
  id: string;
  phrases: number;
  phrasesFailed: number;
  phrasePlays: number;
  notes: number;
  hits: number;
  misses: number;
  wrong: number;
  falseAlarms: number;
  bestStreak: number;
  absErr: number[];
  completed: boolean;
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const r3 = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
const r0 = (n: number | null) => (n === null ? null : Math.round(n));

/** Inverse of the standard normal CDF (Acklam's rational approximation, |error| < 1.2e-9). */
export function probit(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) / ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1);
  }
  if (p > 1 - lo) return -probit(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) / (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1);
}

export class EchoMetrics {
  readonly melodies: MelodyRecord[] = [];
  hits = 0;
  misses = 0;
  wrongPresses = 0;
  strayPresses = 0;
  falseAlarms = 0;
  rejections = 0;
  bestStreak = 0;
  readonly responses: number[] = [];
  readonly errors: number[] = [];
  private streak = 0;
  private cur: MelodyRecord | null = null;

  startMelody(id: string, phrases: number) {
    this.cur = { id, phrases, phrasesFailed: 0, phrasePlays: 0, notes: 0, hits: 0, misses: 0, wrong: 0, falseAlarms: 0, bestStreak: 0, absErr: [], completed: false };
    this.melodies.push(this.cur);
  }

  object(o: FallingObject, now: number, windowMs: number) {
    const m = this.cur;
    if (o.result === "hit") {
      this.hits += 1;
      this.streak += 1;
      this.bestStreak = Math.max(this.bestStreak, this.streak);
      this.responses.push(Math.max(0, now - (o.t - windowMs)));
      this.errors.push(o.errMs ?? 0);
      if (m) {
        m.notes += 1;
        m.hits += 1;
        m.absErr.push(Math.abs(o.errMs ?? 0));
        m.bestStreak = Math.max(m.bestStreak, this.streak);
      }
    } else if (o.result === "miss") {
      this.misses += 1;
      this.streak = 0;
      if (m) {
        m.notes += 1;
        m.misses += 1;
      }
    } else if (o.result === "false_alarm") {
      this.falseAlarms += 1;
      if (m) m.falseAlarms += 1;
    } else if (o.result === "rejected") {
      this.rejections += 1;
    }
  }

  wrong() {
    this.wrongPresses += 1;
    this.streak = 0;
    if (this.cur) this.cur.wrong += 1;
  }

  stray() {
    this.strayPresses += 1;
  }

  phrase(failed: boolean) {
    if (!this.cur) return;
    this.cur.phrasePlays += 1;
    if (failed) this.cur.phrasesFailed += 1;
  }

  endMelody() {
    if (this.cur) this.cur.completed = true;
    this.cur = null;
  }

  summary(goNoGo: boolean) {
    const go = this.hits + this.misses;
    const nogo = this.falseAlarms + this.rejections;
    let dPrime: number | null = null;
    if (goNoGo && go > 0 && nogo > 0) {
      const h = (this.hits + 0.5) / (go + 1);
      const f = (this.falseAlarms + 0.5) / (nogo + 1);
      dPrime = probit(h) - probit(f);
    }
    return {
      notes: go,
      hits: this.hits,
      misses: this.misses,
      accuracy: go ? r3(this.hits / go) : null,
      wrong_presses: this.wrongPresses,
      response_ms_mean: r0(mean(this.responses)),
      response_ms_median: r0(median(this.responses)),
      response_ms_fastest: this.responses.length ? Math.round(Math.min(...this.responses)) : null,
      timing_error_ms_mean: r0(mean(this.errors)),
      timing_error_ms_abs_mean: r0(mean(this.errors.map(Math.abs))),
      best_streak: this.bestStreak,
      melodies_completed: this.melodies.filter((m) => m.completed).length,
      phrases_failed: this.melodies.reduce((a, m) => a + m.phrasesFailed, 0),
      ...(goNoGo
        ? {
            nogo_balls: nogo,
            false_alarms: this.falseAlarms,
            correct_rejections: this.rejections,
            false_alarm_rate: nogo ? r3(this.falseAlarms / nogo) : null,
            d_prime: r3(dPrime),
          }
        : {}),
      per_melody: this.melodies.map((m) => ({
        melody: m.id,
        completed: m.completed,
        phrases: m.phrases,
        phrases_failed: m.phrasesFailed,
        notes: m.notes,
        hits: m.hits,
        misses: m.misses,
        wrong: m.wrong,
        false_alarms: m.falseAlarms,
        best_streak: m.bestStreak,
        mean_abs_timing_ms: r0(mean(m.absErr)),
      })),
    };
  }
}
