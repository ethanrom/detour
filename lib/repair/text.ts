// Small text helpers shared by the heading and label proposers.

export function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Splits "sizeMaximum" into "size Maximum" (extracted names can join adjacent blocks without a space). */
export function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2");
}

export function wordsOf(s: string): string[] {
  const t = collapse(s);
  return t ? t.split(" ") : [];
}

export function titleCase(s: string): string {
  return wordsOf(s)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Strips wrapping quotes and trailing sentence punctuation the model likes to add. */
export function stripDecoration(s: string): string {
  return collapse(s)
    .replace(/^["'“”‘’`]+/, "")
    .replace(/["'“”‘’`]+$/, "")
    .replace(/[.:;,!]+$/, "")
    .trim();
}

export function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}
