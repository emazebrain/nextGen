/** A protocol's steps in one line, with arrows along the reading direction (RTL: ←). CLAUDE.md invariant 10. */
export function joinSteps(parts: string[], locale: string): string {
  const rtl = ["he", "ar"].includes(locale);
  return parts.join(rtl ? " ← " : " → ");
}

/** "A, A, B" becomes "A ×2, B": a step played twice in a row reads as one line item, not as a repeat of itself. */
export function collapseRepeats(parts: string[]): string[] {
  const out: Array<{ name: string; n: number }> = [];
  for (const name of parts) {
    const last = out[out.length - 1];
    if (last && last.name === name) last.n += 1;
    else out.push({ name, n: 1 });
  }
  return out.map((o) => (o.n > 1 ? `${o.name} ×${o.n}` : o.name));
}
