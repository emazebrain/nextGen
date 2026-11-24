/**
 * Pictures drawn in code: letters, arithmetic signs, geometric shapes, arrows and road signs.
 * Each is an SVG on a 256 × 256 canvas with a transparent background. Pure strings; no DOM.
 */
const GRADS: [string, string][] = [
  ["#7C5CFF", "#4B2FD6"],
  ["#FF7A59", "#E0432B"],
  ["#12B5A6", "#0B7F8A"],
  ["#FFB02E", "#F2811D"],
  ["#3D8BFF", "#1F5FE0"],
  ["#F0529C", "#C22D78"],
  ["#31C46C", "#178F4A"],
  ["#8E6BFF", "#5A3FD1"],
];

const svg = (body: string, defs = ""): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256"><defs>${defs}<linearGradient id="hl" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".38"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>${body}</svg>`;

const grad = (i: number, id = "g"): string => {
  const [a, b] = GRADS[i % GRADS.length]!;
  return `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
};

const FONT = `'Arial Rounded MT Bold','Rubik','Heebo','Nunito','Segoe UI','Arial',sans-serif`;

/** A glyph on a rounded tile, like a keycap: reads clearly in colour and as a grey outline. */
export function tile(glyph: string, i: number): string {
  const esc = glyph.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  return svg(
    `<rect x="26" y="34" width="204" height="204" rx="46" fill="#000" opacity=".16"/>` +
      `<rect x="26" y="22" width="204" height="204" rx="46" fill="url(#g)"/>` +
      `<rect x="26" y="22" width="204" height="204" rx="46" fill="url(#hl)"/>` +
      `<text x="128" y="130" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="900" font-size="150" fill="#000" opacity=".2">${esc}</text>` +
      `<text x="128" y="124" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="900" font-size="150" fill="#fff">${esc}</text>`,
    grad(i),
  );
}

const poly = (n: number, r: number, rot = -90, cx = 128, cy = 128): string =>
  Array.from({ length: n }, (_, k) => {
    const a = ((rot + (360 / n) * k) * Math.PI) / 180;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

const starPoints = (): string =>
  Array.from({ length: 10 }, (_, k) => {
    const a = ((-90 + 36 * k) * Math.PI) / 180;
    const r = k % 2 ? 48 : 112;
    return `${(128 + r * Math.cos(a)).toFixed(1)},${(134 + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");

const solid = (shape: (fill: string) => string, i: number): string => svg(shape("url(#g)") + shape("url(#hl)"), grad(i));

const SHAPES: Record<string, (fill: string) => string> = {
  circle: (f) => `<circle cx="128" cy="128" r="104" fill="${f}"/>`,
  triangle: (f) => `<polygon points="128,26 236,222 20,222" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  square: (f) => `<rect x="30" y="30" width="196" height="196" rx="22" fill="${f}"/>`,
  pentagon: (f) => `<polygon points="${poly(5, 108, -90, 128, 134)}" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  hexagon: (f) => `<polygon points="${poly(6, 108, 0)}" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  star: (f) => `<polygon points="${starPoints()}" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  diamond: (f) => `<polygon points="128,18 222,128 128,238 34,128" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  heart: (f) => `<path d="M128 226C60 176 22 138 22 92c0-34 26-58 56-58 20 0 38 10 50 28 12-18 30-28 50-28 30 0 56 24 56 58 0 46-38 84-106 134z" fill="${f}"/>`,
  cross: (f) => `<path d="M96 28h64a10 10 0 0 1 10 10v48h48a10 10 0 0 1 10 10v64a10 10 0 0 1-10 10h-48v48a10 10 0 0 1-10 10H96a10 10 0 0 1-10-10v-48H38a10 10 0 0 1-10-10V96a10 10 0 0 1 10-10h48V38a10 10 0 0 1 10-10z" fill="${f}"/>`,
  crescent: (f) => `<path d="M170 30A104 104 0 1 0 232 190 86 86 0 0 1 170 30z" fill="${f}"/>`,
  trapezoid: (f) => `<polygon points="76,60 180,60 232,200 24,200" fill="${f}" stroke="${f}" stroke-width="12" stroke-linejoin="round"/>`,
  oval: (f) => `<ellipse cx="128" cy="128" rx="112" ry="72" fill="${f}"/>`,
};

const stroke = (d: string, i: number, extra = ""): string =>
  svg(`<path d="${d}" fill="none" stroke="url(#g)" stroke-width="34" stroke-linecap="round" stroke-linejoin="round" ${extra}/>`, grad(i).replace('id="g"', 'id="g" gradientUnits="userSpaceOnUse" x2="256" y2="256"'));

const STRAIGHT = "M36 128H216M150 62l66 66-66 66";
const ARROWS: Record<string, string> = {
  "arrow-right": stroke(STRAIGHT, 4),
  "arrow-left": stroke(STRAIGHT, 1, `transform="rotate(180 128 128)"`),
  "arrow-up": stroke(STRAIGHT, 2, `transform="rotate(-90 128 128)"`),
  "arrow-down": stroke(STRAIGHT, 3, `transform="rotate(90 128 128)"`),
  "arrow-up-right": stroke(STRAIGHT, 5, `transform="rotate(-45 128 128)"`),
  "arrow-both": stroke("M40 128H216M96 72l-56 56 56 56M160 72l56 56-56 56", 6),
  "arrow-turn": stroke("M56 220V120a40 40 0 0 1 40-40h110M156 30l50 50-50 50", 0),
  "arrow-u-turn": stroke("M70 220V108a58 58 0 0 1 116 0v70M136 136l50 50 50-50", 1),
  "arrow-chevrons": stroke("M52 56l72 72-72 72M136 56l72 72-72 72", 2),
  "arrow-circle": stroke("M210 128a82 82 0 1 1-28-62M186 22v48h-48", 3),
};

const ring = (inner: string, rim = "#D92B2B"): string => `<circle cx="128" cy="128" r="110" fill="${rim}"/><circle cx="128" cy="128" r="82" fill="#fff"/>${inner}`;
const SIGNS: Record<string, string> = {
  "sign-no-entry": svg(`<circle cx="128" cy="128" r="110" fill="#D92B2B"/><circle cx="128" cy="128" r="110" fill="url(#hl)"/><rect x="50" y="106" width="156" height="44" rx="8" fill="#fff"/>`),
  "sign-yield": svg(`<polygon points="22,40 234,40 128,226" fill="#D92B2B" stroke="#D92B2B" stroke-width="16" stroke-linejoin="round"/><polygon points="70,68 186,68 128,170" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>`),
  "sign-warning": svg(`<polygon points="128,26 236,216 20,216" fill="#D92B2B" stroke="#D92B2B" stroke-width="16" stroke-linejoin="round"/><polygon points="128,74 192,190 64,190" fill="#FFD23F" stroke="#FFD23F" stroke-width="8" stroke-linejoin="round"/><rect x="118" y="100" width="20" height="52" rx="10" fill="#1B1B1F"/><circle cx="128" cy="172" r="11" fill="#1B1B1F"/>`),
  "sign-speed-50": svg(ring(`<text x="128" y="132" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="900" font-size="96" fill="#1B1B1F">50</text>`)),
  "sign-stop": svg(`<polygon points="${poly(8, 116, 22.5)}" fill="#D92B2B"/><polygon points="${poly(8, 102, 22.5)}" fill="none" stroke="#fff" stroke-width="8"/><text x="128" y="132" text-anchor="middle" dominant-baseline="central" font-family="${FONT}" font-weight="900" font-size="62" fill="#fff">STOP</text>`),
  "sign-keep-right": svg(`<circle cx="128" cy="128" r="110" fill="#1F5FE0"/><circle cx="128" cy="128" r="110" fill="url(#hl)"/><path d="M70 128H180M136 84l44 44-44 44" fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"/>`),
  "sign-roundabout": svg(`<circle cx="128" cy="128" r="110" fill="#1F5FE0"/><circle cx="128" cy="128" r="110" fill="url(#hl)"/><path d="M184 128a56 56 0 1 1-20-43M168 56v34h-34" fill="none" stroke="#fff" stroke-width="22" stroke-linecap="round" stroke-linejoin="round"/>`),
  "sign-no-parking": svg(`<circle cx="128" cy="128" r="110" fill="#D92B2B"/><circle cx="128" cy="128" r="84" fill="#1F5FE0"/><path d="M70 70l116 116" stroke="#D92B2B" stroke-width="26" stroke-linecap="round"/>`),
  "sign-priority": svg(`<polygon points="128,14 242,128 128,242 14,128" fill="#fff" stroke="#1B1B1F" stroke-width="6" stroke-linejoin="round"/><polygon points="128,52 204,128 128,204 52,128" fill="#FFC91F" stroke="#FFC91F" stroke-width="6" stroke-linejoin="round"/>`),
  "sign-end-limit": svg(`<circle cx="128" cy="128" r="110" fill="#fff" stroke="#1B1B1F" stroke-width="8"/><path d="M178 54L58 174M198 74L78 194M158 34L38 154" stroke="#1B1B1F" stroke-width="10" stroke-linecap="round"/>`),
};

export const LATIN = ["A", "B", "D", "E", "G", "K", "M", "N", "R", "S", "T", "Y"];
export const HEBREW = ["א", "ב", "ג", "ד", "ה", "ל", "מ", "ס", "ע", "פ", "ק", "ש"];
export const DIGITS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];
export const OPERATIONS: Record<string, string> = { plus: "+", minus: "−", times: "×", divide: "÷", equals: "=" };
export const SHAPE_IDS = Object.keys(SHAPES);
export const ARROW_IDS = Object.keys(ARROWS);
export const SIGN_IDS = Object.keys(SIGNS);

/** The SVG for a code-drawn picture id, or null when the id is not one of them. */
export function drawnSvg(id: string): string | null {
  if (id.startsWith("letter-")) {
    const ch = id.slice(7);
    const i = LATIN.indexOf(ch) >= 0 ? LATIN.indexOf(ch) : HEBREW.indexOf(ch);
    return i >= 0 ? tile(ch, i) : null;
  }
  if (id.startsWith("op-")) {
    const sign = OPERATIONS[id.slice(3)];
    return sign ? tile(sign, Object.keys(OPERATIONS).indexOf(id.slice(3)) + 1) : null;
  }
  if (id.startsWith("shape-")) {
    const s = SHAPES[id.slice(6)];
    return s ? solid(s, SHAPE_IDS.indexOf(id.slice(6))) : null;
  }
  return ARROWS[id] ?? SIGNS[id] ?? null;
}
