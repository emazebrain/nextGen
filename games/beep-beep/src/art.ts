/**
 * Beep Beep art, drawn in code until the commissioned illustrations arrive (§8.5). Vehicles are drawn lying
 * horizontally, nose to the right (towards the exit), inside a box of `len × cell` by `cell`; the renderer turns
 * upright pieces and mirrors the whole board for an exit on the left. No text on the canvas.
 */
import { Graphics } from "pixi.js";

export interface Look {
  name: "warm" | "cold";
  hero: string;
  blockers: string[];
  ink: string;
  sky: [string, string];
  ground: string;
  board: string;
  boardLine: string;
  frame: string;
  frameEdge: string;
  accent: string;
  ghost: string;
  glow: string;
}

/** Warm "Desert Rally" and cold "Harbor Rush" (design doc §8.4 asset table). */
export const LOOKS: Record<"warm" | "cold", Look> = {
  warm: {
    name: "warm",
    hero: "#E0483A",
    blockers: ["#FFB547", "#FF8F3D", "#CB6843", "#F5C431", "#B8322B", "#FF7A8A"],
    ink: "#3B1A12",
    sky: ["#FFE7BF", "#FFC98A"],
    ground: "#E9B872",
    board: "#F2D7A6",
    boardLine: "#DDB97F",
    frame: "#B86B3E",
    frameEdge: "#7A3E22",
    accent: "#FFB547",
    ghost: "#3E9B5A",
    glow: "#FFF1A8",
  },
  cold: {
    name: "cold",
    hero: "#2A8FD8",
    blockers: ["#2FB3C8", "#3D63D6", "#5B47C9", "#6CC4E8", "#4FD8B8", "#B39BFF"],
    ink: "#0E1530",
    sky: ["#D8F0FF", "#9FD3F2"],
    ground: "#2C6E9C",
    board: "#C9A57A",
    boardLine: "#A9845A",
    frame: "#E8D6B0",
    frameEdge: "#8A6B44",
    accent: "#6CC4E8",
    ghost: "#2F9A8A",
    glow: "#E3F5FC",
  },
};

export function shade(hex: string, amt: number): string {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.round(amt < 0 ? c * (1 + amt) : c + (255 - c) * amt));
  return `#${ch.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function face(g: Graphics, x: number, y: number, s: number, ink: string) {
  g.circle(x - s * 0.32, y - s * 0.12, s * 0.16).fill({ color: "#FFFFFF" });
  g.circle(x + s * 0.32, y - s * 0.12, s * 0.16).fill({ color: "#FFFFFF" });
  g.circle(x - s * 0.28, y - s * 0.1, s * 0.08).fill({ color: ink });
  g.circle(x + s * 0.36, y - s * 0.1, s * 0.08).fill({ color: ink });
  g.moveTo(x - s * 0.28, y + s * 0.22).quadraticCurveTo(x, y + s * 0.46, x + s * 0.28, y + s * 0.22).stroke({ width: Math.max(1.5, s * 0.09), color: ink, cap: "round" });
}

/** Desert Rally: the red buggy with a face, cars and taxis (2 cells), trucks (3 cells). */
function warmVehicle(g: Graphics, len: number, cell: number, color: string, hero: boolean, ink: string) {
  const W = len * cell;
  const H = cell;
  const p = cell * 0.08;
  const w = W - p * 2;
  const h = H - p * 2;
  // Wheels peeking out at the sides.
  const wheel = (x: number) => {
    g.roundRect(x - cell * 0.13, p - cell * 0.02, cell * 0.26, cell * 0.12, cell * 0.05).fill({ color: "#2B2422" });
    g.roundRect(x - cell * 0.13, H - p - cell * 0.1, cell * 0.26, cell * 0.12, cell * 0.05).fill({ color: "#2B2422" });
  };
  wheel(p + w * 0.2);
  wheel(p + w * 0.8);
  if (len === 3 && !hero) wheel(p + w * 0.5);
  g.roundRect(p, p + h * 0.06, w, h * 0.88, cell * 0.2).fill({ color: shade(color, -0.25) });
  g.roundRect(p, p, w, h * 0.86, cell * 0.2).fill({ color });
  g.roundRect(p + w * 0.06, p + h * 0.1, w * 0.88, h * 0.18, cell * 0.08).fill({ color: shade(color, 0.35), alpha: 0.7 });
  if (len === 3 && !hero) {
    // Truck: a cargo box at the back, a cab at the front.
    g.roundRect(p + w * 0.04, p + h * 0.12, w * 0.6, h * 0.66, cell * 0.08).fill({ color: shade(color, -0.12) }).stroke({ width: 2, color: shade(color, -0.4), alpha: 0.6 });
    for (let i = 1; i < 4; i++) g.moveTo(p + w * (0.04 + i * 0.15), p + h * 0.16).lineTo(p + w * (0.04 + i * 0.15), p + h * 0.74).stroke({ width: 1.5, color: shade(color, -0.4), alpha: 0.4 });
    g.roundRect(p + w * 0.74, p + h * 0.18, w * 0.18, h * 0.5, cell * 0.06).fill({ color: "#BFE9FF" });
  } else {
    // Car: windscreen at the front, rear window, roof.
    g.roundRect(p + w * 0.62, p + h * 0.16, w * 0.18, h * 0.54, cell * 0.06).fill({ color: "#BFE9FF" });
    g.roundRect(p + w * 0.16, p + h * 0.2, w * 0.12, h * 0.46, cell * 0.05).fill({ color: "#BFE9FF", alpha: 0.85 });
    if (!hero && color === "#F5C431") g.roundRect(p + w * 0.38, p + h * 0.34, w * 0.16, h * 0.18, cell * 0.04).fill({ color: "#2B2422" }); // taxi sign
  }
  if (hero) {
    g.roundRect(p + w * 0.06, p + h * 0.34, w * 0.36, h * 0.2, cell * 0.06).fill({ color: "#FFFFFF", alpha: 0.85 });
    face(g, p + w * 0.88, p + h * 0.44, cell * 0.36, ink);
  }
  g.roundRect(p, p, w, h * 0.86, cell * 0.2).stroke({ width: Math.max(2, cell * 0.04), color: shade(color, -0.45), alpha: 0.7 });
}

/** Harbor Rush: the blue tugboat with a face, boats (2 cells), barges (3 cells). */
function coldVehicle(g: Graphics, len: number, cell: number, color: string, hero: boolean, ink: string) {
  const W = len * cell;
  const H = cell;
  const p = cell * 0.08;
  const bow = cell * 0.42;
  const hull = [p, p + H * 0.06, W - p - bow, p + H * 0.06, W - p, H / 2, W - p - bow, H - p - H * 0.06, p, H - p - H * 0.06];
  g.poly(hull.map((v, i) => (i % 2 ? v + cell * 0.04 : v))).fill({ color: shade(color, -0.3) });
  g.poly(hull).fill({ color }).stroke({ width: Math.max(2, cell * 0.04), color: shade(color, -0.45), alpha: 0.7, join: "round" });
  g.poly(hull).fill({ color: "#FFFFFF", alpha: 0 });
  if (len === 3 && !hero) {
    // Barge: crates on a flat deck.
    for (let i = 0; i < 3; i++) g.roundRect(p + cell * 0.18 + i * cell * 0.7, p + H * 0.22, cell * 0.56, H * 0.48, cell * 0.06).fill({ color: ["#E8D6B0", "#CB9A6A", "#E8D6B0"][i]! }).stroke({ width: 1.5, color: "#8A6B44", alpha: 0.7 });
  } else {
    // Cabin and a porthole.
    g.roundRect(p + W * 0.2, p + H * 0.22, W * 0.36, H * 0.48, cell * 0.08).fill({ color: "#FFFFFF" }).stroke({ width: 1.5, color: shade(color, -0.4), alpha: 0.6 });
    g.circle(p + W * 0.3, H / 2, cell * 0.08).fill({ color: "#BFE9FF" });
  }
  if (hero) {
    g.roundRect(p + W * 0.1, p + H * 0.32, cell * 0.22, H * 0.28, cell * 0.05).fill({ color: "#F5C431" }); // smokestack
    face(g, W - p - bow * 1.35, H / 2, cell * 0.34, ink);
    g.circle(W - p - bow * 0.6, H / 2, cell * 0.06).fill({ color: "#FFFFFF" });
  }
}

export function drawVehicle(g: Graphics, look: Look, len: number, cell: number, color: string, hero: boolean) {
  g.clear();
  if (look.name === "warm") warmVehicle(g, len, cell, color, hero, look.ink);
  else coldVehicle(g, len, cell, color, hero, look.ink);
}

/** A wall cell: a cactus in a rock (warm) or a stack of crates by a bollard (cold). */
export function drawWall(g: Graphics, look: Look, x: number, y: number, cell: number) {
  const c = cell;
  if (look.name === "warm") {
    g.ellipse(x + c / 2, y + c * 0.78, c * 0.4, c * 0.16).fill({ color: "#9C6B45" });
    g.roundRect(x + c * 0.42, y + c * 0.14, c * 0.16, c * 0.64, c * 0.08).fill({ color: "#4F8F3A" });
    g.roundRect(x + c * 0.22, y + c * 0.32, c * 0.12, c * 0.26, c * 0.06).fill({ color: "#4F8F3A" });
    g.roundRect(x + c * 0.66, y + c * 0.26, c * 0.12, c * 0.26, c * 0.06).fill({ color: "#4F8F3A" });
  } else {
    g.roundRect(x + c * 0.12, y + c * 0.12, c * 0.76, c * 0.76, c * 0.08).fill({ color: "#CB9A6A" }).stroke({ width: 2, color: "#8A6B44" });
    g.moveTo(x + c * 0.12, y + c * 0.12).lineTo(x + c * 0.88, y + c * 0.88).moveTo(x + c * 0.88, y + c * 0.12).lineTo(x + c * 0.12, y + c * 0.88).stroke({ width: 2, color: "#8A6B44", alpha: 0.7 });
  }
}
