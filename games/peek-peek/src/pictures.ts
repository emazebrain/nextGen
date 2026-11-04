/**
 * Placeholder picture packs (design doc §8.5): 4 packs × 14 original pictures,
 * drawn as small SVGs (viewBox 0 0 100 100) until the commissioned art lands.
 * Each picture has one strong silhouette and a dominant colour, so copies are
 * easy to match and different pictures are easy to tell apart at tile size.
 * Warm and cold lighting is applied by the renderer, so both palettes share
 * the same drawings.
 */

export type PackName = "marine" | "animals" | "household" | "faces";
export const PACK_NAMES: PackName[] = ["marine", "animals", "household", "faces"];

export interface Picture {
  id: string;
  svg: string;
}

const INK = "#2E2724";
const S = `stroke="${INK}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"`;
const eye = (x: number, y: number, r = 4) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FFFFFF" ${S}/><circle cx="${x + r * 0.2}" cy="${y + r * 0.1}" r="${r * 0.5}" fill="${INK}"/>`;
const dot = (x: number, y: number, r = 3, fill = INK) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${fill}"/>`;
const smile = (x: number, y: number, w = 10) => `<path d="M${x - w / 2} ${y} Q${x} ${y + w * 0.6} ${x + w / 2} ${y}" fill="none" ${S}/>`;
const wrap = (id: string, body: string): Picture => ({ id, svg: `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>` });

// ---------------------------------------------------------------- marine

const marine: Picture[] = [
  wrap("clownfish", `<path d="M14 50 L2 34 L2 66 Z" fill="#F57A1F" ${S}/><ellipse cx="50" cy="50" rx="36" ry="22" fill="#F57A1F" ${S}/><path d="M34 30 Q28 50 34 70 L42 71 Q36 50 42 29 Z" fill="#FFFFFF" ${S}/><path d="M58 29 Q52 50 58 71 L66 70 Q60 50 66 30 Z" fill="#FFFFFF" ${S}/>${eye(74, 45)}`),
  wrap("bluefish", `<path d="M16 50 L2 32 L6 50 L2 68 Z" fill="#F5C431" ${S}/><path d="M16 50 Q40 18 82 42 Q90 50 82 58 Q40 82 16 50 Z" fill="#2F6FD8" ${S}/><path d="M36 42 Q50 34 66 44 Q50 50 36 58 Z" fill="#1B2F6B"/>${eye(72, 46)}`),
  wrap("seahorse", `<path d="M52 12 Q72 12 70 30 L82 30 L70 38 Q68 52 58 60 Q66 70 60 82 Q50 92 42 84 Q38 76 48 76 Q54 72 46 64 Q34 54 40 38 Q42 18 52 12 Z" fill="#F5C431" ${S}/>${eye(58, 24, 3.5)}<path d="M44 40 L36 36 M44 48 L35 48 M46 56 L38 60" ${S}/>`),
  wrap("starfish", `<path d="M50 6 L61 37 L94 38 L68 58 L78 90 L50 71 L22 90 L32 58 L6 38 L39 37 Z" fill="#E8503A" ${S}/>${dot(50, 30, 2.5, "#FFD2A8")}${dot(70, 45, 2.5, "#FFD2A8")}${dot(30, 45, 2.5, "#FFD2A8")}${dot(62, 70, 2.5, "#FFD2A8")}${dot(38, 70, 2.5, "#FFD2A8")}${eye(44, 48, 3)}${eye(56, 48, 3)}`),
  wrap("jellyfish", `<path d="M14 52 Q14 14 50 14 Q86 14 86 52 Z" fill="#F08BC8" ${S}/><path d="M24 54 Q20 70 28 82 M40 54 Q36 74 44 90 M56 54 Q60 74 54 90 M74 54 Q80 70 72 82" fill="none" stroke="#C2489A" stroke-width="4" stroke-linecap="round"/>${eye(40, 38)}${eye(60, 38)}`),
  wrap("crab", `<path d="M10 40 L4 22 L16 28 Z M90 40 L96 22 L84 28 Z" fill="#D9342B" ${S}/><path d="M14 40 Q20 48 26 52 M86 40 Q80 48 74 52" fill="none" ${S}/><ellipse cx="50" cy="62" rx="30" ry="20" fill="#D9342B" ${S}/><path d="M24 70 L10 80 M28 76 L18 88 M76 70 L90 80 M72 76 L82 88" ${S}/><path d="M40 44 L40 34 M60 44 L60 34" ${S}/>${eye(40, 30)}${eye(60, 30)}${smile(50, 64, 12)}`),
  wrap("octopus", `<path d="M22 50 Q22 12 50 12 Q78 12 78 50 Q78 60 72 62 L66 62 Z" fill="#8E5BD0" ${S}/><path d="M24 54 Q12 72 20 86 M38 60 Q32 80 40 92 M50 62 Q50 82 52 94 M62 60 Q68 80 60 92 M76 54 Q88 72 80 86" fill="none" stroke="#8E5BD0" stroke-width="9" stroke-linecap="round"/><path d="M24 54 Q12 72 20 86 M38 60 Q32 80 40 92 M50 62 Q50 82 52 94 M62 60 Q68 80 60 92 M76 54 Q88 72 80 86" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" opacity=".35"/><path d="M22 50 Q22 12 50 12 Q78 12 78 50 Z" fill="#8E5BD0" ${S}/>${eye(40, 38)}${eye(60, 38)}`),
  wrap("turtle", `<ellipse cx="82" cy="50" rx="10" ry="8" fill="#7BC46B" ${S}/><path d="M26 68 L18 80 M70 68 L78 80 M26 32 L18 20 M70 32 L78 20" stroke="#7BC46B" stroke-width="10" stroke-linecap="round"/><ellipse cx="48" cy="50" rx="30" ry="24" fill="#2F8F4E" ${S}/><path d="M48 30 L60 40 L56 56 L40 56 L36 40 Z" fill="#5DB36E" ${S}/>${dot(85, 47, 2)}`),
  wrap("whale", `<path d="M10 56 Q8 30 40 30 Q72 28 80 50 L94 38 L92 66 L80 58 Q74 78 40 78 Q12 78 10 56 Z" fill="#3B6FB6" ${S}/><path d="M14 62 Q40 74 76 62 Q70 76 40 76 Q18 76 14 62 Z" fill="#CFE3F7"/><path d="M30 26 Q28 14 22 12 M30 26 Q34 14 40 12" fill="none" stroke="#6CC4E8" stroke-width="3" stroke-linecap="round"/>${eye(26, 50, 3.5)}${smile(36, 60, 10)}`),
  wrap("scallop", `<path d="M50 84 L14 40 Q22 14 50 12 Q78 14 86 40 Z" fill="#F7A6B8" ${S}/><path d="M50 84 L30 22 M50 84 L50 14 M50 84 L70 22 M50 84 L18 38 M50 84 L82 38" fill="none" stroke="#D96F8C" stroke-width="2.5"/><rect x="38" y="80" width="24" height="10" rx="4" fill="#F7A6B8" ${S}/>`),
  wrap("pufferfish", `<path d="M50 10 L54 20 L64 12 L64 24 L76 20 L72 32 L86 32 L78 42 L92 48 L80 54 L88 66 L74 66 L76 80 L64 74 L62 88 L52 78 L44 90 L40 76 L28 84 L28 70 L14 72 L20 60 L8 52 L20 46 L12 34 L26 34 L24 20 L36 26 L38 12 L46 22 Z" fill="#F2D04B" ${S}/><circle cx="50" cy="50" r="28" fill="#F7DE6E" ${S}/>${eye(40, 44)}${eye(60, 44)}<ellipse cx="50" cy="60" rx="5" ry="4" fill="#E88A3A" ${S}/>`),
  wrap("dolphin", `<path d="M8 62 Q30 26 66 30 L74 18 L76 32 Q90 38 94 52 L82 54 Q80 66 60 68 L62 80 L50 70 Q30 72 20 66 Z" fill="#8FA3B8" ${S}/><path d="M20 66 Q40 60 82 54 Q78 64 60 66 Q36 70 20 66 Z" fill="#E5EDF4"/>${eye(76, 42, 3)}<path d="M8 62 L2 54 M8 62 L4 72" ${S}/>`),
  wrap("stingray", `<path d="M50 18 Q66 32 94 44 Q70 52 56 72 L50 70 L44 72 Q30 52 6 44 Q34 32 50 18 Z" fill="#5C7C8A" ${S}/><path d="M50 70 Q52 84 64 94" fill="none" ${S}/>${eye(42, 42, 3.5)}${eye(58, 42, 3.5)}${smile(50, 54, 8)}`),
  wrap("lobster", `<path d="M30 30 Q18 10 30 8 Q40 8 38 24 Z M70 30 Q82 10 70 8 Q60 8 62 24 Z" fill="#E1452F" ${S}/><path d="M36 26 L44 40 M64 26 L56 40" ${S}/><ellipse cx="50" cy="52" rx="14" ry="16" fill="#E1452F" ${S}/><path d="M38 66 L62 66 L60 76 L40 76 Z M40 76 L60 76 L58 84 L42 84 Z" fill="#E1452F" ${S}/><path d="M42 84 L32 94 L50 90 L68 94 L58 84 Z" fill="#E1452F" ${S}/>${eye(44, 46, 3)}${eye(56, 46, 3)}`),
];

// ---------------------------------------------------------------- animals (heads)

const ears = (fill: string, inner: string, shape: "point" | "round" | "long") =>
  shape === "point"
    ? `<path d="M22 40 L24 8 L46 26 Z M78 40 L76 8 L54 26 Z" fill="${fill}" ${S}/><path d="M28 32 L29 18 L39 27 Z M72 32 L71 18 L61 27 Z" fill="${inner}"/>`
    : shape === "round"
      ? `<circle cx="24" cy="26" r="13" fill="${fill}" ${S}/><circle cx="76" cy="26" r="13" fill="${fill}" ${S}/><circle cx="24" cy="26" r="6" fill="${inner}"/><circle cx="76" cy="26" r="6" fill="${inner}"/>`
      : `<ellipse cx="36" cy="18" rx="9" ry="20" fill="${fill}" ${S}/><ellipse cx="64" cy="18" rx="9" ry="20" fill="${fill}" ${S}/><ellipse cx="36" cy="18" rx="4" ry="13" fill="${inner}"/><ellipse cx="64" cy="18" rx="4" ry="13" fill="${inner}"/>`;
const head = (fill: string, ry = 32) => `<ellipse cx="50" cy="56" rx="34" ry="${ry}" fill="${fill}" ${S}/>`;

const animals: Picture[] = [
  wrap("cat", `${ears("#F2A541", "#F7C9A0", "point")}${head("#F2A541")}${eye(38, 52)}${eye(62, 52)}<path d="M46 62 L54 62 L50 67 Z" fill="#E86B7A"/><path d="M50 67 Q44 74 40 70 M50 67 Q56 74 60 70 M30 64 L12 60 M30 68 L12 72 M70 64 L88 60 M70 68 L88 72" fill="none" ${S}/>`),
  wrap("dog", `<ellipse cx="18" cy="48" rx="11" ry="22" fill="#8B5A3C" ${S}/><ellipse cx="82" cy="48" rx="11" ry="22" fill="#8B5A3C" ${S}/>${head("#C98B5E")}<ellipse cx="62" cy="48" rx="10" ry="9" fill="#8B5A3C"/>${eye(38, 50)}${eye(62, 50)}<ellipse cx="50" cy="66" rx="7" ry="5" fill="${INK}"/><path d="M50 70 L50 76 M42 78 Q50 84 58 78" fill="none" ${S}/>`),
  wrap("rabbit", `${ears("#F3F0EA", "#F5B5C4", "long")}${head("#F3F0EA", 28)}${eye(40, 56)}${eye(60, 56)}<ellipse cx="50" cy="66" rx="4" ry="3" fill="#E86B7A"/><path d="M46 74 L50 70 L54 74" fill="none" ${S}/><rect x="45" y="74" width="10" height="7" rx="1" fill="#FFFFFF" ${S}/>`),
  wrap("bear", `${ears("#8A5A3B", "#C79B78", "round")}${head("#8A5A3B")}<ellipse cx="50" cy="68" rx="16" ry="12" fill="#C79B78" ${S}/>${eye(38, 50)}${eye(62, 50)}<ellipse cx="50" cy="64" rx="5" ry="4" fill="${INK}"/>${smile(50, 72, 10)}`),
  wrap("pig", `<path d="M22 34 L22 14 L40 26 Z M78 34 L78 14 L60 26 Z" fill="#F4A2B4" ${S}/>${head("#F4A2B4")}<ellipse cx="50" cy="66" rx="14" ry="10" fill="#F7C3CE" ${S}/>${dot(45, 66, 3)}${dot(55, 66, 3)}${eye(37, 48)}${eye(63, 48)}`),
  wrap("cow", `<path d="M20 30 Q8 24 10 14 Q18 24 26 26 Z M80 30 Q92 24 90 14 Q82 24 74 26 Z" fill="#F5E6C8" ${S}/>${head("#FFFFFF")}<path d="M22 40 Q30 30 42 38 Q38 50 26 50 Z" fill="${INK}"/><ellipse cx="50" cy="72" rx="20" ry="13" fill="#F4A2B4" ${S}/>${dot(43, 72, 3)}${dot(57, 72, 3)}${eye(38, 52)}${eye(62, 52)}`),
  wrap("frog", `<circle cx="32" cy="30" r="14" fill="#5DBB4A" ${S}/><circle cx="68" cy="30" r="14" fill="#5DBB4A" ${S}/><ellipse cx="50" cy="60" rx="38" ry="28" fill="#5DBB4A" ${S}/>${eye(32, 30, 7)}${eye(68, 30, 7)}<path d="M24 62 Q50 82 76 62" fill="none" ${S}/>${dot(40, 52, 2)}${dot(60, 52, 2)}`),
  wrap("lion", `<circle cx="50" cy="52" r="44" fill="#C46A1E" ${S}/>${head("#F2B540", 28)}${eye(38, 50)}${eye(62, 50)}<path d="M44 60 L56 60 L50 66 Z" fill="${INK}"/><path d="M50 66 Q44 74 38 70 M50 66 Q56 74 62 70" fill="none" ${S}/>`),
  wrap("elephant", `<ellipse cx="18" cy="48" rx="16" ry="24" fill="#9AA6B4" ${S}/><ellipse cx="82" cy="48" rx="16" ry="24" fill="#9AA6B4" ${S}/>${head("#B6C0CC", 30)}<path d="M44 58 Q44 80 36 90 L46 92 Q54 80 56 58 Z" fill="#B6C0CC" ${S}/>${eye(38, 46)}${eye(62, 46)}`),
  wrap("owl", `<path d="M20 30 L26 8 L40 22 Z M80 30 L74 8 L60 22 Z" fill="#8C6A4F" ${S}/><ellipse cx="50" cy="54" rx="34" ry="38" fill="#8C6A4F" ${S}/><ellipse cx="50" cy="70" rx="20" ry="20" fill="#E2C9A6"/><circle cx="36" cy="42" r="13" fill="#F5E9D4" ${S}/><circle cx="64" cy="42" r="13" fill="#F5E9D4" ${S}/>${dot(37, 43, 6)}${dot(65, 43, 6)}<path d="M45 52 L55 52 L50 62 Z" fill="#F2A541" ${S}/>`),
  wrap("chick", `<circle cx="50" cy="54" r="36" fill="#FFD84A" ${S}/><path d="M44 18 Q46 8 52 12 Q54 4 58 14" fill="none" ${S}/>${eye(38, 48)}${eye(62, 48)}<path d="M40 60 L60 60 L50 72 Z" fill="#F28C28" ${S}/><circle cx="28" cy="62" r="5" fill="#F7A6B8"/><circle cx="72" cy="62" r="5" fill="#F7A6B8"/>`),
  wrap("mouse", `<circle cx="22" cy="30" r="18" fill="#B9B4AE" ${S}/><circle cx="78" cy="30" r="18" fill="#B9B4AE" ${S}/><circle cx="22" cy="30" r="10" fill="#F5B5C4"/><circle cx="78" cy="30" r="10" fill="#F5B5C4"/><path d="M18 56 Q22 30 50 30 Q78 30 82 56 Q78 76 50 88 Q22 76 18 56 Z" fill="#B9B4AE" ${S}/>${eye(38, 54)}${eye(62, 54)}<circle cx="50" cy="80" r="5" fill="#E86B7A"/><path d="M40 76 L20 72 M40 80 L22 84 M60 76 L80 72 M60 80 L78 84" ${S}/>`),
  wrap("fox", `${ears("#E8742B", "#FFFFFF", "point")}<path d="M16 42 Q20 30 50 30 Q80 30 84 42 L50 90 Z" fill="#E8742B" ${S}/><path d="M24 54 Q38 56 50 90 Q62 56 76 54 L50 90 Z" fill="#FFFFFF"/><path d="M16 42 Q20 30 50 30 Q80 30 84 42 L50 90 Z" fill="none" ${S}/>${eye(38, 50)}${eye(62, 50)}<ellipse cx="50" cy="84" rx="4" ry="3" fill="${INK}"/>`),
  wrap("panda", `${ears(INK, "#4A4A4A", "round")}${head("#FFFFFF")}<ellipse cx="36" cy="52" rx="9" ry="11" fill="${INK}" transform="rotate(-20 36 52)"/><ellipse cx="64" cy="52" rx="9" ry="11" fill="${INK}" transform="rotate(20 64 52)"/>${dot(37, 51, 3, "#FFFFFF")}${dot(63, 51, 3, "#FFFFFF")}<ellipse cx="50" cy="66" rx="5" ry="4" fill="${INK}"/>${smile(50, 74, 10)}`),
];

// ---------------------------------------------------------------- household

const household: Picture[] = [
  wrap("mug", `<path d="M70 38 Q90 38 88 56 Q86 72 68 70" fill="none" stroke="${INK}" stroke-width="9"/><path d="M70 38 Q90 38 88 56 Q86 72 68 70" fill="none" stroke="#E35B4B" stroke-width="4"/><path d="M18 28 L74 28 L68 86 L24 86 Z" fill="#E35B4B" ${S}/><path d="M34 20 Q30 12 36 6 M48 20 Q44 12 50 6" fill="none" stroke="#9AA6B4" stroke-width="3" stroke-linecap="round"/>${dot(46, 56, 6, "#FFFFFF")}`),
  wrap("teapot", `<path d="M78 46 Q96 40 92 28 L86 30 Q86 40 74 44 Z" fill="#3DA5A0" ${S}/><path d="M22 50 Q8 50 10 62 Q12 72 24 70" fill="none" ${S}/><ellipse cx="50" cy="60" rx="30" ry="24" fill="#3DA5A0" ${S}/><path d="M34 36 Q50 28 66 36 Z" fill="#2B7E7A" ${S}/>${dot(50, 28, 5, "#F5C431")}<path d="M28 60 L72 60" stroke="#F5C431" stroke-width="5"/>`),
  wrap("lamp", `<path d="M30 14 L70 14 L82 48 L18 48 Z" fill="#F5C431" ${S}/><rect x="46" y="48" width="8" height="30" fill="#8A6A52" ${S}/><path d="M28 90 Q50 76 72 90 Z" fill="#8A6A52" ${S}/>`),
  wrap("chair", `<rect x="26" y="8" width="48" height="44" rx="6" fill="#B07A4A" ${S}/><rect x="34" y="16" width="32" height="28" rx="3" fill="#E8B07C"/><rect x="20" y="50" width="60" height="12" rx="3" fill="#B07A4A" ${S}/><path d="M26 62 L24 94 M74 62 L76 94 M38 62 L38 86 M62 62 L62 86" stroke="#7A4E2A" stroke-width="6" stroke-linecap="round"/>`),
  wrap("clock", `<path d="M22 24 Q20 10 32 12 M78 24 Q80 10 68 12" fill="none" stroke="${INK}" stroke-width="6" stroke-linecap="round"/><circle cx="50" cy="54" r="34" fill="#4A7BD0" ${S}/><circle cx="50" cy="54" r="26" fill="#FFFFFF" ${S}/><path d="M50 54 L50 36 M50 54 L62 60" ${S} stroke-width="4"/>${dot(50, 54, 3)}<path d="M28 88 L22 96 M72 88 L78 96" ${S}/>`),
  wrap("key", `<circle cx="28" cy="50" r="18" fill="#E8B83A" ${S}/><circle cx="28" cy="50" r="7" fill="#FFF6DA" ${S}/><path d="M44 44 L92 44 L92 56 L84 56 L84 66 L76 66 L76 56 L68 56 L68 64 L60 64 L60 56 L44 56 Z" fill="#E8B83A" ${S}/>`),
  wrap("umbrella", `<path d="M8 50 Q10 12 50 10 Q90 12 92 50 Q84 42 76 50 Q68 42 58 50 Q50 42 42 50 Q32 42 24 50 Q16 42 8 50 Z" fill="#7A4FC4" ${S}/><path d="M50 10 L50 50 M30 14 Q34 30 42 50 M70 14 Q66 30 58 50" stroke="#5A35A0" stroke-width="2.5" fill="none"/><path d="M50 50 L50 84 Q50 94 40 92 Q34 90 36 84" fill="none" ${S} stroke-width="4"/>`),
  wrap("book", `<path d="M10 22 Q30 16 50 26 L50 86 Q30 76 10 82 Z" fill="#E8503A" ${S}/><path d="M90 22 Q70 16 50 26 L50 86 Q70 76 90 82 Z" fill="#F07A5E" ${S}/><path d="M18 34 Q30 31 42 36 M18 46 Q30 43 42 48 M58 36 Q70 31 82 34 M58 48 Q70 43 82 46" fill="none" stroke="#FFFFFF" stroke-width="3" stroke-linecap="round"/>`),
  wrap("spoon", `<ellipse cx="50" cy="28" rx="16" ry="22" fill="#C8D2DC" ${S}/><ellipse cx="46" cy="22" rx="5" ry="9" fill="#FFFFFF"/><rect x="45" y="48" width="10" height="44" rx="5" fill="#C8D2DC" ${S}/>`),
  wrap("bed", `<rect x="8" y="30" width="14" height="56" rx="4" fill="#8A5A3B" ${S}/><rect x="78" y="46" width="14" height="40" rx="4" fill="#8A5A3B" ${S}/><rect x="20" y="52" width="60" height="22" rx="4" fill="#5B8FD8" ${S}/><rect x="22" y="40" width="24" height="14" rx="6" fill="#FFFFFF" ${S}/><rect x="44" y="48" width="36" height="12" rx="4" fill="#9CC0F0" ${S}/>`),
  wrap("plant", `<path d="M50 56 Q30 50 22 26 Q42 30 50 52 Q54 24 72 12 Q74 38 52 56 Q66 40 86 42 Q76 58 52 58 Z" fill="#4FAF57" ${S}/><path d="M30 56 L70 56 L64 92 L36 92 Z" fill="#D9743E" ${S}/><rect x="26" y="54" width="48" height="10" rx="3" fill="#C0602F" ${S}/>`),
  wrap("bulb", `<path d="M50 8 Q78 8 78 38 Q78 52 64 62 L64 72 L36 72 L36 62 Q22 52 22 38 Q22 8 50 8 Z" fill="#FFE36B" ${S}/><path d="M42 60 L46 40 L50 52 L54 40 L58 60" fill="none" stroke="#E8A03A" stroke-width="3"/><rect x="36" y="72" width="28" height="8" rx="2" fill="#9AA6B4" ${S}/><rect x="38" y="80" width="24" height="8" rx="2" fill="#9AA6B4" ${S}/><path d="M44 88 L56 88 L52 94 L48 94 Z" fill="${INK}"/>`),
  wrap("sock", `<path d="M34 8 L64 8 L64 56 Q64 64 72 68 L84 74 Q94 80 88 90 Q82 98 70 92 L42 80 Q30 74 32 60 Z" fill="#3FB37F" ${S}/><path d="M34 8 L64 8 L64 22 L34 22 Z" fill="#FFFFFF" ${S}/><path d="M34 34 L64 34 M34 46 L64 46" stroke="#FFFFFF" stroke-width="5"/><path d="M76 72 Q90 78 88 90 Q84 96 74 92 Z" fill="#FFFFFF" ${S}/>`),
  wrap("watering-can", `<path d="M70 46 L92 26 L96 32 L74 56 Z" fill="#3B9AD8" ${S}/><rect x="16" y="40" width="56" height="44" rx="6" fill="#3B9AD8" ${S}/><path d="M20 40 Q20 18 44 18 Q68 18 68 40" fill="none" ${S} stroke-width="5"/><path d="M90 20 L98 14 M92 30 L100 30" stroke="#6CC4E8" stroke-width="3" stroke-linecap="round"/>${dot(44, 62, 8, "#9CD2F5")}`),
];

// ---------------------------------------------------------------- faces (children)

interface FaceSpec {
  id: string;
  skin: string;
  hair: string;
  style: "short" | "bob" | "curly" | "pigtails" | "spiky" | "bun" | "long" | "none";
  extra?: "glasses" | "cap" | "bow" | "freckles" | "headband";
  mouth?: "smile" | "grin" | "o";
}
function face(f: FaceSpec): Picture {
  const back =
    f.style === "long" ? `<path d="M16 50 Q14 14 50 12 Q86 14 84 50 L86 86 L14 86 Z" fill="${f.hair}" ${S}/>`
    : f.style === "pigtails" ? `<circle cx="14" cy="50" r="12" fill="${f.hair}" ${S}/><circle cx="86" cy="50" r="12" fill="${f.hair}" ${S}/>`
    : f.style === "bun" ? `<circle cx="50" cy="12" r="12" fill="${f.hair}" ${S}/>`
    : f.style === "curly" ? [18, 30, 44, 58, 72, 84].map((x, i) => `<circle cx="${x}" cy="${i % 2 ? 22 : 30}" r="13" fill="${f.hair}" ${S}/>`).join("") + `<circle cx="16" cy="46" r="11" fill="${f.hair}" ${S}/><circle cx="84" cy="46" r="11" fill="${f.hair}" ${S}/>`
    : "";
  const front =
    f.style === "short" ? `<path d="M18 46 Q16 16 50 16 Q84 16 82 46 Q70 30 50 32 Q30 30 18 46 Z" fill="${f.hair}" ${S}/>`
    : f.style === "bob" ? `<path d="M16 62 Q12 16 50 16 Q88 16 84 62 L76 62 Q78 36 50 36 Q22 36 24 62 Z" fill="${f.hair}" ${S}/>`
    : f.style === "spiky" ? `<path d="M18 46 L20 22 L30 30 L36 12 L46 26 L54 10 L60 26 L70 14 L72 30 L82 24 L82 46 Q66 34 50 36 Q34 34 18 46 Z" fill="${f.hair}" ${S}/>`
    : f.style === "long" || f.style === "pigtails" || f.style === "bun" ? `<path d="M18 46 Q18 18 50 18 Q82 18 82 46 Q66 30 50 36 Q34 30 18 46 Z" fill="${f.hair}" ${S}/>`
    : "";
  const extra =
    f.extra === "glasses" ? `<circle cx="38" cy="54" r="9" fill="none" ${S}/><circle cx="62" cy="54" r="9" fill="none" ${S}/><path d="M47 54 L53 54" ${S}/>`
    : f.extra === "cap" ? `<path d="M16 42 Q16 14 50 14 Q84 14 84 42 Z" fill="#E8503A" ${S}/><path d="M50 42 L96 42 Q92 50 50 48 Z" fill="#C2392B" ${S}/>`
    : f.extra === "bow" ? `<path d="M66 22 L82 12 L82 34 Z M66 22 L50 12 L50 34 Z" fill="#F08BC8" ${S}/>${dot(66, 22, 4, "#C2489A")}`
    : f.extra === "freckles" ? [30, 36, 64, 70].map((x, i) => dot(x, 64 + (i % 2) * 3, 1.6, "#A0522D")).join("")
    : f.extra === "headband" ? `<path d="M18 42 Q50 22 82 42" fill="none" stroke="#4A7BD0" stroke-width="7" stroke-linecap="round"/>`
    : "";
  const mouth =
    f.mouth === "grin" ? `<path d="M38 70 Q50 84 62 70 Z" fill="#FFFFFF" ${S}/>`
    : f.mouth === "o" ? `<ellipse cx="50" cy="73" rx="5" ry="6" fill="#B33A3A" ${S}/>`
    : smile(50, 70, 18);
  return wrap(
    f.id,
    `${back}<ellipse cx="50" cy="56" rx="32" ry="34" fill="${f.skin}" ${S}/>${front}${extra}${eye(38, 54, 4.5)}${eye(62, 54, 4.5)}<circle cx="30" cy="66" r="5" fill="#F28B8B" opacity=".45"/><circle cx="70" cy="66" r="5" fill="#F28B8B" opacity=".45"/>${mouth}`,
  );
}

const faces: Picture[] = [
  face({ id: "face-ada", skin: "#F6D2B8", hair: "#E8B83A", style: "pigtails", mouth: "grin" }),
  face({ id: "face-ben", skin: "#8D5A3B", hair: "#1E1A18", style: "curly", extra: "glasses" }),
  face({ id: "face-chen", skin: "#F1C9A0", hair: "#1E1A18", style: "bob", extra: "bow" }),
  face({ id: "face-dana", skin: "#C68A5E", hair: "#5A3420", style: "long", mouth: "o" }),
  face({ id: "face-eli", skin: "#F6D2B8", hair: "#C0502A", style: "short", extra: "freckles", mouth: "grin" }),
  face({ id: "face-farah", skin: "#A86B45", hair: "#2B1D16", style: "bun", extra: "headband" }),
  face({ id: "face-gil", skin: "#F1C9A0", hair: "#7A4E2A", style: "spiky" }),
  face({ id: "face-hila", skin: "#E5B48C", hair: "#E8B83A", style: "bob", extra: "glasses", mouth: "o" }),
  face({ id: "face-ido", skin: "#6B4430", hair: "#1E1A18", style: "short", extra: "cap", mouth: "grin" }),
  face({ id: "face-jun", skin: "#F1C9A0", hair: "#1E1A18", style: "spiky", extra: "glasses", mouth: "grin" }),
  face({ id: "face-kai", skin: "#F6D2B8", hair: "#9AA6B4", style: "curly", mouth: "o" }),
  face({ id: "face-lior", skin: "#C68A5E", hair: "#C0502A", style: "long", extra: "bow" }),
  face({ id: "face-maya", skin: "#8D5A3B", hair: "#2B1D16", style: "pigtails", extra: "headband" }),
  face({ id: "face-noam", skin: "#E5B48C", hair: "#5A3420", style: "none", extra: "freckles", mouth: "o" }),
];

export const PACKS: Record<PackName, Picture[]> = { marine, animals, household, faces };

/** `rotate` cycles the four packs level by level. */
export function packForLevel(pack: PackName | "rotate", level: number): PackName {
  return pack === "rotate" ? PACK_NAMES[(level - 1) % PACK_NAMES.length]! : pack;
}
