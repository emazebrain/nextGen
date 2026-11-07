/** A protocol's steps in one line, with arrows along the reading direction (RTL: ←). CLAUDE.md invariant 10. */
export function joinSteps(parts: string[], locale: string): string {
  const rtl = ["he", "ar"].includes(locale);
  return parts.join(rtl ? " ← " : " → ");
}
