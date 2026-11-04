import { describe, expect, it } from "vitest";
import { PACK_NAMES, PACKS } from "../src/pictures.ts";

/**
 * Each picture is loaded as a standalone image (data: URL), which browsers parse as strict XML: one bad
 * attribute and the image fails to load, leaving a blank tile and a broken tray picture. These checks
 * catch that without a browser.
 */
describe("picture packs", () => {
  it("4 packs × 14 pictures, unique ids", () => {
    expect(PACK_NAMES).toHaveLength(4);
    const ids = PACK_NAMES.flatMap((p) => PACKS[p].map((x) => x.id));
    for (const p of PACK_NAMES) expect(PACKS[p]).toHaveLength(14);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every picture is well-formed SVG: no repeated attributes, every tag closed", () => {
    const problems: string[] = [];
    for (const pack of PACK_NAMES) {
      for (const pic of PACKS[pack]) {
        const where = `${pack}/${pic.id}`;
        if (!pic.svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"') || !pic.svg.endsWith("</svg>")) problems.push(`${where}: not an svg document`);
        for (const [, name, attrs] of pic.svg.matchAll(/<([a-zA-Z]+)((?:\s+[^>]*?)?)\/?>/g)) {
          const names = [...attrs!.matchAll(/([a-zA-Z:-]+)="[^"]*"/g)].map((m) => m[1]!);
          const dup = names.find((n, i) => names.indexOf(n) !== i);
          if (dup) problems.push(`${where}: <${name}> repeats ${dup}`);
          const leftover = attrs!.replace(/([a-zA-Z:-]+)="[^"]*"/g, "").replace(/[\s/]/g, "");
          if (leftover) problems.push(`${where}: <${name}> has a stray "${leftover}"`);
        }
        const opened = (pic.svg.match(/<[a-zA-Z][^>]*[^/]>/g) ?? []).length;
        const closed = (pic.svg.match(/<\/[a-zA-Z]+>/g) ?? []).length;
        if (opened !== closed) problems.push(`${where}: ${opened} open tags, ${closed} closed`);
      }
    }
    expect(problems).toEqual([]);
  });
});
