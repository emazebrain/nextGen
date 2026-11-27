/**
 * Plays a tune from `tunes.ts` with the Web Audio API and loops it. The host page drives this — games never
 * touch audio output for music, and nothing is fetched: every sound is synthesised on the device.
 *
 *   const player = new MusicPlayer();
 *   player.play(tune);        // starts, or cross-fades to another tune
 *   player.setLevel(0.4);     // 0–1 of the normal volume (lowered while a video plays)
 *   player.stop();
 */
import { midiHz, type Note, type TextureKind, type Tune } from "./tunes.ts";

/** Master volume: quiet enough to sit under the pulsed tones and a game's own sounds. */
const VOLUME = 0.2;
/** Recordings are mastered far louder than the generated tunes; this puts them at about the same level. */
const FILE_VOLUME = 0.3;
const FADE_S = 0.6;

interface Running {
  tune: Tune;
  out: GainNode;
  /** When the next pass of the loop starts, in the context's time. */
  nextAt: number;
  layers: AudioScheduledSourceNode[];
}

export class MusicPlayer {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private current: Running | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private level = 1;
  /** An uploaded recording, when one is playing instead of a generated tune. */
  private file: { id: string; audio: HTMLAudioElement } | null = null;

  get playing(): string | null {
    return this.file?.id ?? this.current?.tune.id ?? null;
  }

  /**
   * Plays an uploaded recording on a loop. If it cannot be loaded or played (offline, a format this device lacks),
   * the generated tune plays instead, so a session is never left silent.
   */
  playFile(track: { id: string; url: string }, fallback: Tune): void {
    if (this.file?.id === track.id) return;
    this.silenceGenerated();
    this.stopFile();
    if (typeof Audio === "undefined") return this.play(fallback);
    const audio = new Audio();
    audio.loop = true;
    audio.preload = "auto";
    audio.volume = FILE_VOLUME * this.level;
    const entry = { id: track.id, audio };
    this.file = entry;
    const giveUp = () => {
      if (this.file !== entry) return; // something else is playing by now
      this.stopFile();
      this.play(fallback);
    };
    audio.addEventListener("error", giveUp, { once: true });
    audio.src = track.url;
    void audio.play().catch(giveUp);
  }

  private stopFile(): void {
    const f = this.file;
    this.file = null;
    if (!f) return;
    f.audio.pause();
    f.audio.removeAttribute("src");
    f.audio.load();
  }

  private silenceGenerated(): void {
    if (this.ctx && this.current) this.fadeOut(this.current, this.ctx.currentTime);
    this.current = null;
  }

  play(tune: Tune): void {
    this.stopFile();
    if (this.current?.tune.id === tune.id) return;
    const ctx = this.ensure();
    if (!ctx || !this.master) return;
    const now = ctx.currentTime;
    this.fadeOut(this.current, now);

    const out = ctx.createGain();
    out.gain.setValueAtTime(0, now);
    out.gain.linearRampToValueAtTime(1, now + FADE_S);
    out.connect(this.master);
    const running: Running = { tune, out, nextAt: now + 0.1, layers: [] };
    this.current = running;
    this.startLayers(ctx, running);
    this.schedule();
    this.timer ??= setInterval(() => this.schedule(), 500);
  }

  setLevel(level: number): void {
    this.level = Math.max(0, Math.min(1, level));
    if (this.file) this.file.audio.volume = FILE_VOLUME * this.level;
    if (this.ctx && this.master) this.master.gain.linearRampToValueAtTime(VOLUME * this.level, this.ctx.currentTime + 0.4);
  }

  stop(): void {
    this.stopFile();
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    const ctx = this.ctx;
    if (!ctx) return;
    this.fadeOut(this.current, ctx.currentTime);
    this.current = null;
    this.ctx = null;
    this.master = null;
    setTimeout(() => void ctx.close().catch(() => undefined), (FADE_S + 0.2) * 1000);
  }

  // ------------------------------------------------------------------------------------------------------- internals

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    const Ctor = typeof window === "undefined" ? undefined : (window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext);
    if (!Ctor) return null; // no audio on this device: the session simply runs without music
    try {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = VOLUME * this.level;
      // A gentle limiter, so many notes at once never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -14;
      limiter.ratio.value = 6;
      master.connect(limiter);
      limiter.connect(ctx.destination);
      const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const data = noise.getChannelData(0);
      // A fixed sequence rather than Math.random: the same hiss on every device.
      let s = 22222;
      for (let i = 0; i < data.length; i++) {
        s = (Math.imul(s, 1103515245) + 12345) | 0;
        data[i] = ((s >>> 8) & 0xffff) / 32768 - 1;
      }
      this.ctx = ctx;
      this.master = master;
      this.noise = noise;
      void ctx.resume().catch(() => undefined);
      return ctx;
    } catch {
      return null;
    }
  }

  private fadeOut(r: Running | null, now: number): void {
    if (!r) return;
    r.out.gain.cancelScheduledValues(now);
    r.out.gain.setValueAtTime(r.out.gain.value, now);
    r.out.gain.linearRampToValueAtTime(0, now + FADE_S);
    for (const l of r.layers) {
      try {
        l.stop(now + FADE_S + 0.05);
      } catch {
        /* already stopped */
      }
    }
    const out = r.out;
    setTimeout(() => out.disconnect(), (FADE_S + 0.3) * 1000);
  }

  /** Queues the next pass of the loop a little before it is due. */
  private schedule(): void {
    const ctx = this.ctx;
    const r = this.current;
    if (!ctx || !r) return;
    while (r.nextAt - ctx.currentTime < 1.5) {
      for (const n of r.tune.notes) this.note(ctx, r.out, n, r.nextAt + n.t);
      r.nextAt += r.tune.length;
    }
  }

  /** The layers that run without a break: the didgeridoo drone and the natural sounds. */
  private startLayers(ctx: AudioContext, r: Running): void {
    const now = ctx.currentTime;
    if (r.tune.drone) {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = midiHz(r.tune.drone.midi);
      const mouth = ctx.createBiquadFilter(); // the moving mouth shape that gives a didgeridoo its "wah"
      mouth.type = "bandpass";
      mouth.Q.value = 4;
      mouth.frequency.value = 420;
      r.layers.push(this.lfo(ctx, mouth.frequency, 0.13, 260, now));
      const g = ctx.createGain();
      g.gain.value = r.tune.drone.gain;
      osc.connect(mouth).connect(g).connect(r.out);
      osc.start(now);
      r.layers.push(osc);
    }
    for (const t of r.tune.textures) this.texture(ctx, r, t.kind, t.gain, now);
  }

  private texture(ctx: AudioContext, r: Running, kind: TextureKind, gain: number, now: number): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    const g = ctx.createGain();
    if (kind === "waves") {
      // The sea: a low rush that swells and falls back about every nine seconds.
      filter.type = "lowpass";
      filter.frequency.value = 520;
      g.gain.value = gain * 0.55;
      r.layers.push(this.lfo(ctx, g.gain, 0.11, gain * 0.4, now));
      r.layers.push(this.lfo(ctx, filter.frequency, 0.11, 220, now));
    } else if (kind === "wind") {
      // Wind: a band of hiss that drifts up and down in pitch and strength, at two unrelated speeds.
      filter.type = "bandpass";
      filter.Q.value = 1.4;
      filter.frequency.value = 700;
      g.gain.value = gain * 0.5;
      r.layers.push(this.lfo(ctx, filter.frequency, 0.07, 320, now));
      r.layers.push(this.lfo(ctx, g.gain, 0.19, gain * 0.3, now));
    } else {
      // Breathing: in and out about every five seconds.
      filter.type = "bandpass";
      filter.Q.value = 0.9;
      filter.frequency.value = 950;
      g.gain.value = gain * 0.4;
      r.layers.push(this.lfo(ctx, g.gain, 0.2, gain * 0.36, now));
      r.layers.push(this.lfo(ctx, filter.frequency, 0.2, 260, now));
    }
    src.connect(filter).connect(g).connect(r.out);
    src.start(now);
    r.layers.push(src);
  }

  /** A slow sine that moves a parameter up and down around the value it already has. */
  private lfo(ctx: AudioContext, target: AudioParam, hz: number, depth: number, now: number): OscillatorNode {
    const osc = ctx.createOscillator();
    osc.frequency.value = hz;
    const amount = ctx.createGain();
    amount.gain.value = depth;
    osc.connect(amount).connect(target);
    osc.start(now);
    return osc;
  }

  private note(ctx: AudioContext, out: AudioNode, n: Note, at: number): void {
    switch (n.voice) {
      case "kick":
      case "softdrum":
        return this.drum(ctx, out, at, n.gain, n.voice === "kick" ? 150 : 95, n.voice === "kick" ? 0.16 : 0.5);
      case "snare":
        this.hiss(ctx, out, at, 0.13, n.gain, "highpass", 1600);
        return this.tone(ctx, out, { type: "triangle", hz: 190, at, dur: 0.08, gain: n.gain * 0.5, attack: 0.002, release: 0.06, cutoff: 0, vibrato: 0, pluck: false });
      case "hat":
        return this.hiss(ctx, out, at, 0.04, n.gain, "highpass", 7000);
      case "cello":
        return this.tone(ctx, out, { type: "sawtooth", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain, attack: 0.14, release: 0.35, cutoff: 900, vibrato: 5, pluck: false });
      case "trombone":
        return this.tone(ctx, out, { type: "sawtooth", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain * 0.9, attack: 0.09, release: 0.25, cutoff: 650, vibrato: 0, pluck: false });
      case "flute":
        return this.tone(ctx, out, { type: "sine", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain, attack: 0.12, release: 0.3, cutoff: 0, vibrato: 4.5, pluck: false });
      case "bass":
        return this.tone(ctx, out, { type: "triangle", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain, attack: 0.02, release: 0.12, cutoff: 420, vibrato: 0, pluck: false });
      case "guitar":
        return this.tone(ctx, out, { type: "sawtooth", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain, attack: 0.004, release: 0.1, cutoff: 3200, vibrato: 0, pluck: true });
      case "trumpet":
        return this.tone(ctx, out, { type: "sawtooth", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain * 0.8, attack: 0.03, release: 0.08, cutoff: 2600, vibrato: 0, pluck: false });
      case "violin":
        return this.tone(ctx, out, { type: "sawtooth", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain * 0.75, attack: 0.05, release: 0.12, cutoff: 3600, vibrato: 6, pluck: false });
      case "piccolo":
        return this.tone(ctx, out, { type: "triangle", hz: midiHz(n.midi), at, dur: n.dur, gain: n.gain, attack: 0.02, release: 0.08, cutoff: 0, vibrato: 0, pluck: false });
    }
  }

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    v: { type: OscillatorType; hz: number; at: number; dur: number; gain: number; attack: number; release: number; cutoff: number; vibrato: number; pluck: boolean },
  ): void {
    const osc = ctx.createOscillator();
    osc.type = v.type;
    osc.frequency.value = v.hz;
    const env = ctx.createGain();
    const end = v.at + v.dur;
    env.gain.setValueAtTime(0, v.at);
    env.gain.linearRampToValueAtTime(v.gain, v.at + v.attack);
    if (v.pluck) env.gain.exponentialRampToValueAtTime(Math.max(0.0001, v.gain * 0.12), end);
    else env.gain.setValueAtTime(v.gain, Math.max(v.at + v.attack, end - v.release * 0.3));
    env.gain.linearRampToValueAtTime(0, end + v.release);
    let last: AudioNode = osc;
    if (v.cutoff > 0) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(v.cutoff, v.at);
      if (v.pluck) f.frequency.exponentialRampToValueAtTime(Math.max(300, v.cutoff * 0.2), end); // a plucked string dulls as it rings
      last.connect(f);
      last = f;
    }
    last.connect(env).connect(out);
    const stopAt = end + v.release + 0.05;
    if (v.vibrato > 0) {
      const wob = this.lfo(ctx, osc.frequency, v.vibrato, v.hz * 0.006, v.at);
      wob.stop(stopAt);
    }
    osc.start(v.at);
    osc.stop(stopAt);
  }

  private drum(ctx: AudioContext, out: AudioNode, at: number, gain: number, fromHz: number, len: number): void {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(fromHz, at);
    osc.frequency.exponentialRampToValueAtTime(42, at + len * 0.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, at);
    env.gain.linearRampToValueAtTime(gain, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    osc.connect(env).connect(out);
    osc.start(at);
    osc.stop(at + len + 0.05);
  }

  private hiss(ctx: AudioContext, out: AudioNode, at: number, len: number, gain: number, type: BiquadFilterType, hz: number): void {
    if (!this.noise) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, at);
    env.gain.exponentialRampToValueAtTime(0.0001, at + len);
    src.connect(f).connect(env).connect(out);
    src.start(at, (at * 7.3) % 1.5); // a different slice of the hiss each time
    src.stop(at + len + 0.02);
  }
}
