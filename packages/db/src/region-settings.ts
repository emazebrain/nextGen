/**
 * The product owner's brain-region settings table (spec 2026-11-09-brain-region-filters-design.md), as typed data.
 * Source: `region-settings.csv` next to this file (values as given). `REGION_SETTINGS` must equal
 * `parseSettingsCsv(<the CSV>)`; a test checks it. The first table (migration 0018) is kept as
 * `region-settings.0018.csv` / `REGION_SETTINGS_0018`. To apply a correction: edit the CSV, update REGION_SETTINGS to
 * match, and ship a migration that updates the changed rows and bumps their revision (see `settingRevisionSql`).
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
  // The table of 2026-11-27 (names as typed there).
  "bainstem - pons": "pons",
  "brainstem - pons": "pons",
  "brainstem - mesencephalon": "mesencephalon",
  "basal ganglia - direct": "basal_ganglia_direct",
  "basal ganglia - indirect": "basal_ganglia_indirect",
  // The same sub-lobe as "Superior Parietal" in the first table (BA5, BA7); renamed in the sheet, open question.
  inferiorparietal: "superior_parietal",
  "inferior parietal": "superior_parietal",
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

/** The first table, as migration 0018 seeded it (region-settings.0018.csv). Kept so that migration stays checkable. */
export const REGION_SETTINGS_0018: SettingRow[] = [
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

/**
 * The table as it stands: the product owner's sheet of 2026-11-27 with the same day's correction to the left
 * basal ganglia and the spreadsheet sent later that day, brain_region_new_platform.xlsx (region-settings.csv),
 * applied by migrations 0044, 0045 and 0046. In the spreadsheet Excel shows the movement type "1, 4" as a date
 * (4 January); it is read as 1, 4.
 *
 * One deviation from the sheet as typed, pending the owner's confirmation: it gives the left direct
 * pathway "LTR, TRDBL" for intervals and "RTL, BLDTR" for continuous movement. TRDBL heads left and BLDTR heads
 * right, so as typed both diagonals break the owner's own rule for a left-hemisphere row (continuous heads left,
 * intervals head right). The two diagonals are stored the other way round — intervals LTR, BLDTR; continuous RTL,
 * TRDBL — which is what the sheet's own left DLPFC, left orbitofrontal and right cerebellum rows have.
 *
 * Generated from the CSV with parseSettingsCsv; kept in step by test/region-data.test.ts. The sheet has no
 * background-type column: each sub-lobe keeps the type it had, and the new basal-ganglia rows take both, like the
 * other subcortical rows.
 */
export const REGION_SETTINGS: SettingRow[] = [
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "cerebellum",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 3], directions: ["tldbr"] },
      { movement_types: [1, 4], directions: ["brdtl"] },
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
      { movement_types: [1, 4], directions: ["rtl", "brdtl"] },
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
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [1, 4], directions: ["rtl", "brdtl"] },
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
    motion: [
      { movement_types: [0], directions: ["ltr", "tldbr"] },
    ],
    target_locations: ["W", "SW", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "parietal",
    sublobe: "superior_parietal",
    bg_temperature: "cold",
    bg_types: ["textured"],
    motion: [
      { movement_types: [0], directions: ["ltr", "tldbr"] },
    ],
    target_locations: ["W", "SW", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "superior_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["ltr", "tldbr"] },
    ],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "middle_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["ltr", "tldbr"] },
    ],
    target_locations: ["W", "NW", "N"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "temporal",
    sublobe: "inferior_temporal",
    bg_temperature: "cold",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["ltr", "tldbr"] },
    ],
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
      { movement_types: [1, 4], directions: ["rtl"] },
    ],
    target_locations: ["W", "SW", "NW"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "basal_ganglia_direct",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [1, 4], directions: ["rtl", "brdtl"] },
      { movement_types: [0, 3], directions: ["ltr", "tldbr"] },
      { movement_types: [0, 1], directions: ["ttb"] },
    ],
    target_locations: ["W", "SW", "NW", "N", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "basal_ganglia_indirect",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [1], directions: ["rtl", "brdtl"] },
      { movement_types: [1], directions: ["ttb"] },
    ],
    target_locations: ["W", "SW", "NW", "N", "S"],
    rotation: "cw",
  },
  {
    side: "right",
    lobe: "subcortical",
    sublobe: "mesencephalon",
    bg_temperature: "cold",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 1], directions: ["ttb"] },
    ],
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
      { movement_types: [1, 4], directions: ["bldtr"] },
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
      { movement_types: [0, 3], directions: ["rtl", "trdbl"] },
      { movement_types: [1, 4], directions: ["ltr", "bldtr"] },
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
      { movement_types: [0, 3], directions: ["rtl", "trdbl"] },
      { movement_types: [1, 4], directions: ["ltr", "bldtr"] },
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
    motion: [
      { movement_types: [0], directions: ["rtl", "trdbl"] },
    ],
    target_locations: ["E", "SE", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "parietal",
    sublobe: "superior_parietal",
    bg_temperature: "warm",
    bg_types: ["textured"],
    motion: [
      { movement_types: [0], directions: ["rtl", "trdbl"] },
    ],
    target_locations: ["E", "SE", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "superior_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["rtl", "trdbl"] },
    ],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "middle_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["rtl", "trdbl"] },
    ],
    target_locations: ["E", "NE", "N"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "temporal",
    sublobe: "inferior_temporal",
    bg_temperature: "warm",
    bg_types: ["solid"],
    motion: [
      { movement_types: [0], directions: ["rtl", "trdbl"] },
    ],
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
      { movement_types: [1, 4], directions: ["ltr"] },
    ],
    target_locations: ["E", "SE", "NE"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "basal_ganglia_direct",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [1, 4], directions: ["ltr", "bldtr"] },
      { movement_types: [0, 3], directions: ["rtl", "trdbl"] },
      { movement_types: [0, 1], directions: ["btt"] },
    ],
    target_locations: ["E", "SE", "NE", "N", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "basal_ganglia_indirect",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [1], directions: ["ltr", "tldbr"] },
      { movement_types: [1], directions: ["btt"] },
    ],
    target_locations: ["E", "SE", "NE", "N", "S"],
    rotation: "ccw",
  },
  {
    side: "left",
    lobe: "subcortical",
    sublobe: "mesencephalon",
    bg_temperature: "warm",
    bg_types: ["textured", "solid"],
    motion: [
      { movement_types: [0, 1], directions: ["btt"] },
    ],
    target_locations: ["E", "N", "S"],
    rotation: "ccw",
  },
];

/** The table as migration 0045 left it: before the sheet of 2026-11-27 (xlsx) added diagonals to the left frontal rows. */
export const REGION_SETTINGS_0045: SettingRow[] = REGION_SETTINGS.map((r) =>
  r.side === "left" && r.lobe === "frontal"
    ? { ...r, motion: [{ movement_types: [0, 3], directions: ["rtl"] }, { movement_types: [1, 4], directions: ["ltr"] }] }
    : r,
);

/** The table as migration 0044 left it: before the correction to the left basal ganglia's direct pathway. */
export const REGION_SETTINGS_0044: SettingRow[] = REGION_SETTINGS_0045.map((r) =>
  r.side === "left" && r.sublobe === "basal_ganglia_direct"
    ? { ...r, motion: [{ movement_types: [1, 4], directions: ["ltr", "tldbr"] }, { movement_types: [0, 3], directions: ["rtl", "brdtl"] }, { movement_types: [0, 1], directions: ["btt"] }] }
    : r,
);

const same = (a: SettingRow, b: SettingRow) => JSON.stringify(a) === JSON.stringify(b);

/**
 * The statements migration 0044 runs to bring `app.region_setting` from the first table to today's: a changed row
 * is replaced, goes back to draft and has its revision bumped (launches record the revision they ran with); a new
 * sub-lobe's row is inserted. Rows that did not change are left alone.
 */
export function settingRevisionSql(before: SettingRow[], after: SettingRow[]): string {
  const out: string[] = [];
  for (const r of after) {
    const path = `${r.side}.${r.lobe}.${r.sublobe}`;
    const old = before.find((o) => o.side === r.side && o.sublobe === r.sublobe);
    if (!old) out.push(settingSeedSql([r]));
    else if (!same(old, r))
      out.push(
        `UPDATE app.region_setting s SET bg_temperature = ${q(r.bg_temperature)}, bg_types = ${arr(r.bg_types)}, motion = ${q(JSON.stringify(r.motion))}::jsonb, target_locations = ${arr(r.target_locations)}, rotation = ${q(r.rotation)}, clinical_status = 'draft', revision = s.revision + 1, updated_at = now() FROM app.brain_region b WHERE b.id = s.sublobe_id AND b.path = ${q(path)};`,
      );
  }
  return out.join("\n");
}
