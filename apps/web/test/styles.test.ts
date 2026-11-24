/** Every `var(--name)` used in the stylesheets must be defined somewhere, or the rule silently does nothing. */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Tests run from apps/web.
const root = join(process.cwd(), "../..");
const walk = (dir: string, ext: RegExp, out: string[] = []): string[] => {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith("dist")) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, ext, out);
    else if (ext.test(name)) out.push(p);
  }
  return out;
};

describe("stylesheets", () => {
  it("use only custom properties that are defined", () => {
    const dirs = [join(root, "apps/web/src"), join(root, "packages/ui/src")];
    const css = dirs.flatMap((d) => walk(d, /\.css$/));
    const code = dirs.flatMap((d) => walk(d, /\.tsx?$/));
    const defined = new Set<string>();
    for (const f of css) for (const m of readFileSync(f, "utf8").matchAll(/(--[\w-]+)\s*:/g)) defined.add(m[1]!);
    // Properties set from code: style={{ "--tone": … }} or style.setProperty("--x", …)
    for (const f of code) for (const m of readFileSync(f, "utf8").matchAll(/["'`](--[\w-]+)["'`]/g)) defined.add(m[1]!);
    const missing = new Map<string, string>();
    for (const f of css) {
      // A use with a fallback, var(--x, value), is allowed to be undefined.
      for (const m of readFileSync(f, "utf8").matchAll(/var\(\s*(--[\w-]+)\s*\)/g)) {
        if (!defined.has(m[1]!)) missing.set(m[1]!, f.slice(root.length));
      }
    }
    expect([...missing].map(([name, file]) => `${name} (${file})`)).toEqual([]);
  });
});
