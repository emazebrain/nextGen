/**
 * Colour maths for Catch Me If You Can (ported from v1 catchMeColors.js):
 * sRGB ↔ CIE Lab (D65) and the CIE76 colour difference ΔE.
 */
export interface Lab {
  L: number;
  a: number;
  b: number;
}

const toLinear = (c: number) => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => {
  const v = c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
  return Math.round(Math.max(0, Math.min(255, v * 255)));
};

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, "0")).join("")}`;
}

export function hexToLab(hex: string): Lab {
  const [r, g, b] = hexToRgb(hex).map(toLinear) as [number, number, number];
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

export function labToHex({ L, a, b }: Lab): string {
  const fy = (L + 16) / 116;
  const fx = a / 500 + fy;
  const fz = fy - b / 200;
  const inv = (t: number) => (t > 0.206897 ? t ** 3 : (t - 16 / 116) / 7.787);
  const x = inv(fx) * 0.95047;
  const y = inv(fy);
  const z = inv(fz) * 1.08883;
  const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z;
  const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z;
  const bl = 0.0556482 * x - 0.2040259 * y + 1.0572259 * z;
  return rgbToHex([toSrgb(r), toSrgb(g), toSrgb(bl)]);
}

export function deltaE76(p: Lab, q: Lab): number {
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/**
 * The odd tile's colour at a given ΔE from the base. A lightness shift is
 * preferred (it is also the only shift in colour-vision-deficiency mode, so the
 * difference never depends on telling hues apart); otherwise a hue shift.
 */
export function oddColour(base: Lab, deltaE: number, rng: () => number, cvdMode = false): Lab {
  const up = base.L + deltaE <= 99;
  const down = base.L - deltaE >= 1;
  if (up || down || cvdMode) {
    const dir = up && down ? (rng() < 0.5 ? 1 : -1) : up ? 1 : down ? -1 : base.L < 50 ? 1 : -1;
    return { ...base, L: Math.max(0, Math.min(100, base.L + deltaE * dir)) };
  }
  const angle = rng() * Math.PI * 2;
  return { ...base, a: base.a + Math.cos(angle) * deltaE, b: base.b + Math.sin(angle) * deltaE };
}

/**
 * The odd tile as a displayable hex colour. Saturated colours can fall outside
 * sRGB when shifted, which changes the real difference, so several shifts are
 * tried (lightness first) and the one whose measured ΔE is closest wins.
 */
export function oddHex(baseHex: string, deltaE: number, rng: () => number, cvdMode = false): string {
  const base = hexToLab(baseHex);
  const first = labToHex(oddColour(base, deltaE, rng, cvdMode));
  const candidates = [first, labToHex({ ...base, L: Math.min(100, base.L + deltaE) }), labToHex({ ...base, L: Math.max(0, base.L - deltaE) })];
  if (!cvdMode) {
    const offset = rng() * Math.PI * 2;
    for (let i = 0; i < 8; i++) {
      const angle = offset + (i * Math.PI) / 4;
      candidates.push(labToHex({ ...base, a: base.a + Math.cos(angle) * deltaE, b: base.b + Math.sin(angle) * deltaE }));
    }
  }
  const err = (hex: string) => Math.abs(deltaE76(hexToLab(hex), base) - deltaE);
  return candidates.reduce((best, c) => (err(c) < err(best) - 0.25 ? c : best), first);
}

/** Tile colours by palette (§8.4). Warm has no green; cold has no red or orange (v1's Forest Green replaced). */
export const TILE_COLOURS = {
  warm: ["#DC143C", "#E87411", "#E0A800", "#CB6843", "#E07060", "#E05040", "#CD5C5C", "#CD853F"],
  cold: ["#1D4ED8", "#0FBDE8", "#48D1CC", "#6A8FE0", "#4B0082", "#5F9EA6", "#7B68EE", "#2FB3C8"],
  // Black and white (ADR 0009): mid greys (L* about 25–71), so a lightness shift has room both ways.
  mono: ["#3C3C3C", "#4F4F4F", "#5E5E5E", "#6E6E6E", "#7E7E7E", "#8E8E8E", "#9E9E9E", "#ADADAD"],
} as const;

/**
 * Background colours by temperature (ADR 0009). Soft tones, so the HUD stays readable;
 * one is drawn at random per session. The boards' own light frames keep them away from the tiles.
 */
export const BACKGROUND_COLOURS = {
  warm: ["#FFE3BF", "#FFD6B3", "#FCE1CF", "#FFEDC2", "#F8D3C1", "#FFDDA6", "#F6CFAE", "#FBE4B4"],
  cold: ["#D3E9FF", "#CDEFF3", "#DCE1FF", "#C9E5F2", "#D9F3EA", "#D5E2F7", "#CCE0EE", "#E0DCF7"],
  mono: ["#EDEDED", "#E0E0E0", "#D2D2D2", "#C4C4C4", "#B6B6B6"],
} as const;
