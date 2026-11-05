/**
 * Objects on the tunnel wall, drawn in code (v1 `Objects.jsx`, re-drawn for
 * Pixi). Each is built once at unit size inside a 100 × 100 box centred on
 * (0, 0) and then only moved and scaled. Faces come from a seed: no photos and
 * no real people.
 */
import { Container, Graphics, Text } from "pixi.js";
import type { Glyph } from "./config.ts";

export interface BadgeLook {
  /** Warm: lava-rock badge. Cold: ice-crystal badge. */
  kind: "lava" | "ice";
  fill: string;
  edge: string;
  vein: string;
  glyph: string;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const poly = (n: number, r: number, rot = -Math.PI / 2) => Array.from({ length: n * 2 }, (_, i) => (i % 2 ? Math.sin : Math.cos)(rot + (Math.floor(i / 2) / n) * Math.PI * 2) * r);

function badge(look: BadgeLook): Graphics {
  const g = new Graphics();
  g.ellipse(6, 10, 50, 46).fill({ color: "#000000", alpha: 0.32 });
  if (look.kind === "lava") {
    // A rough basalt rock with glowing cracks.
    const pts = [-48, -18, -30, -46, 6, -52, 40, -36, 52, -2, 42, 34, 10, 52, -30, 46, -52, 18];
    g.poly(pts).fill({ color: look.fill }).stroke({ width: 5, color: look.edge, join: "round" });
    g.moveTo(-40, 8).lineTo(-22, 2).lineTo(-14, 18).stroke({ width: 3, color: look.vein, alpha: 0.9, cap: "round" });
    g.moveTo(30, -30).lineTo(22, -14).lineTo(36, -4).stroke({ width: 3, color: look.vein, alpha: 0.9, cap: "round" });
    g.moveTo(14, 40).lineTo(20, 28).stroke({ width: 3, color: look.vein, alpha: 0.8, cap: "round" });
  } else {
    // A faceted ice crystal.
    g.poly(poly(6, 54)).fill({ color: look.fill, alpha: 0.95 }).stroke({ width: 4, color: look.edge, join: "round" });
    const p = poly(6, 54);
    for (let i = 0; i < 6; i += 2) g.moveTo(p[i * 2]!, p[i * 2 + 1]!).lineTo(p[(i + 3) * 2]!, p[(i + 3) * 2 + 1]!).stroke({ width: 1.5, color: "#FFFFFF", alpha: 0.6 });
    g.poly([-30, -40, 0, -54, 20, -44, -8, -30]).fill({ color: "#FFFFFF", alpha: 0.45 });
  }
  return g;
}

function shape(label: string, color: string): Graphics {
  const g = new Graphics();
  const f = { color };
  switch (label) {
    case "square":
      g.roundRect(-30, -30, 60, 60, 8).fill(f);
      break;
    case "triangle":
      g.poly([0, -36, 33, 26, -33, 26]).fill(f);
      break;
    case "cross":
      g.poly([-11, -34, 11, -34, 11, -11, 34, -11, 34, 11, 11, 11, 11, 34, -11, 34, -11, 11, -34, 11, -34, -11, -11, -11]).fill(f);
      break;
    case "star": {
      const pts: number[] = [];
      for (let i = 0; i < 10; i++) {
        const r = i % 2 ? 15 : 37;
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      g.poly(pts).fill(f);
      break;
    }
    case "hexagon":
      g.poly(poly(6, 34)).fill(f);
      break;
    default:
      g.circle(0, 0, 33).fill(f);
  }
  return g;
}

function cartoonFace(label: string): Graphics {
  const h = hash(label);
  const brow = (h % 7) - 3;
  const eyeR = 4 + (h % 3);
  const mood = [10, 2, -8, -2][h % 4]!;
  const g = new Graphics();
  g.circle(0, 0, 36).fill({ color: "#F2C9A0" }).stroke({ width: 3, color: "#1B1B1B" });
  g.moveTo(-36, -6).arc(0, -6, 36, Math.PI, 0).lineTo(36, -14).arc(0, -14, 34, 0, Math.PI, true).fill({ color: "#3B2E28" });
  g.circle(-13, -4, eyeR).fill({ color: "#1B1B1B" });
  g.circle(13, -4, eyeR).fill({ color: "#1B1B1B" });
  g.moveTo(-21, -16 + brow).lineTo(-6, -18 - brow).moveTo(6, -18 - brow).lineTo(21, -16 + brow).stroke({ width: 3, color: "#1B1B1B", cap: "round" });
  g.moveTo(-14, 16).quadraticCurveTo(0, 16 + mood, 14, 16).stroke({ width: 3, color: "#1B1B1B", cap: "round" });
  g.circle(-22, 8, 4).fill({ color: "#F2A08F", alpha: 0.6 });
  g.circle(22, 8, 4).fill({ color: "#F2A08F", alpha: 0.6 });
  return g;
}

function realFace(label: string): Graphics {
  const h = hash(label);
  const skin = ["#E8B48C", "#C68863", "#8D5A3B", "#F2C9A0", "#A06A48"][h % 5]!;
  const hair = ["#221A16", "#4A342A", "#6E5341", "#171717", "#55607F"][h % 5]!;
  const g = new Graphics();
  g.rect(-10, 26, 20, 14).fill({ color: skin });
  g.ellipse(0, 0, 30, 36).fill({ color: skin });
  // Soft shading towards the lower right instead of v1's SVG gradient.
  g.ellipse(8, 8, 22, 28).fill({ color: "#8A6248", alpha: 0.18 });
  g.moveTo(-30, -8).arc(0, -8, 30, Math.PI, 0).lineTo(30, -18).arc(0, -18, 30, 0, Math.PI, true).fill({ color: hair });
  for (const x of [-11, 11]) {
    g.ellipse(x, -4, 7, 5).fill({ color: "#FDFDFD" });
    g.circle(x, -4, 2.6).fill({ color: "#221A16" });
  }
  g.moveTo(0, 2).lineTo(-3, 12).lineTo(2, 13).stroke({ width: 2.5, color: "#8A6248", cap: "round" });
  g.moveTo(-9, 22).quadraticCurveTo(0, 27, 9, 22).quadraticCurveTo(0, 31, -9, 22).fill({ color: "#B36A5A" });
  g.ellipse(0, 0, 30, 36).stroke({ width: 2, color: "#000000", alpha: 0.33 });
  return g;
}

/** One object: badge plus glyph, at unit size. `inner` is what turns with the wall in wall orientation. */
export function buildObject(glyph: Glyph, look: BadgeLook): { root: Container; inner: Container } {
  const root = new Container();
  const inner = new Container();
  root.addChild(badge(look), inner);
  switch (glyph.kind) {
    case "letter":
    case "number": {
      const t = new Text({ text: glyph.label, style: { fontFamily: `ui-rounded,"SF Pro Rounded","Rubik","Nunito",system-ui,sans-serif`, fontSize: 60, fontWeight: "800", fill: look.glyph } });
      t.anchor.set(0.5, 0.52);
      t.resolution = 2;
      inner.addChild(t);
      break;
    }
    case "cartoon_face":
      inner.addChild(cartoonFace(glyph.label));
      break;
    case "real_face":
      inner.addChild(realFace(glyph.label));
      break;
    default:
      inner.addChild(shape(glyph.label, look.glyph));
  }
  return { root, inner };
}
