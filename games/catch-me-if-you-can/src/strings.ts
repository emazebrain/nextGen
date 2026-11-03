/** Child-facing text: one short sentence, ≤ 12 words (design doc §8.1). */
export const PRAISE_COUNT = 14;
export const LEVEL_UP_COUNT = 5;
function praise(lines: string[]): Record<string, string> {
  if (lines.length !== PRAISE_COUNT) throw new Error("praise lines");
  return Object.fromEntries(lines.map((l, i) => [`praise.${i}`, l]));
}
function levelUp(lines: string[]): Record<string, string> {
  if (lines.length !== LEVEL_UP_COUNT) throw new Error("level-up lines");
  return Object.fromEntries(lines.map((l, i) => [`levelup.${i}`, l]));
}

export const strings = {
  en: {
    "instructions.title": "Catch Me If You Can",
    "instructions.text": "Find the tile that looks a little different.",
    "instructions.dual": "Some rounds have two boards. Find the different tile in each.",
    // Praise for effort and attention, never for being clever (design doc §11.6, ADR 0009).
    ...praise([
      "You found it!", "Nice focus!", "Great searching!", "You spotted it!", "Careful looking!", "That's it!", "Good eye!",
      "You kept looking!", "Well found!", "Steady and sure!", "Nice and careful!", "Another one!", "Super searching!", "Way to go!",
    ]),
    "levelup.title": "Level {level}!",
    ...levelUp([
      "You kept trying, and it worked.", "Great focus. On to the next one.", "Each board is a little trickier now.",
      "You're finding smaller differences.", "Careful looking pays off.",
    ]),
  },
  he: {
    "instructions.title": "תפסו אותי אם תוכלו",
    "instructions.text": "מצאו את המשבצת שנראית קצת אחרת.",
    "instructions.dual": "בחלק מהסבבים יש שני לוחות. מצאו את המשבצת השונה בכל אחד.",
    ...praise([
      "מצאת!", "איזה ריכוז!", "חיפוש מצוין!", "שמת לב!", "הסתכלת בעיון!", "בדיוק!", "עין טובה!",
      "המשכת לחפש!", "יפה מאוד!", "בביטחון ובדיוק!", "בזהירות ובדיוק!", "עוד אחת!", "חיפוש נהדר!", "כל הכבוד!",
    ]),
    "levelup.title": "שלב {level}!",
    ...levelUp([
      "המשכת לנסות, וזה עבד.", "ריכוז מצוין. ממשיכים הלאה.", "כל לוח עכשיו קצת יותר מאתגר.",
      "מוצאים הבדלים קטנים יותר ויותר.", "הסתכלות זהירה משתלמת.",
    ]),
  },
};
