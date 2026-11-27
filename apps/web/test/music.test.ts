/** The session music as data: each hemisphere's tunes follow the product owner's brief (2026-11-27). */
import { describe, expect, it } from "vitest";
import { TUNES, degreeOf, pickTune, tunesFor, type Tune } from "../src/session/music/tunes.ts";

const lead = (t: Tune) => t.notes.filter((n) => n.part === "lead");
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const share = (t: Tune, degrees: number[]) => lead(t).filter((n) => degrees.includes(degreeOf(t, n.midi) ?? 0)).length / lead(t).length;

describe("session music", () => {
  it("has three tunes per hemisphere, each at least 30 seconds, with every note inside the loop", () => {
    expect(tunesFor("right")).toHaveLength(3);
    expect(tunesFor("left")).toHaveLength(3);
    expect(new Set(TUNES.map((t) => t.id)).size).toBe(6);
    for (const t of TUNES) {
      expect(t.length, t.id).toBeGreaterThanOrEqual(30);
      expect(lead(t).length, t.id).toBeGreaterThan(10);
      for (const n of t.notes) {
        expect(n.t, t.id).toBeGreaterThanOrEqual(0);
        expect(n.t, t.id).toBeLessThan(t.length);
        expect(n.gain).toBeGreaterThan(0);
        expect(n.gain).toBeLessThanOrEqual(1);
      }
    }
  });

  it("right hemisphere: low tones, mostly Do–Re–Mi, in different keys", () => {
    for (const t of tunesFor("right")) {
      expect(mean(lead(t).map((n) => n.midi)), t.id).toBeLessThan(57); // below the A under middle C
      expect(Math.max(...lead(t).map((n) => n.midi)), t.id).toBeLessThanOrEqual(60);
      expect(share(t, [1, 2, 3]), t.id).toBeGreaterThan(0.6);
    }
    expect(new Set(tunesFor("right").map((t) => t.tonic)).size).toBe(3);
  });

  it("right hemisphere: the rhythm keeps changing — no note length repeats the one before, and no steady drum pulse", () => {
    for (const t of tunesFor("right")) {
      const durs = lead(t).map((n) => n.dur);
      for (let i = 1; i < durs.length; i++) expect(durs[i], `${t.id} note ${i}`).not.toBe(durs[i - 1]);
      expect(new Set(durs).size, t.id).toBeGreaterThanOrEqual(5);
      const drums = t.notes.filter((n) => n.part === "drums").map((n) => n.t);
      const gaps = drums.slice(1).map((x, i) => Math.round((x - drums[i]!) * 100));
      expect(new Set(gaps).size, t.id).toBeGreaterThan(gaps.length * 0.7);
    }
  });

  it("right hemisphere: natural sounds and the low instruments; no drum kit, no guitar", () => {
    const kinds = new Set(tunesFor("right").flatMap((t) => t.textures.map((x) => x.kind)));
    expect([...kinds].sort()).toEqual(["breath", "waves", "wind"]);
    for (const t of tunesFor("right")) {
      expect(t.textures.length, t.id).toBeGreaterThan(0);
      for (const n of t.notes) expect(["cello", "bass", "trombone", "flute", "softdrum"], t.id).toContain(n.voice);
    }
    expect(tunesFor("right").some((t) => t.drone)).toBe(true); // the didgeridoo
  });

  it("left hemisphere: higher tones, mostly Sol–La–Si, in different keys", () => {
    for (const t of tunesFor("left")) {
      expect(mean(lead(t).map((n) => n.midi)), t.id).toBeGreaterThan(72); // above the C over middle C
      expect(share(t, [5, 6, 7]), t.id).toBeGreaterThan(0.6);
      expect(t.textures).toEqual([]);
      expect(t.drone).toBeNull();
    }
    expect(new Set(tunesFor("left").map((t) => t.tonic)).size).toBe(3);
  });

  it("left hemisphere: repeating rhythm and pattern — every bar has the same beat, and the tune comes round every four bars", () => {
    for (const t of tunesFor("left")) {
      const bar = t.length / 16;
      const slot = (n: { t: number }) => Math.round(n.t / (bar / 8)); // which eighth note of the tune
      const shape = (from: number, parts: string[]) =>
        t.notes.filter((n) => parts.includes(n.part) && Math.floor(slot(n) / 8) === from).map((n) => `${slot(n) % 8}:${n.voice}:${n.part === "drums" ? "" : n.midi}`).sort().join(" ");
      for (let b = 1; b < 16; b++) expect(shape(b, ["drums"]), `${t.id} bar ${b}`).toBe(shape(0, ["drums"]));
      for (let b = 0; b < 4; b++) expect(shape(b + 4, ["drums", "bass", "chords", "lead"]), `${t.id} bar ${b + 4}`).toBe(shape(b, ["drums", "bass", "chords", "lead"]));
      // Everything sits on the eighth-note grid.
      for (const n of t.notes) expect(Math.abs((n.t / (bar / 8)) - Math.round(n.t / (bar / 8))), t.id).toBeLessThan(0.01);
    }
  });

  it("is the same tune every time, and sessions take the tunes in turn", () => {
    expect(pickTune("right", 1).id).toBe(pickTune("right", 4).id);
    expect(new Set([1, 2, 3].map((n) => pickTune("left", n).id)).size).toBe(3);
    expect(pickTune("left", 2).side).toBe("left");
  });
});
