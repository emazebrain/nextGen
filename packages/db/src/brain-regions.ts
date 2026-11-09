/**
 * The brain-region tree for tagging videos (design doc §7 `brain_region`: hemisphere → lobe → Brodmann area;
 * ADR 0018). v1's Brodmann taxonomy. [Assumption] until a clinical advisor signs off the lobe of each area.
 * The cerebellum is not a Brodmann area but games are mapped to it, so it is a leaf of its own.
 */
export interface Named {
  code: string;
  en: string;
  he: string;
}

export const HEMISPHERES: Named[] = [
  { code: "left", en: "Left hemisphere", he: "ההמיספרה השמאלית" },
  { code: "right", en: "Right hemisphere", he: "ההמיספרה הימנית" },
];

export const LOBES: Named[] = [
  { code: "frontal", en: "Frontal lobe", he: "האונה המצחית" },
  { code: "parietal", en: "Parietal lobe", he: "האונה הקודקודית" },
  { code: "temporal", en: "Temporal lobe", he: "האונה הרקתית" },
  { code: "occipital", en: "Occipital lobe", he: "האונה העורפית" },
  { code: "limbic", en: "Limbic lobe", he: "האונה הלימבית" },
  { code: "insula", en: "Insula", he: "האינסולה" },
  { code: "cerebellum", en: "Cerebellum", he: "המוח הקטן" },
];

const BY_LOBE: Record<string, number[]> = {
  frontal: [4, 6, 8, 9, 10, 11, 12, 44, 45, 46, 47],
  parietal: [1, 2, 3, 5, 7, 39, 40, 43],
  temporal: [20, 21, 22, 37, 38, 41, 42],
  occipital: [17, 18, 19],
  limbic: [23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36],
  insula: [13, 14, 15, 16],
};

export const AREAS: Array<Named & { lobe: string }> = [
  ...Object.entries(BY_LOBE).flatMap(([lobe, nums]) =>
    nums.map((n) => ({ code: `ba${n}`, lobe, en: `Brodmann area ${n} (BA${n})`, he: `אזור ברודמן ${n} (BA${n})` })),
  ),
  { code: "cerebellum", lobe: "cerebellum", en: "Cerebellum", he: "המוח הקטן" },
];

const q = (s: string) => `'${s.replaceAll("'", "''")}'`;
const labels = (n: Named) => `jsonb_build_object('en', ${q(n.en)}, 'he', ${q(n.he)})`;

/** The INSERTs that seed the tree (pasted into migration 0010; the test checks the counts match). */
export function regionSeedSql(): string {
  const out: string[] = [];
  HEMISPHERES.forEach((h, hi) => {
    out.push(`INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) VALUES ('hemisphere', ${q(h.code)}, ${q(h.code)}, NULL, ${labels(h)}, ${hi + 1});`);
    LOBES.forEach((l, li) => {
      const lp = `${h.code}.${l.code}`;
      out.push(
        `INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', ${q(l.code)}, ${q(lp)}, id, ${labels(l)}, ${li + 1} FROM app.brain_region WHERE path = ${q(h.code)};`,
      );
      AREAS.filter((a) => a.lobe === l.code).forEach((a, ai) => {
        out.push(
          `INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'area', ${q(a.code)}, ${q(`${lp}.${a.code}`)}, id, ${labels(a)}, ${ai + 1} FROM app.brain_region WHERE path = ${q(lp)};`,
        );
      });
    });
  });
  return out.join("\n");
}

// ---------------------------------------------------------------- brain-region filters (spec 2026-11-09, migration 0018)

/** The product owner's table groups pons, mesencephalon and cerebellum under a "Subcortical" lobe. */
export const SUBCORTICAL: Named = { code: "subcortical", en: "Subcortical", he: "תת-קליפתי" };

/** Sub-lobes from the product owner's table (Hebrew labels are a draft for clinical review). */
export const SUBLOBES: Array<Named & { lobe: string }> = [
  { code: "dlpfc", lobe: "frontal", en: "DLPFC (dorsolateral prefrontal)", he: "DLPFC (קדם-מצחי גבי-צדי)" },
  { code: "orbitofrontal", lobe: "frontal", en: "Orbitofrontal", he: "אורביטו-פרונטלי" },
  { code: "parietal_main", lobe: "parietal", en: "Parietal", he: "קודקודי" },
  { code: "superior_parietal", lobe: "parietal", en: "Superior parietal", he: "קודקודי עליון" },
  { code: "superior_temporal", lobe: "temporal", en: "Superior temporal", he: "רקתי עליון" },
  { code: "middle_temporal", lobe: "temporal", en: "Middle temporal", he: "רקתי אמצעי" },
  { code: "inferior_temporal", lobe: "temporal", en: "Inferior temporal", he: "רקתי תחתון" },
  { code: "pons", lobe: "subcortical", en: "Pons", he: "גשר המוח (פונס)" },
  { code: "mesencephalon", lobe: "subcortical", en: "Mesencephalon (midbrain)", he: "המוח התיכון" },
  { code: "cerebellum", lobe: "subcortical", en: "Cerebellum", he: "המוח הקטן" },
];

/** Each Brodmann area's sub-lobe (draft, pending the clinical advisor). Areas not listed have none. */
export const AREA_SUBLOBE: Record<string, string> = {
  ba9: "dlpfc", ba46: "dlpfc",
  ba11: "orbitofrontal", ba12: "orbitofrontal", ba47: "orbitofrontal",
  ba1: "parietal_main", ba2: "parietal_main", ba3: "parietal_main", ba39: "parietal_main", ba40: "parietal_main", ba43: "parietal_main",
  ba5: "superior_parietal", ba7: "superior_parietal",
  ba22: "superior_temporal", ba41: "superior_temporal", ba42: "superior_temporal",
  ba21: "middle_temporal",
  ba20: "inferior_temporal", ba37: "inferior_temporal",
};

/** The statements migration 0018 runs to add the subcortical lobe, the sub-lobes and the area links. */
export function regionExpandSql(): string {
  const out: string[] = [];
  for (const h of HEMISPHERES) {
    out.push(
      `INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'lobe', 'subcortical', ${q(`${h.code}.subcortical`)}, id, ${labels(SUBCORTICAL)}, ${LOBES.length + 1} FROM app.brain_region WHERE path = ${q(h.code)};`,
    );
    SUBLOBES.forEach((s, i) => {
      const lp = `${h.code}.${s.lobe}`;
      out.push(
        `INSERT INTO app.brain_region (kind, code, path, parent_id, labels, sort) SELECT 'sublobe', ${q(s.code)}, ${q(`${lp}.${s.code}`)}, id, ${labels(s)}, ${100 + i} FROM app.brain_region WHERE path = ${q(lp)};`,
      );
    });
    for (const [ba, sub] of Object.entries(AREA_SUBLOBE)) {
      const lobe = AREAS.find((a) => a.code === ba)!.lobe;
      out.push(
        `UPDATE app.brain_region a SET sublobe_id = s.id FROM app.brain_region s WHERE a.path = ${q(`${h.code}.${lobe}.${ba}`)} AND s.path = ${q(`${h.code}.${lobe}.${sub}`)};`,
      );
    }
  }
  return out.join("\n");
}
