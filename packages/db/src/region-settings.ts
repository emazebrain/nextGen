/**
 * The product owner's brain-region settings table (spec 2026-11-09-brain-region-filters-design.md), as typed data.
 * Source: `region-settings.csv` next to this file (blank cells filled from the line above; values as given).
 * `REGION_SETTINGS` must equal `parseSettingsCsv(<the CSV>)`; a test checks it. To apply a correction: edit the CSV,
 * update REGION_SETTINGS to match, and ship a migration that updates the changed rows and bumps their revision.
 */
export type Direction =
  "ltr" | "rtl" | "ttb" | "btt" | "tldbr" | "brdtl" | "trdbl" | "bldtr";
export type Compass = "N" | "NE" | "E" | "SE" | "S" | "SW" | "W" | "NW";

export interface SettingRow {
  side: "left" | "right";
  lobe: string;
  sublobe: string;
  bg_temperature: "warm" | "cold";
  bg_types: ("solid" | "textured")[];
  motion: { movement_types: number[]; directions: Direction[] }[];
  target_locations: Compass[];
  rotation: "cw" | "ccw";
}

const SUBLOBE_CODE: Record<string, string> = {
  cerebelum: "cerebellum",
  cerebellum: "cerebellum",
  dlpfc: "dlpfc",
  "orbital frontal": "orbitofrontal",
  parietal: "parietal_main",
  "superior parietal": "superior_parietal",
  "superior temporal": "superior_temporal",
  "middle temporal": "middle_temporal",
  "inferior temporal": "inferior_temporal",
  pons: "pons",
  mesencephalon: "mesencephalon",
};
const DIRS = new Set([
  "ltr",
  "rtl",
  "ttb",
  "btt",
  "tldbr",
  "brdtl",
  "trdbl",
  "bldtr",
]);
const COMPASS = new Set(["N", "NE", "E", "SE", "S", "SW", "W", "NW"]);

function csvLines(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) rows.push(row);
  return rows;
}
const list = (s: string) =>
  s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);

function fail(msg: string): never {
  throw new Error(`region-settings.csv: ${msg}`);
}

/** One row per side × sub-lobe; each CSV line of a sub-lobe becomes one `motion` entry. */
export function parseSettingsCsv(text: string): SettingRow[] {
  const [header, ...lines] = csvLines(text.replace(/^﻿/, ""));
  const col = (name: string) => {
    const i = header!.findIndex((h) => h.trim().toLowerCase() === name);
    if (i < 0) fail(`missing column ${name}`);
    return i;
  };
  const c = {
    side: col("side"),
    lobe: col("lobe"),
    sub: col("sub lobe"),
    temp: col("bg color"),
    type: col("bg type"),
    dir: col("movement direction"),
    mt: col("movment type"),
    target: col("target location"),
    rot: col("rotation"),
  };
  const out: SettingRow[] = [];
  for (const l of lines) {
    const side = l[c.side]!.trim().toLowerCase();
    if (side !== "left" && side !== "right") fail(`bad side ${side}`);
    const lobe = l[c.lobe]!.trim().toLowerCase();
    const sublobe =
      SUBLOBE_CODE[l[c.sub]!.trim().toLowerCase()] ??
      fail(`unknown sub-lobe ${l[c.sub]}`);
    const directions = list(l[c.dir]!.toLowerCase()).map((d) =>
      DIRS.has(d) ? (d as Direction) : fail(`bad direction ${d}`),
    );
    const movement_types = list(l[c.mt]!).map((m) =>
      /^[0-5]$/.test(m) ? Number(m) : fail(`bad movement type ${m}`),
    );
    const prev = out.find((r) => r.side === side && r.sublobe === sublobe);
    if (prev) {
      prev.motion.push({ movement_types, directions });
      continue;
    }
    const temp = l[c.temp]!.trim().toLowerCase();
    if (temp !== "warm" && temp !== "cold") fail(`bad colour ${temp}`);
    const rot = l[c.rot]!.trim().toLowerCase();
    if (rot !== "cw" && rot !== "ccw") fail(`bad rotation ${rot}`);
    out.push({
      side,
      lobe,
      sublobe,
      bg_temperature: temp,
      bg_types: list(l[c.type]!.toLowerCase()).map((t) =>
        t === "solid" || t === "textured"
          ? t
          : fail(`bad background type ${t}`),
      ),
      motion: [{ movement_types, directions }],
      target_locations: list(l[c.target]!.toUpperCase()).map((t) =>
        COMPASS.has(t) ? (t as Compass) : fail(`bad target ${t}`),
      ),
      rotation: rot,
    });
  }
  return out;
}

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const arr = (xs: string[]) => `ARRAY[${xs.map(q).join(", ")}]::text[]`;

/** The INSERTs migration 0018 runs to seed `app.region_setting` (clinical_status draft, revision 1). */
export function settingSeedSql(rows: SettingRow[]): string {
  return rows
    .map(
      (r) =>
        `INSERT INTO app.region_setting (sublobe_id, bg_temperature, bg_types, motion, target_locations, rotation) SELECT id, ${q(r.bg_temperature)}, ${arr(r.bg_types)}, ${q(JSON.stringify(r.motion))}::jsonb, ${arr(r.target_locations)}, ${q(r.rotation)} FROM app.brain_region WHERE path = ${q(`${r.side}.${r.lobe}.${r.sublobe}`)};`,
    )
    .join("\n");
}

/** Generated from region-settings.csv with parseSettingsCsv; kept in step by test/region-data.test.ts. */
export const REGION_SETTINGS: SettingRow[] = [
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "cerebellum",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 3], directions: ["tldbr"] },
      { movement_types: [1], directions: ["brdtl"] },
    ],
    target_locations: ["W", "SW", "NW", "N", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "frontal",
    sublobe: "dlpfc",
    bg_temperature: "cold",
    bg_types: ["textured"],
    motion: [
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [1], directions: ["rtl", "brdtl"] },
    ],
    target_locations: ["W", "SW", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "frontal",
    sublobe: "orbitofrontal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0, 3], directions: ["ltr", "ltr"] },
      { movement_types: [1], directions: ["rtl", "brdtl"] },
    ],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "parietal",
    sublobe: "parietal_main",
    bg_temperature: "cold",
    bg_types: ["textured"],
    motion: [{ movement_types: [0], directions: ["ltr", "tldbr"] }],
    target_locations: ["W", "SW", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "parietal",
    sublobe: "superior_parietal",
    bg_temperature: "cold",
    bg_types: ["textured"],
    motion: [{ movement_types: [0], directions: ["ltr", "tldbr"] }],
    target_locations: ["W", "SW", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "superior_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["ltr", "tldbr"] }],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "middle_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["ltr", "tldbr"] }],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "inferior_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["ltr", "tldbr"] }],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "pons",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 3], directions: ["ltr"] },
      { movement_types: [1], directions: ["rtl"] },
    ],
    target_locations: ["W", "SW", "NW"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "mesencephalon",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [{ movement_types: [0, 1], directions: ["ttb"] }],
    target_locations: ["W", "N", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "cerebellum",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 3], directions: ["trdbl"] },
      { movement_types: [1], directions: ["bldtr"] },
    ],
    target_locations: ["E", "SE", "NE", "N", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "frontal",
    sublobe: "dlpfc",
    bg_temperature: "warm",
    bg_types: ["textured"],
    motion: [
      { movement_types: [0, 3], directions: ["rtl"] },
      { movement_types: [1], directions: ["ltr"] },
    ],
    target_locations: ["E", "SE", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "frontal",
    sublobe: "orbitofrontal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0, 3], directions: ["rtl"] },
      { movement_types: [1], directions: ["ltr"] },
    ],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "parietal",
    sublobe: "parietal_main",
    bg_temperature: "warm",
    bg_types: ["textured"],
    motion: [{ movement_types: [0], directions: ["rtl", "trdbl"] }],
    target_locations: ["E", "SE", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "parietal",
    sublobe: "superior_parietal",
    bg_temperature: "warm",
    bg_types: ["textured"],
    motion: [{ movement_types: [0], directions: ["rtl", "trdbl"] }],
    target_locations: ["E", "SE", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "superior_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["rtl", "trdbl"] }],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "middle_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["rtl", "trdbl"] }],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "inferior_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [{ movement_types: [0], directions: ["rtl", "trdbl"] }],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "pons",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 3], directions: ["rtl"] },
      { movement_types: [1], directions: ["ltr"] },
    ],
    target_locations: ["E", "SE", "NE"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "mesencephalon",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [{ movement_types: [0, 1], directions: ["btt"] }],
    target_locations: ["E", "N", "S"],
    rotation: "ccw",
  },
];
