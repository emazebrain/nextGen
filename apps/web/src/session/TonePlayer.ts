/**
 * Web Audio pulsed tone generator for session steps.
 *
 * Plays short beeps (pulses) of a carrier frequency at a specified rate,
 * independently in each ear (left channel / right channel). The host page
 * drives this — games in iframes are unaware of it.
 *
 * Usage:
 *   const player = new TonePlayer(toneParams);
 *   player.start();      // begins pulsed tones
 *   player.setVolume(0.3); // 0–1
 *   player.stop();       // stops and cleans up
 */
import type { StepToneParams } from "@emb/contracts";

export class TonePlayer {
  private ctx: AudioContext | null = null;
  private gainNode: GainNode | null = null;
  private leftOsc: OscillatorNode | null = null;
  private rightOsc: OscillatorNode | null = null;
  private leftGain: GainNode | null = null;
  private rightGain: GainNode | null = null;
  private merger: ChannelMergerNode | null = null;
  private pulseInterval: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(private params: StepToneParams) {}

  start(volume = 0.3) {
    if (this.running) return;
    this.running = true;

    const ctx = new AudioContext();
    this.ctx = ctx;

    // Master gain
    const masterGain = ctx.createGain();
    masterGain.gain.value = volume;
    masterGain.connect(ctx.destination);
    this.gainNode = masterGain;

    // Channel merger: 0 = left, 1 = right
    const merger = ctx.createChannelMerger(2);
    merger.connect(masterGain);
    this.merger = merger;

    // Left ear oscillator (channel 0) — always 128 Hz carrier
    const leftOsc = ctx.createOscillator();
    leftOsc.type = "sine";
    leftOsc.frequency.value = this.params.leftCarrierHz;
    const leftGain = ctx.createGain();
    leftGain.gain.value = 0; // start silent, pulses turn it on
    leftOsc.connect(leftGain);
    leftGain.connect(merger, 0, 0); // → left channel
    leftOsc.start();
    this.leftOsc = leftOsc;
    this.leftGain = leftGain;

    // Right ear oscillator (channel 1) — always 440 Hz carrier
    const rightOsc = ctx.createOscillator();
    rightOsc.type = "sine";
    rightOsc.frequency.value = this.params.rightCarrierHz;
    const rightGain = ctx.createGain();
    rightGain.gain.value = 0;
    rightOsc.connect(rightGain);
    rightGain.connect(merger, 0, 1); // → right channel
    rightOsc.start();
    this.rightOsc = rightOsc;
    this.rightGain = rightGain;

    // Schedule pulses: use a high-frequency interval and schedule ahead
    this.schedulePulses();
  }

  private schedulePulses() {
    const ctx = this.ctx!;
    const leftGain = this.leftGain!;
    const rightGain = this.rightGain!;
    const pulseDuration = this.params.pulseDurationS;
    const leftRate = this.params.leftPulseRate;
    const rightRate = this.params.rightPulseRate;

    // Schedule 1 second of pulses at a time
    const scheduleSecond = () => {
      if (!this.running || !this.ctx) return;
      const now = ctx.currentTime;
      const ahead = 0.1; // schedule 100ms ahead

      // Left ear pulses
      if (leftRate > 0) {
        const interval = 1 / leftRate;
        for (let i = 0; i < leftRate; i++) {
          const t = now + ahead + i * interval;
          leftGain.gain.setValueAtTime(1, t);
          leftGain.gain.setValueAtTime(0, t + pulseDuration);
        }
      }

      // Right ear pulses
      if (rightRate > 0) {
        const interval = 1 / rightRate;
        for (let i = 0; i < rightRate; i++) {
          const t = now + ahead + i * interval;
          rightGain.gain.setValueAtTime(1, t);
          rightGain.gain.setValueAtTime(0, t + pulseDuration);
        }
      }
    };

    // Schedule every second
    scheduleSecond();
    this.pulseInterval = setInterval(scheduleSecond, 1000);
  }

  setVolume(v: number) {
    if (this.gainNode) this.gainNode.gain.value = Math.max(0, Math.min(1, v));
  }

  stop() {
    this.running = false;
    if (this.pulseInterval) {
      clearInterval(this.pulseInterval);
      this.pulseInterval = null;
    }
    try { this.leftOsc?.stop(); } catch { /* already stopped */ }
    try { this.rightOsc?.stop(); } catch { /* already stopped */ }
    this.leftOsc?.disconnect();
    this.rightOsc?.disconnect();
    this.leftGain?.disconnect();
    this.rightGain?.disconnect();
    this.merger?.disconnect();
    this.gainNode?.disconnect();
    void this.ctx?.close();
    this.ctx = null;
  }
}
