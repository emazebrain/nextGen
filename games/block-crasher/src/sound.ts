/**
 * Synthesised effects (ADR 0017) until the commissioned sounds arrive (§8.4 asset table): warm wood-block hits and
 * a marimba level-up; cold glass taps and a celesta level-up. Web Audio only, no files and no network. The audio
 * context starts on the first serve (browsers allow sound only after a gesture).
 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;

  constructor(private readonly kind: "warm" | "cold", private readonly enabled: boolean) {}

  private ensure(): AudioContext | null {
    if (!this.enabled) return null;
    if (!this.ctx) {
      try {
        const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.master = this.ctx.createGain();
        this.master.gain.value = 0.3;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** Call from a user gesture so later sounds are allowed. */
  unlock() {
    this.ensure();
  }

  private tone(freq: number, at: number, decay: number, peak: number, type: OscillatorType = "sine", partials: Array<[number, number]> = [[1, 1]]) {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const out = ctx.createGain();
    out.connect(this.master);
    out.gain.setValueAtTime(0, at);
    out.gain.linearRampToValueAtTime(peak, at + 0.004);
    out.gain.exponentialRampToValueAtTime(0.001, at + decay);
    for (const [m, a] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq * m;
      g.gain.value = a;
      o.connect(g).connect(out);
      o.start(at);
      o.stop(at + decay + 0.05);
    }
  }

  /** Paddle bounce: low and round. */
  paddle() {
    const ctx = this.ensure();
    if (!ctx) return;
    if (this.kind === "warm") this.tone(330, ctx.currentTime, 0.12, 0.45, "triangle", [[1, 1], [2.8, 0.2]]);
    else this.tone(990, ctx.currentTime, 0.18, 0.3, "sine", [[1, 1], [2.4, 0.25]]);
  }

  /** Brick hit: a wood block (warm) or a glass tap (cold); `row` lifts the pitch a little. */
  brick(row: number, broke: boolean) {
    const ctx = this.ensure();
    if (!ctx) return;
    const lift = 2 ** ((row % 6) / 12);
    if (this.kind === "warm") this.tone(620 * lift, ctx.currentTime, broke ? 0.09 : 0.06, broke ? 0.5 : 0.3, "square", [[1, 0.5], [1.5, 0.3]]);
    else this.tone(1760 * lift, ctx.currentTime, broke ? 0.3 : 0.18, broke ? 0.3 : 0.18, "sine", [[1, 1], [2.76, 0.3], [5.4, 0.1]]);
  }

  /** A special brick: a short rising pair. */
  special() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = this.kind === "warm" ? 523 : 1047;
    this.tone(base, t, 0.25, 0.35, this.kind === "warm" ? "triangle" : "sine");
    this.tone(base * 1.5, t + 0.08, 0.3, 0.35, this.kind === "warm" ? "triangle" : "sine");
  }

  /** A lost ball: a soft falling note, never a buzzer (§11.6). */
  lost() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(260, t);
    o.frequency.exponentialRampToValueAtTime(130, t + 0.3);
    g.gain.setValueAtTime(0.25, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.4);
  }

  /** Level up: a marimba (warm) or celesta (cold) arpeggio. */
  levelUp() {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const base = this.kind === "warm" ? 392 : 784;
    [1, 1.25, 1.5, 2].forEach((m, i) => {
      if (this.kind === "warm") this.tone(base * m, t + i * 0.11, 0.35, 0.45, "sine", [[1, 1], [4, 0.15]]);
      else this.tone(base * m, t + i * 0.11, 0.6, 0.3, "sine", [[1, 1], [4, 0.3], [6.8, 0.1]]);
    });
  }

  suspend() {
    void this.ctx?.suspend();
  }

  resume() {
    if (this.ctx?.state === "suspended") void this.ctx.resume();
  }

  close() {
    void this.ctx?.close();
  }
}
