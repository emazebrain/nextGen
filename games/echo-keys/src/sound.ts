/**
 * Synthesised piano sounds (ADR 0016) until the commissioned samples arrive (§8.5): a warm piano-like tone for the
 * warm look, a celesta/glockenspiel-like tone for the cold one. Web Audio only, no files and no network. The
 * audio context starts on the first key press (browsers allow sound only after a gesture).
 */
export class Synth {
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
        this.master.gain.value = 0.35;
        this.master.connect(this.ctx.destination);
      } catch {
        return null;
      }
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
    return this.ctx;
  }

  /** One note. `soft` for missed or demo notes. */
  note(midi: number, soft = false) {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const f = 440 * 2 ** ((midi - 69) / 12);
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.connect(this.master);
    const peak = soft ? 0.25 : 0.6;
    // Warm: a piano-like blend that fades over about a second. Cold: bell partials that ring and fade fast.
    const partials: Array<[number, number, OscillatorType]> = this.kind === "warm" ? [[1, 1, "triangle"], [2, 0.35, "sine"], [3, 0.12, "sine"]] : [[1, 1, "sine"], [4, 0.3, "sine"], [6.8, 0.12, "sine"]];
    const decay = this.kind === "warm" ? 1.1 : 0.7;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + 0.008);
    out.gain.exponentialRampToValueAtTime(0.001, t + decay);
    for (const [mult, amp, type] of partials) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = f * mult;
      g.gain.value = amp;
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + decay + 0.05);
    }
  }

  /** A soft, low bump for a spiky ball (never a buzzer, §11.6). */
  bump() {
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(90, t + 0.18);
    g.gain.setValueAtTime(0.3, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.25);
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
