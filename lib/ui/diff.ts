// Tiny HTML pretty-printer and line diff for the fix cards. HtmlPatch strings are short outer-HTML
// snippets, so an O(n*m) LCS is plenty.

export type DiffKind = "ctx" | "add" | "del";

export interface DiffLine {
  kind: DiffKind;
  text: string;
}

const VOID_TAGS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);

interface Tok {
  type: "open" | "close" | "self" | "text";
  raw: string;
  name?: string;
}

function tokenize(html: string): Tok[] {
  const out: Tok[] = [];
  for (const part of html.split(/(<[^>]+>)/g)) {
    if (!part) continue;
    if (part.startsWith("<")) {
      if (part.startsWith("</")) out.push({ type: "close", raw: part, name: part.slice(2, -1).trim().toLowerCase() });
      else {
        const name = /^<\s*([a-zA-Z][\w:-]*)/.exec(part)?.[1]?.toLowerCase();
        const selfClosing = part.endsWith("/>") || (name !== undefined && VOID_TAGS.has(name)) || part.startsWith("<!");
        out.push({ type: selfClosing ? "self" : "open", raw: part, name });
      }
    } else {
      const text = part.replace(/\s+/g, " ").trim();
      if (text) out.push({ type: "text", raw: text });
    }
  }
  return out;
}

/** One tag per line, indented by nesting, with `<tag>text</tag>` kept on one line. */
export function prettyHtml(html: string): string[] {
  const src = html.trim();
  if (!src) return [];
  if (src.includes("\n")) {
    const lines = html
      .replace(/^(\s*\r?\n)+/, "")
      .trimEnd()
      .split(/\r?\n/)
      .map((l) => l.replace(/\s+$/, ""));
    const indents = lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length);
    const base = indents.length ? Math.min(...indents) : 0;
    return lines.map((l) => l.slice(base));
  }
  const toks = tokenize(src);
  const lines: string[] = [];
  let depth = 0;
  const pad = () => "  ".repeat(Math.max(depth, 0));
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i];
    if (t.type === "open") {
      const n1 = toks[i + 1];
      const n2 = toks[i + 2];
      if (n1?.type === "text" && n2?.type === "close" && n2.name === t.name) {
        lines.push(`${pad()}${t.raw}${n1.raw}${n2.raw}`);
        i += 2;
        continue;
      }
      if (n1?.type === "close" && n1.name === t.name) {
        lines.push(`${pad()}${t.raw}${n1.raw}`);
        i += 1;
        continue;
      }
      lines.push(`${pad()}${t.raw}`);
      depth++;
    } else if (t.type === "close") {
      depth--;
      lines.push(`${pad()}${t.raw}`);
    } else {
      lines.push(`${pad()}${t.raw}`);
    }
  }
  return lines;
}

/** Line diff between two arrays of lines (longest common subsequence). */
export function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  const n = before.length;
  const m = after.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] = before[i] === after[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ kind: "ctx", text: before[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "del", text: before[i++] });
    } else {
      out.push({ kind: "add", text: after[j++] });
    }
  }
  while (i < n) out.push({ kind: "del", text: before[i++] });
  while (j < m) out.push({ kind: "add", text: after[j++] });
  return out;
}

/** Diff two HTML snippets: pretty-print both, then diff the lines. */
export function diffHtml(before: string, after: string): DiffLine[] {
  return diffLines(prettyHtml(before), prettyHtml(after));
}
