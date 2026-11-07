/**
 * Block Crasher backgrounds (design doc §8.4 asset table, ADR 0017): five scenes per look, three parallax layers
 * each, drawn in code until the commissioned art arrives. Two levels share a scene (levels 1–2 → scene 1 … 9–10 →
 * scene 5). The layers shift a little with the paddle; embers, snow and the aurora move gently. Under reduced
 * motion nothing moves and scenes change without a fade. Nothing here reads the clock or the network.
 */
import { Container, FillGradient, Graphics } from "pixi.js";

export type SceneKind = "warm" | "cold";
export const SCENE_COUNT = 5;
export const WARM_SCENES = ["sunrise_mesa", "red_rock_arches", "desert_market", "lava_cave", "sunset_fort"] as const;
export const COLD_SCENES = ["dawn_fjord", "ice_arches", "frozen_harbour", "aurora_cave", "moonlit_castle"] as const;

/** Levels 1–2 → 0, 3–4 → 1 … 9–10 → 4. */
export const sceneForLevel = (level: number) => Math.max(0, Math.min(SCENE_COUNT - 1, Math.floor((level - 1) / 2)));

/** How far each layer moves (screen px) when the paddle goes from one wall to the other. */
const PARALLAX = [6, 16, 30];
const PAD = 40; // layers are drawn wider than the screen so the shift never shows an edge
const FADE_S = 0.6;

/** A deterministic hash in [0, 1): stars, windows and stones sit in the same place every time. */
const hash = (i: number, salt = 0) => {
  let x = (i + 1) * 374761393 + salt * 668265263;
  x = Math.imul(x ^ (x >>> 13), 1274126177);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
};

interface Ambient {
  kind: "embers" | "snow" | "aurora" | "lanterns" | "none";
  t: number;
  pts: Array<{ x: number; y: number; v: number; r: number; p: number }>;
}

/** One scene: three layer containers (far, mid, near) and an ambient layer. */
class SceneLayers extends Container {
  layers: Graphics[] = [new Graphics(), new Graphics(), new Graphics()];
  sky = new Graphics();
  ambientG = new Graphics();
  ambient: Ambient = { kind: "none", t: 0, pts: [] };
  constructor() {
    super();
    this.addChild(this.sky, this.layers[0]!, this.ambientG, this.layers[1]!, this.layers[2]!);
  }
}

export class SceneView extends Container {
  private current: SceneLayers | null = null;
  private leaving: SceneLayers | null = null;
  private index = -1;
  private W = 0;
  private H = 0;
  private px = 0;

  constructor(
    private readonly kind: SceneKind,
    private readonly mono: boolean,
    private readonly reducedMotion: boolean,
  ) {
    super();
  }

  get sceneId() {
    return (this.kind === "warm" ? WARM_SCENES : COLD_SCENES)[Math.max(0, this.index)]!;
  }

  /** Shows scene `index` (0–4), fading from the last one unless motion is reduced. */
  show(index: number) {
    if (index === this.index && this.current) return;
    this.index = index;
    const next = new SceneLayers();
    this.paint(next);
    if (this.current && !this.reducedMotion) {
      this.leaving?.destroy({ children: true });
      this.leaving = this.current;
      next.alpha = 0;
    } else {
      this.current?.destroy({ children: true });
    }
    this.current = next;
    this.addChild(next);
    this.applyParallax();
  }

  resize(W: number, H: number) {
    if (W === this.W && H === this.H) return;
    this.W = W;
    this.H = H;
    if (this.current) this.paint(this.current);
    this.leaving?.destroy({ children: true });
    this.leaving = null;
    if (this.current) this.current.alpha = 1;
  }

  /** p in [-1, 1]: where the paddle is across the board. */
  setParallax(p: number) {
    if (this.reducedMotion) return;
    this.px = Math.max(-1, Math.min(1, p));
    this.applyParallax();
  }

  update(dt: number) {
    const cur = this.current;
    if (!cur) return;
    if (this.leaving) {
      cur.alpha = Math.min(1, cur.alpha + dt / FADE_S);
      if (cur.alpha >= 1) {
        this.leaving.destroy({ children: true });
        this.leaving = null;
      }
    }
    if (!this.reducedMotion) this.animate(cur, dt);
  }

  private applyParallax() {
    if (!this.current) return;
    this.current.layers.forEach((g, i) => (g.x = -this.px * PARALLAX[i]!));
    this.current.ambientG.x = -this.px * PARALLAX[0]!;
  }

  // ------------------------------------------------------------ colour

  /** In monochrome, every colour becomes its grey. */
  private c = (hex: string) => {
    if (!this.mono) return hex;
    const n = parseInt(hex.slice(1), 16);
    const y = Math.round(0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255));
    const h = y.toString(16).padStart(2, "0");
    return `#${h}${h}${h}`;
  };

  private skyFill(g: Graphics, stops: string[]) {
    const grad = new FillGradient({
      type: "linear",
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: stops.map((color, i) => ({ offset: i / (stops.length - 1), color: this.c(color) })),
      textureSpace: "local",
    });
    g.rect(-PAD, -PAD, this.W + PAD * 2, this.H + PAD * 2).fill(grad);
  }

  // ------------------------------------------------------------ shapes

  /** A ridge line across the whole (padded) width: f(x) gives the height above `base`. */
  private ridge(g: Graphics, base: number, f: (x: number, i: number) => number, color: string, alpha = 1, step = 24) {
    const pts: number[] = [-PAD, this.H + PAD];
    let i = 0;
    for (let x = -PAD; x <= this.W + PAD; x += step) pts.push(x, base - f(x, i++));
    pts.push(this.W + PAD, this.H + PAD);
    g.poly(pts).fill({ color: this.c(color), alpha });
  }

  private mesa(g: Graphics, cx: number, base: number, w: number, h: number, color: string, alpha = 1) {
    g.poly([cx - w / 2, base, cx - w * 0.38, base - h * 0.85, cx - w * 0.3, base - h, cx + w * 0.32, base - h, cx + w * 0.4, base - h * 0.8, cx + w / 2, base]).fill({ color: this.c(color), alpha });
  }

  /** A natural rock arch: a thick half ring on two legs. */
  private arch(g: Graphics, cx: number, base: number, w: number, h: number, thick: number, color: string, alpha = 1) {
    const top = base - h + w / 2;
    const pts: number[] = [cx - w / 2, base];
    for (let a = Math.PI; a <= Math.PI * 2 + 0.001; a += Math.PI / 24) pts.push(cx + Math.cos(a) * (w / 2), top + Math.sin(a) * (w / 2));
    pts.push(cx + w / 2, base, cx + w / 2 - thick, base);
    for (let a = Math.PI * 2; a >= Math.PI - 0.001; a -= Math.PI / 24) pts.push(cx + Math.cos(a) * (w / 2 - thick), top + Math.sin(a) * (w / 2 - thick * 0.8));
    pts.push(cx - w / 2 + thick, base);
    g.poly(pts).fill({ color: this.c(color), alpha });
  }

  private cactus(g: Graphics, x: number, base: number, h: number, color: string) {
    const w = h * 0.16;
    const col = this.c(color);
    g.roundRect(x - w / 2, base - h, w, h, w / 2).fill(col);
    g.roundRect(x - w * 2.1, base - h * 0.62, w * 0.8, h * 0.34, w / 2).fill(col);
    g.rect(x - w * 2.1, base - h * 0.36, w * 1.9, w * 0.7).fill(col);
    g.roundRect(x + w * 1.3, base - h * 0.78, w * 0.8, h * 0.36, w / 2).fill(col);
    g.rect(x + w * 0.2, base - h * 0.5, w * 1.9, w * 0.7).fill(col);
  }

  private pine(g: Graphics, x: number, base: number, h: number, color: string, snow?: string) {
    const col = this.c(color);
    g.rect(x - h * 0.03, base - h * 0.15, h * 0.06, h * 0.15).fill(col);
    for (let i = 0; i < 3; i++) {
      const y0 = base - h * 0.12 - i * h * 0.26;
      const w = h * (0.42 - i * 0.1);
      g.poly([x - w / 2, y0, x, y0 - h * 0.42, x + w / 2, y0]).fill(col);
      if (snow) g.poly([x - w * 0.16, y0 - h * 0.28, x, y0 - h * 0.42, x + w * 0.16, y0 - h * 0.28]).fill(this.c(snow));
    }
  }

  private stars(g: Graphics, n: number, maxY: number, salt = 1) {
    for (let i = 0; i < n; i++) g.circle(hash(i, salt) * this.W, hash(i, salt + 7) * maxY, 0.6 + hash(i, salt + 3) * 1.3).fill({ color: "#FFFFFF", alpha: 0.35 + hash(i, salt + 5) * 0.55 });
  }

  /** A row of lit windows on a building face. */
  private windows(g: Graphics, x: number, y: number, w: number, h: number, cols: number, rows: number, lit: string, salt: number) {
    const cw = w / cols;
    const rh = h / rows;
    for (let r = 0; r < rows; r++)
      for (let k = 0; k < cols; k++) if (hash(r * 31 + k, salt) < 0.55) g.rect(x + k * cw + cw * 0.3, y + r * rh + rh * 0.25, cw * 0.4, rh * 0.45).fill({ color: this.c(lit), alpha: 0.9 });
  }

  // ------------------------------------------------------------ scenes

  private paint(s: SceneLayers) {
    s.sky.clear();
    s.layers.forEach((g) => g.clear());
    s.ambientG.clear();
    s.ambient = { kind: "none", t: 0, pts: [] };
    if (!this.W || !this.H) return;
    const draw: Record<string, (s: SceneLayers) => void> = {
      sunrise_mesa: this.sunriseMesa,
      red_rock_arches: this.redRockArches,
      desert_market: this.desertMarket,
      lava_cave: this.lavaCave,
      sunset_fort: this.sunsetFort,
      dawn_fjord: this.dawnFjord,
      ice_arches: this.iceArches,
      frozen_harbour: this.frozenHarbour,
      aurora_cave: this.auroraCave,
      moonlit_castle: this.moonlitCastle,
    };
    draw[this.sceneId]!.call(this, s);
    // The ambient layer's first frame (and its only one under reduced motion).
    this.animate(s, 0);
  }

  // Warm "Canyon Fort" ----------------------------------------------------------

  private sunriseMesa(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#FFE2B0", "#FFB547", "#F07A3A"]);
    const sun = { x: W * 0.72, y: H * 0.62, r: Math.min(W, H) * 0.12 };
    s.sky.circle(sun.x, sun.y, sun.r * 1.9).fill({ color: this.c("#FFF4D0"), alpha: 0.25 });
    s.sky.circle(sun.x, sun.y, sun.r).fill({ color: this.c("#FFF4D0"), alpha: 0.95 });
    for (let i = 0; i < 4; i++) s.sky.ellipse(W * (0.15 + i * 0.25), H * (0.18 + hash(i, 4) * 0.12), W * 0.09, H * 0.018).fill({ color: this.c("#FFF4D0"), alpha: 0.5 });
    const base = H * 0.7;
    for (let i = 0; i < 6; i++) this.mesa(far, (i / 5) * W, base, W * 0.22, H * (0.1 + hash(i, 1) * 0.08), "#D9826A", 0.7);
    for (let i = 0; i < 4; i++) this.mesa(mid, W * (0.05 + i * 0.32), H * 0.8, W * 0.26, H * (0.2 + hash(i, 2) * 0.1), "#B8322B");
    this.ridge(near, H * 0.86, (x) => 6 * Math.sin(x / 60), "#7A2420");
    for (const [fx, fh] of [[0.06, 0.15], [0.22, 0.1], [0.84, 0.17], [0.95, 0.11]] as const) this.cactus(near, W * fx, H * 0.87, H * fh, "#5E1C18");
    for (let i = 0; i < 14; i++) near.ellipse(hash(i, 9) * W, H * (0.9 + hash(i, 8) * 0.08), 4 + hash(i, 6) * 10, 3 + hash(i, 5) * 4).fill({ color: this.c("#5E1C18") });
  }

  private redRockArches(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#FFC46B", "#F2884A", "#C2502F"]);
    s.sky.circle(W * 0.2, H * 0.16, Math.min(W, H) * 0.06).fill({ color: this.c("#FFF4D0"), alpha: 0.9 });
    this.ridge(far, H * 0.66, (x) => 30 + 26 * Math.abs(Math.sin(x / 140)), "#D9826A", 0.75, 30);
    this.arch(mid, W * 0.16, H * 0.86, W * 0.26, H * 0.46, W * 0.05, "#B8322B");
    this.arch(mid, W * 0.84, H * 0.86, W * 0.3, H * 0.5, W * 0.055, "#A82E26");
    this.arch(mid, W * 0.5, H * 0.8, W * 0.2, H * 0.28, W * 0.035, "#C2502F", 0.85);
    // Rock strata on the arches.
    for (let i = 0; i < 6; i++) mid.rect(-PAD, H * (0.58 + i * 0.045), W + PAD * 2, 2).fill({ color: this.c("#7A2420"), alpha: 0.25 });
    this.ridge(near, H * 0.88, (x) => 10 + 8 * Math.sin(x / 45) + (Math.sin(x / 13) > 0.92 ? 18 : 0), "#7A2420", 1, 12);
    for (let i = 0; i < 8; i++) near.ellipse(hash(i, 21) * W, H * (0.91 + hash(i, 22) * 0.06), 10 + hash(i, 23) * 18, 6 + hash(i, 24) * 8).fill(this.c("#5E1C18"));
  }

  private desertMarket(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#FFD9A0", "#FFB547", "#E0702A"]);
    s.sky.circle(W * 0.5, H * 0.12, Math.min(W, H) * 0.05).fill({ color: this.c("#FFF4D0"), alpha: 0.85 });
    // Far: flat-roofed adobe houses and domes.
    const fb = H * 0.7;
    for (let i = 0; i < 12; i++) {
      const x = -PAD + i * ((W + PAD * 2) / 11);
      const w = W * 0.07 + hash(i, 31) * W * 0.04;
      const h = H * (0.08 + hash(i, 32) * 0.12);
      far.rect(x - w / 2, fb - h, w, h).fill({ color: this.c("#D9826A"), alpha: 0.85 });
      if (hash(i, 33) < 0.4) far.circle(x, fb - h, w * 0.32).fill({ color: this.c("#D9826A"), alpha: 0.85 });
      this.windows(far, x - w / 2, fb - h + 4, w, h - 6, 3, 2, "#FFE2B0", i);
    }
    far.rect(-PAD, fb, W + PAD * 2, H).fill({ color: this.c("#D9826A"), alpha: 0.85 });
    // Mid: market stalls with striped awnings and a string of lanterns.
    const mb = H * 0.86;
    const stripes = ["#E0483A", "#FFF4D0", "#FF8F3D", "#FFF4D0"];
    for (let i = 0; i < 6; i++) {
      const x = W * (0.02 + i * 0.2);
      const w = W * 0.15;
      const top = mb - H * 0.16;
      mid.rect(x, top, 4, H * 0.16).fill(this.c("#5E1C18"));
      mid.rect(x + w - 4, top, 4, H * 0.16).fill(this.c("#5E1C18"));
      const n = 6;
      for (let k = 0; k < n; k++) {
        const sx = x + (k * w) / n;
        mid.poly([sx, top, sx + w / n, top, sx + w / n, top + H * 0.04, sx + w / n / 2, top + H * 0.055, sx, top + H * 0.04]).fill(this.c(stripes[(k + i) % stripes.length]!));
      }
      mid.rect(x, mb - H * 0.05, w, H * 0.05).fill(this.c("#7A2420"));
    }
    const ly = H * 0.52;
    const lpts: Array<[number, number]> = [];
    for (let x = -PAD; x <= W + PAD; x += 20) lpts.push([x, ly + 18 * Math.sin(((x + PAD) / (W + PAD * 2)) * Math.PI * 3) ** 2]);
    mid.poly(lpts.flat(), false).stroke({ width: 1.5, color: this.c("#5E1C18"), alpha: 0.7 });
    s.ambient = { kind: "lanterns", t: 0, pts: lpts.filter((_, i) => i % 3 === 1).map(([x, y], i) => ({ x, y: y + 8, v: 0, r: 5, p: hash(i, 41) * 6 })) };
    // Near: pots, baskets and a palm.
    near.rect(-PAD, H * 0.9, W + PAD * 2, H).fill(this.c("#7A2420"));
    for (let i = 0; i < 9; i++) {
      const x = hash(i, 51) * W;
      const r = 8 + hash(i, 52) * 10;
      near.ellipse(x, H * 0.9 - r * 0.7, r, r * 0.9).fill(this.c("#5E1C18"));
      near.rect(x - r * 0.4, H * 0.9 - r * 1.75, r * 0.8, r * 0.35).fill(this.c("#5E1C18"));
    }
    const px = W * 0.93;
    near.poly([px - 5, H * 0.9, px + 2, H * 0.55, px + 8, H * 0.55, px + 5, H * 0.9]).fill(this.c("#5E1C18"));
    for (let k = 0; k < 6; k++) {
      const a = Math.PI * (1.05 + k * 0.18);
      near.poly([px + 5, H * 0.55, px + 5 + Math.cos(a) * 60, H * 0.55 + Math.sin(a) * 30 + 22, px + 5 + Math.cos(a) * 30, H * 0.55 + Math.sin(a) * 10 + 4]).fill(this.c("#5E1C18"));
    }
  }

  private lavaCave(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#2A0C08", "#5E1C18", "#B8322B"]);
    // Far: the cave's back wall, lit from below.
    this.ridge(far, H * 0.75, (x) => H * 0.25 + 30 * Math.sin(x / 90), "#3D1410", 0.9, 20);
    for (let i = 0; i < 18; i++) far.ellipse(hash(i, 61) * W, H * (0.3 + hash(i, 62) * 0.35), 18 + hash(i, 63) * 30, 8 + hash(i, 64) * 12).fill({ color: this.c("#7A2420"), alpha: 0.35 });
    // Mid: stalactites from the roof and stalagmites from the floor.
    const roof: number[] = [-PAD, -PAD];
    for (let x = -PAD; x <= W + PAD; x += 26) {
      const d = H * (0.04 + hash(x, 65) * 0.16);
      roof.push(x, 0, x + 13, d, x + 26, 0);
    }
    roof.push(W + PAD, -PAD);
    mid.poly(roof).fill(this.c("#2A0C08"));
    for (let i = 0; i < 10; i++) {
      const x = hash(i, 66) * W;
      const h = H * (0.08 + hash(i, 67) * 0.14);
      mid.poly([x - h * 0.22, H * 0.84, x, H * 0.84 - h, x + h * 0.22, H * 0.84]).fill(this.c("#3D1410"));
    }
    // Near: a glowing lava river and the rock edge in front of it.
    const glow = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: this.c("#FFD36B") }, { offset: 0.5, color: this.c("#FF8F3D") }, { offset: 1, color: this.c("#E0483A") }], textureSpace: "local" });
    near.rect(-PAD, H * 0.84, W + PAD * 2, H * 0.08).fill(glow);
    near.rect(-PAD, H * 0.8, W + PAD * 2, H * 0.06).fill({ color: this.c("#FF8F3D"), alpha: 0.25 });
    this.ridge(near, H * 0.95, (x) => 12 + 10 * Math.sin(x / 37) + 6 * Math.sin(x / 11), "#1A0604", 1, 10);
    s.ambient = { kind: "embers", t: 0, pts: Array.from({ length: 26 }, (_, i) => ({ x: hash(i, 71) * W, y: H * (0.45 + hash(i, 72) * 0.45), v: 18 + hash(i, 73) * 30, r: 1.2 + hash(i, 74) * 2, p: hash(i, 75) * 6 })) };
  }

  private sunsetFort(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#6B2A5A", "#E0483A", "#FF8F3D", "#FFB547"]);
    s.sky.circle(W * 0.5, H * 0.72, Math.min(W, H) * 0.2).fill({ color: this.c("#FFD36B"), alpha: 0.35 });
    s.sky.circle(W * 0.5, H * 0.72, Math.min(W, H) * 0.13).fill({ color: this.c("#FFE2B0"), alpha: 0.95 });
    this.stars(s.sky, 18, H * 0.2, 81);
    for (let i = 0; i < 7; i++) this.mesa(far, (i / 6) * W, H * 0.74, W * 0.2, H * (0.07 + hash(i, 82) * 0.07), "#9E3A4A", 0.8);
    // Mid: the fort: a long wall with crenellations, two towers with flags, a gate.
    const base = H * 0.86;
    const wallTop = base - H * 0.14;
    const col = this.c("#5E1C18");
    mid.rect(-PAD, wallTop, W + PAD * 2, base - wallTop).fill(col);
    for (let x = -PAD; x < W + PAD; x += 28) mid.rect(x, wallTop - 12, 16, 12).fill(col);
    for (const tx of [W * 0.14, W * 0.86]) {
      const tw = W * 0.08;
      const th = H * 0.3;
      mid.rect(tx - tw / 2, base - th, tw, th).fill(col);
      for (let k = 0; k < 3; k++) mid.rect(tx - tw / 2 + k * (tw / 3) + 2, base - th - 12, tw / 3 - 6, 12).fill(col);
      mid.rect(tx - 1.5, base - th - 50, 3, 40).fill(col);
      mid.poly([tx + 1.5, base - th - 50, tx + 30, base - th - 42, tx + 1.5, base - th - 34]).fill(this.c("#FFB547"));
      mid.rect(tx - 5, base - th * 0.7, 10, 16).fill({ color: this.c("#FFD36B"), alpha: 0.9 });
    }
    mid.roundRect(W * 0.46, base - H * 0.1, W * 0.08, H * 0.1, W * 0.04).fill(this.c("#2A0C08"));
    // Near: ground, a fence and torches.
    near.rect(-PAD, H * 0.9, W + PAD * 2, H).fill(this.c("#3D1410"));
    for (let x = -PAD; x < W + PAD; x += 34) near.rect(x, H * 0.86, 5, H * 0.05).fill(this.c("#2A0C08"));
    near.rect(-PAD, H * 0.875, W + PAD * 2, 4).fill(this.c("#2A0C08"));
    for (const tx of [W * 0.3, W * 0.7]) {
      near.rect(tx - 2, H * 0.8, 4, H * 0.1).fill(this.c("#2A0C08"));
      near.circle(tx, H * 0.79, 14).fill({ color: this.c("#FFB547"), alpha: 0.3 });
      near.ellipse(tx, H * 0.79, 4, 8).fill(this.c("#FFD36B"));
    }
  }

  // Cold "Glacier Castle" ----------------------------------------------------

  private dawnFjord(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#9FC3F0", "#F2C6D8", "#FFE2D0"]);
    s.sky.circle(W * 0.5, H * 0.66, Math.min(W, H) * 0.08).fill({ color: this.c("#FFF4E8"), alpha: 0.85 });
    // Far: steep fjord walls closing in on both sides.
    const water = H * 0.68;
    this.ridge(far, water, (x) => H * 0.05 + H * 0.5 * Math.min(1, Math.max(0, Math.abs(x / W - 0.5) * 2 - 0.2) * 1.4) ** 1.2 + 8 * Math.sin(x / 33), "#2C3F7A", 0.95, 16);
    this.ridge(far, water, (x) => H * 0.02 + H * 0.12 * Math.max(0, 1 - Math.abs(x / W - 0.5) * 3) + 4 * Math.sin(x / 19), "#7A8FC8", 0.8, 16);
    // Mid: still water with reflections and a small boat.
    const waterFill = new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: this.c("#B8D4F0") }, { offset: 1, color: this.c("#3D63D6") }], textureSpace: "local" });
    mid.rect(-PAD, water, W + PAD * 2, H - water + PAD).fill(waterFill);
    for (let i = 0; i < 16; i++) mid.rect(W * hash(i, 91), water + (H - water) * hash(i, 92) * 0.8, W * (0.04 + hash(i, 93) * 0.08), 2).fill({ color: "#FFFFFF", alpha: 0.35 });
    const bx = W * 0.62;
    const by = water + H * 0.05;
    mid.poly([bx - 26, by, bx + 26, by, bx + 18, by + 8, bx - 18, by + 8]).fill(this.c("#232C6B"));
    mid.rect(bx - 1, by - 34, 2, 34).fill(this.c("#232C6B"));
    mid.poly([bx + 1, by - 32, bx + 20, by - 4, bx + 1, by - 4]).fill(this.c("#F0F7FF"));
    // Near: shore rocks and pines, dusted with snow.
    this.ridge(near, H * 0.92, (x) => 14 + 12 * Math.sin(x / 50) + (Math.abs(x / W - 0.5) > 0.3 ? 30 : 0), "#1B2A5A", 1, 14);
    for (let i = 0; i < 9; i++) {
      const fx = i < 5 ? hash(i, 94) * 0.2 : 0.8 + hash(i, 94) * 0.2;
      this.pine(near, W * fx, H * 0.89, H * (0.14 + hash(i, 95) * 0.1), "#14204A", "#F0F7FF");
    }
  }

  private iceArches(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#3D63D6", "#6CC4E8", "#DDF4FF"]);
    for (let i = 0; i < 6; i++) {
      const x = (i / 5) * W;
      const w = W * (0.12 + hash(i, 101) * 0.08);
      const h = H * (0.08 + hash(i, 102) * 0.1);
      far.poly([x - w / 2, H * 0.72, x - w * 0.2, H * 0.72 - h, x + w * 0.15, H * 0.72 - h * 0.85, x + w / 2, H * 0.72]).fill({ color: this.c("#DDF4FF"), alpha: 0.8 });
    }
    far.rect(-PAD, H * 0.72, W + PAD * 2, H).fill({ color: this.c("#9CCBE6"), alpha: 0.8 });
    // Mid: translucent ice arches with a bright rim.
    for (const [cx, w, h] of [[0.15, 0.28, 0.48], [0.85, 0.3, 0.52], [0.5, 0.2, 0.28]] as const) {
      this.arch(mid, W * cx, H * 0.86, W * w, H * h, W * 0.05, "#6CC4E8", 0.75);
      this.arch(mid, W * cx, H * 0.86, W * w, H * h, W * 0.012, "#F0F7FF", 0.8);
    }
    // Near: snow drifts.
    this.ridge(near, H * 0.9, (x) => 14 + 14 * Math.sin(x / 70) + 6 * Math.sin(x / 23), "#F0F7FF", 1, 12);
    this.ridge(near, H * 0.96, (x) => 6 + 6 * Math.sin(x / 41 + 1), "#CFE6F7", 1, 12);
    s.ambient = { kind: "snow", t: 0, pts: this.snowPts(40) };
  }

  private frozenHarbour(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#232C6B", "#3D63D6", "#9FC3F0"]);
    this.stars(s.sky, 30, H * 0.3, 111);
    // Far: a row of tall harbour houses with pointed roofs and lit windows.
    const fb = H * 0.72;
    const n = 14;
    for (let i = 0; i < n; i++) {
      const w = (W + PAD * 2) / n;
      const x = -PAD + i * w;
      const h = H * (0.1 + hash(i, 112) * 0.1);
      const col = this.c(["#2C49A8", "#3A52B8", "#1F3A8A"][i % 3]!);
      far.rect(x, fb - h, w - 2, h).fill(col);
      far.poly([x - 2, fb - h, x + w / 2 - 1, fb - h - w * 0.55, x + w, fb - h]).fill(col);
      this.windows(far, x, fb - h + 6, w - 2, h - 10, 2, 3, "#FFE2A0", i + 5);
    }
    // Mid: the frozen quay, pier posts and a lighthouse.
    mid.rect(-PAD, fb, W + PAD * 2, H).fill(this.c("#BFE0F5"));
    for (let x = -PAD; x < W + PAD; x += 46) mid.rect(x, fb - 8, 6, H * 0.08).fill(this.c("#1B2A5A"));
    const lx = W * 0.9;
    mid.poly([lx - 18, fb, lx - 11, fb - H * 0.32, lx + 11, fb - H * 0.32, lx + 18, fb]).fill(this.c("#F0F7FF"));
    for (let k = 0; k < 3; k++) mid.rect(lx - 16 + k * 2.2, fb - H * (0.08 + k * 0.09), 32 - k * 4.4, H * 0.03).fill(this.c("#3D63D6"));
    mid.rect(lx - 12, fb - H * 0.37, 24, H * 0.05).fill(this.c("#FFE2A0"));
    mid.poly([lx - 14, fb - H * 0.37, lx, fb - H * 0.42, lx + 14, fb - H * 0.37]).fill(this.c("#1B2A5A"));
    mid.poly([lx, fb - H * 0.35, lx - W * 0.25, fb - H * 0.4, lx - W * 0.25, fb - H * 0.3]).fill({ color: this.c("#FFF4D0"), alpha: 0.18 });
    // Near: an ice sheet with cracks, and lamp posts.
    near.rect(-PAD, H * 0.88, W + PAD * 2, H).fill(this.c("#DDF4FF"));
    for (let i = 0; i < 7; i++) {
      const x = hash(i, 113) * W;
      near.poly([x, H * 0.9, x + 20, H * 0.93, x + 12, H * 0.96, x + 34, H], false).stroke({ width: 1.5, color: this.c("#6CC4E8") });
    }
    for (const lp of [W * 0.08, W * 0.35, W * 0.65]) {
      near.rect(lp - 2, H * 0.74, 4, H * 0.15).fill(this.c("#14204A"));
      near.circle(lp, H * 0.735, 16).fill({ color: this.c("#FFE2A0"), alpha: 0.25 });
      near.circle(lp, H * 0.735, 6).fill(this.c("#FFE2A0"));
    }
  }

  private auroraCave(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#0E1530", "#1B2A5A", "#232C6B"]);
    this.stars(s.sky, 40, H * 0.5, 121);
    s.ambient = { kind: "aurora", t: 0, pts: [0, 1, 2].map((k) => ({ x: 0, y: H * (0.16 + k * 0.08), v: 0, r: H * 0.07, p: k * 1.7 })) };
    // Far: the cave mouth frames the sky.
    const mouth: number[] = [-PAD, -PAD, W + PAD, -PAD, W + PAD, H + PAD];
    for (let x = W + PAD; x >= -PAD; x -= 20) {
      const t = (x / W - 0.5) * 2;
      mouth.push(x, H * (0.08 + 0.55 * Math.min(1, Math.abs(t) ** 2.2)) + 10 * Math.sin(x / 27));
    }
    mouth.push(-PAD, H + PAD);
    far.poly(mouth).fill(this.c("#14204A"));
    far.rect(-PAD, H * 0.74, W + PAD * 2, H).fill(this.c("#14204A"));
    // Mid: ice crystals growing from the floor and walls.
    for (let i = 0; i < 12; i++) {
      const x = i < 6 ? hash(i, 122) * W * 0.28 : W - hash(i, 122) * W * 0.28;
      const h = H * (0.1 + hash(i, 123) * 0.18);
      const w = h * 0.22;
      const tilt = (hash(i, 124) - 0.5) * 0.5;
      const bx = x;
      const by = H * 0.86;
      const tx = bx + Math.sin(tilt) * h;
      const ty = by - Math.cos(tilt) * h;
      mid.poly([bx - w / 2, by, tx - w / 2, ty + w * 0.6, tx, ty, tx + w / 2, ty + w * 0.6, bx + w / 2, by]).fill({ color: this.c("#6CC4E8"), alpha: 0.85 });
      mid.poly([bx, by, tx, ty, tx + w / 2, ty + w * 0.6, bx + w / 2, by]).fill({ color: this.c("#DDF4FF"), alpha: 0.5 });
    }
    // Near: icicles along the roof and a crystal floor.
    const roof: number[] = [-PAD, -PAD];
    for (let x = -PAD; x <= W + PAD; x += 18) roof.push(x, 0, x + 9, H * (0.02 + hash(x, 125) * 0.08), x + 18, 0);
    roof.push(W + PAD, -PAD);
    near.poly(roof).fill(this.c("#9FE3F5"));
    this.ridge(near, H * 0.94, (x) => 10 + 8 * Math.sin(x / 31) + 5 * Math.sin(x / 9), "#0E1530", 1, 10);
  }

  private moonlitCastle(s: SceneLayers) {
    const { W, H } = this;
    const [far, mid, near] = s.layers as [Graphics, Graphics, Graphics];
    this.skyFill(s.sky, ["#0E1530", "#232C6B", "#3D63D6"]);
    this.stars(s.sky, 70, H * 0.6, 131);
    const m = { x: W * 0.78, y: H * 0.16, r: Math.min(W, H) * 0.07 };
    s.sky.circle(m.x, m.y, m.r * 2).fill({ color: this.c("#F0F7FF"), alpha: 0.12 });
    s.sky.circle(m.x, m.y, m.r).fill(this.c("#F0F7FF"));
    s.sky.circle(m.x - m.r * 0.3, m.y - m.r * 0.2, m.r * 0.18).fill({ color: this.c("#CFE6F7"), alpha: 0.8 });
    // Far: snow-capped mountains.
    const peaks = [0.05, 0.24, 0.42, 0.62, 0.8, 0.98];
    for (const [i, px] of peaks.entries()) {
      const x = W * px;
      const h = H * (0.22 + hash(i, 132) * 0.14);
      const w = W * 0.24;
      far.poly([x - w / 2, H * 0.74, x, H * 0.74 - h, x + w / 2, H * 0.74]).fill({ color: this.c("#2C49A8"), alpha: 0.85 });
      far.poly([x - w * 0.12, H * 0.74 - h * 0.76, x, H * 0.74 - h, x + w * 0.12, H * 0.74 - h * 0.76, x + w * 0.04, H * 0.74 - h * 0.7, x - w * 0.04, H * 0.74 - h * 0.72]).fill(this.c("#F0F7FF"));
    }
    // Mid: the castle: towers with pointed roofs, a wall and lit windows.
    const base = H * 0.86;
    const col = this.c("#1B2A5A");
    mid.rect(W * 0.04, base - H * 0.12, W * 0.92, H * 0.12).fill(col);
    for (let x = W * 0.04; x < W * 0.96; x += 26) mid.rect(x, base - H * 0.12 - 10, 14, 10).fill(col);
    for (const [tx, tw, th] of [[0.08, 0.07, 0.3], [0.22, 0.06, 0.22], [0.78, 0.06, 0.24], [0.92, 0.07, 0.34]] as const) {
      const x = W * tx;
      const w = W * tw;
      const h = H * th;
      mid.rect(x - w / 2, base - h, w, h).fill(col);
      mid.poly([x - w * 0.65, base - h, x, base - h - w * 1.3, x + w * 0.65, base - h]).fill(this.c("#14204A"));
      mid.poly([x - w * 0.2, base - h - w * 0.86, x, base - h - w * 1.3, x + w * 0.2, base - h - w * 0.86]).fill(this.c("#F0F7FF"));
      mid.rect(x - 4, base - h * 0.7, 8, 14).fill(this.c("#FFE2A0"));
    }
    // Near: snowy ground and pines.
    this.ridge(near, H * 0.9, (x) => 10 + 10 * Math.sin(x / 80) + 4 * Math.sin(x / 21), "#F0F7FF", 1, 12);
    for (let i = 0; i < 8; i++) {
      const fx = i < 4 ? hash(i, 133) * 0.16 : 0.84 + hash(i, 133) * 0.16;
      this.pine(near, W * fx, H * 0.9, H * (0.15 + hash(i, 134) * 0.1), "#0E1530", "#F0F7FF");
    }
    s.ambient = { kind: "snow", t: 0, pts: this.snowPts(55) };
  }

  private snowPts(n: number) {
    return Array.from({ length: n }, (_, i) => ({ x: hash(i, 141) * this.W, y: hash(i, 142) * this.H, v: 16 + hash(i, 143) * 28, r: 1 + hash(i, 144) * 2.2, p: hash(i, 145) * 6 }));
  }

  // ------------------------------------------------------------ motion

  private animate(s: SceneLayers, dt: number) {
    const a = s.ambient;
    if (a.kind === "none") return;
    a.t += dt;
    const g = s.ambientG;
    g.clear();
    const { W, H } = this;
    if (a.kind === "embers") {
      for (const p of a.pts) {
        p.y -= p.v * dt;
        p.x += Math.sin(a.t * 1.3 + p.p) * 8 * dt;
        if (p.y < H * 0.3) {
          p.y = H * 0.9;
          p.x = (p.x + W * 0.37) % W;
        }
        const life = (p.y - H * 0.3) / (H * 0.6);
        g.circle(p.x, p.y, p.r).fill({ color: this.c(life > 0.5 ? "#FFD36B" : "#FF8F3D"), alpha: Math.max(0, life) * 0.9 });
      }
    } else if (a.kind === "snow") {
      for (const p of a.pts) {
        p.y += p.v * dt;
        p.x += Math.sin(a.t * 0.8 + p.p) * 10 * dt;
        if (p.y > H + 4) {
          p.y = -4;
          p.x = (p.x + W * 0.41) % W;
        }
        g.circle(p.x, p.y, p.r).fill({ color: "#FFFFFF", alpha: 0.8 });
      }
    } else if (a.kind === "aurora") {
      const colors = ["#5BE3A8", "#2FB3C8", "#A78BFA"];
      a.pts.forEach((p, k) => {
        const pts: number[] = [];
        const bottom: number[] = [];
        for (let x = -PAD; x <= W + PAD; x += 24) {
          const y = p.y + Math.sin(x / 140 + a.t * 0.5 + p.p) * H * 0.05 + Math.sin(x / 57 + a.t * 0.9) * H * 0.015;
          pts.push(x, y);
          bottom.unshift(x, y + p.r * (0.7 + 0.3 * Math.sin(x / 90 + a.t + k)));
        }
        g.poly([...pts, ...bottom]).fill({ color: this.c(colors[k]!), alpha: 0.22 + 0.08 * Math.sin(a.t * 0.7 + p.p) });
      });
    } else if (a.kind === "lanterns") {
      a.pts.forEach((p, k) => {
        const f = 0.75 + 0.25 * Math.sin(a.t * 2.2 + p.p);
        g.circle(p.x, p.y, p.r * 2.4).fill({ color: this.c("#FFD36B"), alpha: 0.18 * f });
        g.roundRect(p.x - p.r * 0.8, p.y - p.r, p.r * 1.6, p.r * 2, 3).fill({ color: this.c(k % 2 ? "#FFB547" : "#E0483A"), alpha: 0.9 });
      });
    }
  }
}
