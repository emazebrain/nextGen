/**
 * Echo Keys flow (design doc §8.4), pure: the renderer passes `now` (pause-adjusted ms). Melodies are played one
 * phrase at a time; each note falls towards its key and must be tapped within ± the hit window of its arrival.
 * With go/no-go on, spiky balls fall in the gaps between notes and must be left alone.
 *
 * A phrase fails at 3 or more errors (missed notes plus wrong keys) [§8.4 Assumption]; a failed phrase is played
 * once more, then the melody goes on. Pressing a no-go ball is its own event. Session Rules decides what either
 * costs.
 */
import { DIFFICULTY, KEYBOARDS, melodiesFor, phrases, PRACTICE, PRACTICE_BPM, type Difficulty, type Melody, type Note } from "./music.ts";
import { EchoMetrics } from "./metrics.ts";

export const PHRASE_FAIL_ERRORS = 3;
const REST_BEATS = 1.5;

export interface EngineConfig {
  difficulty: Difficulty;
  goNoGo: boolean;
  /** Hemisphere lean for no-go balls: the half of the keyboard most of them fall on (p = 0.75), or null. */
  lean: "L" | "R" | null;
  rng: () => number;
  practice?: boolean;
  /** `echo_keys.key_count`: a fixed keyboard size instead of the difficulty's. */
  keyCount?: 5 | 8 | 13;
}

export interface FallingObject {
  id: number;
  kind: "go" | "nogo";
  /** Index of the key on the keyboard. */
  key: number;
  midi: number;
  /** When it reaches the keys (ms on the game clock). */
  t: number;
  beats: number;
  melody: string;
  phrase: number;
  result: null | "hit" | "miss" | "rejected" | "false_alarm";
  errMs: number | null;
}

export type PressResult =
  | { kind: "hit"; obj: FallingObject; errMs: number }
  | { kind: "false_alarm"; obj: FallingObject }
  | { kind: "wrong" }
  | { kind: "idle" };

export interface UpdateEvents {
  missed: FallingObject[];
  rejected: FallingObject[];
  phraseDone: null | { melody: string; phrase: number; errors: number; failed: boolean; repeat: boolean };
  melodyDone: string | null;
  setDone: boolean;
}

export class EchoEngine {
  readonly keys: number[];
  readonly bpm: number;
  readonly windowMs: number;
  readonly metrics = new EchoMetrics();
  readonly melodies: Melody[];
  objects: FallingObject[] = [];
  melodyIdx = 0;
  phraseIdx = 0;
  started = false;
  done = false;
  score = 0;
  streak = 0;
  private phrasesOf: Note[][] = [];
  private phraseErrors = 0;
  private phraseEnd = Infinity;
  private phraseStart = 0;
  private repeating = false;
  private nextId = 1;

  constructor(private readonly cfg: EngineConfig) {
    const d = DIFFICULTY[cfg.difficulty];
    this.keys = KEYBOARDS[cfg.keyCount ?? d.keys];
    this.bpm = cfg.practice ? PRACTICE_BPM : d.bpm;
    this.windowMs = cfg.practice ? Math.max(d.windowMs, 350) : d.windowMs;
    this.melodies = cfg.practice ? [PRACTICE] : shuffle(melodiesFor(this.keys), cfg.rng);
  }

  get beatMs() {
    return 60_000 / this.bpm;
  }
  /** How long a note is on screen before it reaches the keys. */
  get travelMs() {
    return Math.max(1400, 2.5 * this.beatMs);
  }
  get melody(): Melody | undefined {
    return this.melodies[this.melodyIdx];
  }
  get phraseCount() {
    return this.phrasesOf.length;
  }

  /** The first key press starts the music (§8.4: the clock starts on the first key press). */
  begin(now: number) {
    if (this.started) return;
    this.started = true;
    this.startMelody(now);
  }

  private startMelody(now: number) {
    const m = this.melody;
    if (!m) {
      this.done = true;
      return;
    }
    this.phrasesOf = this.cfg.practice ? [m.notes] : phrases(m, DIFFICULTY[this.cfg.difficulty].phrase);
    this.phraseIdx = 0;
    this.metrics.startMelody(m.id, this.phrasesOf.length);
    this.schedulePhrase(now);
  }

  private schedulePhrase(now: number) {
    const notes = this.phrasesOf[this.phraseIdx]!;
    const m = this.melody!;
    const start = now + this.travelMs;
    let beat = 0;
    const go: FallingObject[] = notes.map(([midi, beats]) => {
      const o: FallingObject = { id: this.nextId++, kind: "go", key: this.keys.indexOf(midi), midi, t: start + beat * this.beatMs, beats, melody: m.id, phrase: this.phraseIdx, result: null, errMs: null };
      beat += beats;
      return o;
    });
    const nogo = this.cfg.goNoGo && !this.cfg.practice ? this.placeNoGo(go) : [];
    this.objects = [...go, ...nogo].sort((a, b) => a.t - b.t);
    this.phraseErrors = 0;
    this.phraseStart = now;
    this.phraseEnd = go[go.length - 1]!.t + this.windowMs + 50;
  }

  /**
   * No-go balls go in the gaps between notes (never within a hit window of a note on the same key). About the
   * difficulty's share of all objects; three in four land on the hemisphere's half of the keyboard (ADR 0016).
   */
  private placeNoGo(go: FallingObject[]): FallingObject[] {
    const rate = DIFFICULTY[this.cfg.difficulty].nogoRate;
    const p = Math.min(0.9, rate / (1 - rate)); // no-go per gap, so no-go / all objects ≈ rate
    const out: FallingObject[] = [];
    const half = Math.floor(this.keys.length / 2);
    const leftKeys = this.keys.map((_, i) => i).filter((i) => i < half);
    const rightKeys = this.keys.map((_, i) => i).filter((i) => i >= this.keys.length - half);
    for (let i = 0; i < go.length - 1; i++) {
      const a = go[i]!;
      const b = go[i + 1]!;
      if (b.t - a.t < Math.max(2 * this.windowMs, 0.75 * this.beatMs) || this.cfg.rng() >= p) continue;
      const t = (a.t + b.t) / 2;
      const clashes = (k: number) => go.some((o) => o.key === k && Math.abs(o.t - t) < this.windowMs * 1.5);
      let pool: number[];
      if (this.cfg.lean) pool = this.cfg.rng() < 0.75 ? (this.cfg.lean === "R" ? rightKeys : leftKeys) : this.cfg.lean === "R" ? leftKeys : rightKeys;
      else pool = this.keys.map((_, k) => k);
      pool = pool.filter((k) => !clashes(k));
      if (!pool.length) continue;
      const key = pool[Math.floor(this.cfg.rng() * pool.length)]!;
      out.push({ id: this.nextId++, kind: "nogo", key, midi: this.keys[key]!, t, beats: 0.5, melody: a.melody, phrase: a.phrase, result: null, errMs: null });
    }
    return out;
  }

  /** A key press. */
  press(key: number, now: number): PressResult {
    if (!this.started) this.begin(now);
    const w = this.windowMs;
    const open = this.objects.filter((o) => o.result === null && o.key === key && Math.abs(now - o.t) <= w);
    const go = open.filter((o) => o.kind === "go").sort((a, b) => Math.abs(now - a.t) - Math.abs(now - b.t))[0];
    if (go) {
      go.result = "hit";
      go.errMs = Math.round(now - go.t);
      this.streak += 1;
      const points = 10 + (Math.abs(go.errMs) <= w / 3 ? 5 : 0);
      if (!this.cfg.practice) this.score += points;
      this.metrics.object(go, now, w);
      return { kind: "hit", obj: go, errMs: go.errMs };
    }
    const nogo = open.find((o) => o.kind === "nogo");
    if (nogo) {
      nogo.result = "false_alarm";
      this.metrics.object(nogo, now, w);
      return { kind: "false_alarm", obj: nogo };
    }
    // A key with nothing on it. During a phrase it's a wrong note; between phrases it's just a stray tap.
    const inPhrase = now >= this.phraseStart + this.travelMs - w && now <= this.phraseEnd;
    if (inPhrase && !this.done) {
      this.phraseErrors += 1;
      this.streak = 0;
      this.metrics.wrong();
      return { kind: "wrong" };
    }
    this.metrics.stray();
    return { kind: "idle" };
  }

  /** Advances time: notes past their window are missed, balls past theirs were rightly left alone. */
  update(now: number): UpdateEvents {
    const ev: UpdateEvents = { missed: [], rejected: [], phraseDone: null, melodyDone: null, setDone: false };
    if (!this.started || this.done) return ev;
    for (const o of this.objects) {
      if (o.result !== null || now <= o.t + this.windowMs) continue;
      if (o.kind === "go") {
        o.result = "miss";
        this.phraseErrors += 1;
        this.streak = 0;
        ev.missed.push(o);
      } else {
        o.result = "rejected";
        ev.rejected.push(o);
      }
      this.metrics.object(o, now, this.windowMs);
    }
    if (now < this.phraseEnd) return ev;
    // The phrase is over.
    const m = this.melody!;
    const failed = !this.cfg.practice && this.phraseErrors >= PHRASE_FAIL_ERRORS;
    const repeat = failed && !this.repeating;
    this.metrics.phrase(failed);
    ev.phraseDone = { melody: m.id, phrase: this.phraseIdx, errors: this.phraseErrors, failed, repeat };
    const next = now + REST_BEATS * this.beatMs; // a short rest before the next phrase starts falling
    if (repeat) {
      this.repeating = true;
    } else {
      this.repeating = false;
      this.phraseIdx += 1;
    }
    if (this.phraseIdx >= this.phrasesOf.length) {
      this.metrics.endMelody();
      ev.melodyDone = m.id;
      this.melodyIdx += 1;
      if (this.melodyIdx >= this.melodies.length) {
        this.done = true;
        this.objects = [];
        ev.setDone = true;
        return ev;
      }
      this.startMelody(next + this.beatMs); // a little longer rest between melodies
      return ev;
    }
    this.schedulePhrase(next);
    return ev;
  }

  /** Objects to draw: those within their travel time of the keys, plus a short tail after. */
  visible(now: number): FallingObject[] {
    return this.objects.filter((o) => o.t - now <= this.travelMs && now - o.t <= 400);
  }
}

function shuffle<T>(a: T[], rng: () => number): T[] {
  const out = [...a];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}
