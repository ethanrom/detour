import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { LITERATURE, type Range } from "./literature";

interface Row {
  label: string;
  range: Range;
}

const ROWS: Row[] = [
  { label: "K  keystroke (navigation key)", range: LITERATURE.klm.K },
  { label: "B  mouse button press or release", range: LITERATURE.klm.B },
  { label: "M  mental preparation", range: LITERATURE.klm.M },
  { label: "H  homing keyboard / mouse", range: LITERATURE.klm.H },
  { label: "P  pointing (no layout)", range: LITERATURE.klm.P },
  { label: "Fitts intercept a", range: LITERATURE.fitts.mouse.a },
  { label: "Fitts slope b", range: LITERATURE.fitts.mouse.b },
  { label: "Silent reading speed", range: LITERATURE.reading.wpm },
  { label: "Screen-reader speech rate", range: LITERATURE.speech.wpm },
  { label: "Listen fraction (non-targets)", range: LITERATURE.speech.listenFraction },
  { label: "Typing, seconds per character", range: LITERATURE.typing.charSeconds },
  { label: "Scroll, seconds per viewport", range: LITERATURE.scroll.secondsPerViewport },
  { label: "Keyboard motor factor (x K)", range: LITERATURE.keyboardMotorFactor },
];

const fmt = (n: number) => String(Number(n.toFixed(4)));

/** Markdown for section 11 of docs/MODEL.md, generated from LITERATURE. */
export function parameterBlock(): string {
  const lines: string[] = [];
  lines.push("| Parameter | Nominal | Range (low to high) | Dist. | Unit | Source |");
  lines.push("|---|---|---|---|---|---|");
  for (const { label, range: r } of ROWS) {
    lines.push(`| ${label} | ${fmt(r.value)} | ${fmt(r.low)} to ${fmt(r.high)} | ${r.dist} | ${r.unit} | ${r.source} |`);
  }
  const s = LITERATURE.screenReaderStrategies;
  const weights = (["headings", "find", "linear", "landmarks", "tab"] as const).map((k) => `${k} ${fmt(s[k])}`).join(", ");
  lines.push(`| Screen-reader strategy weights | ${weights} | fixed | - | share | ${s.source} |`);
  lines.push("");
  lines.push("Notes on individual parameters:");
  lines.push("");
  for (const { label, range: r } of ROWS) if (r.note) lines.push(`- **${label}.** ${r.note}`);
  return lines.join("\n");
}

const BEGIN = "<!-- BEGIN:parameter-table -->";
const END = "<!-- END:parameter-table -->";
const MODEL_MD = fileURLToPath(new URL("../../docs/MODEL.md", import.meta.url));

describe("LITERATURE", () => {
  it.each(ROWS.map((r) => [r.label, r.range] as const))("%s is a well-formed, sourced range", (_label, r) => {
    expect(Number.isFinite(r.value) && Number.isFinite(r.low) && Number.isFinite(r.high)).toBe(true);
    expect(r.low).toBeLessThanOrEqual(r.value);
    expect(r.value).toBeLessThanOrEqual(r.high);
    expect(r.low).toBeGreaterThan(0);
    expect(r.source.length).toBeGreaterThan(20);
    expect(r.source).not.toMatch(/TODO/i);
    expect(r.note ?? "").not.toMatch(/TODO/i);
    expect(r.unit.length).toBeGreaterThan(0);
    expect(["uniform", "triangular", "lognormal"]).toContain(r.dist);
  });

  it("strategy weights are non-negative, sum to 1 and are sourced", () => {
    const s = LITERATURE.screenReaderStrategies;
    const w = [s.headings, s.find, s.linear, s.landmarks, s.tab];
    for (const x of w) expect(x).toBeGreaterThanOrEqual(0);
    expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(s.source).not.toMatch(/TODO/i);
    expect(s.source).toContain("WebAIM");
  });

  it("strategy weights are the WebAIM Survey #10 response counts over 1511", () => {
    const s = LITERATURE.screenReaderStrategies;
    expect(s.headings).toBeCloseTo(1082 / 1511, 12);
    expect(s.find).toBeCloseTo(205 / 1511, 12);
    expect(s.linear).toBeCloseTo(96 / 1511, 12);
    expect(s.tab).toBeCloseTo(72 / 1511, 12);
    expect(s.landmarks).toBeCloseTo(56 / 1511, 12);
  });

  it("keeps the nominal point estimate inside the plausible ranges that matter for ordering", () => {
    // Speech must be faster than sighted silent reading for experienced users, and slower than the
    // maximum comprehensible rates; a regression here usually means a unit slip.
    expect(LITERATURE.speech.wpm.value).toBeGreaterThan(LITERATURE.reading.wpm.value);
    expect(LITERATURE.klm.B.value).toBeLessThan(LITERATURE.klm.K.value);
    expect(LITERATURE.speech.listenFraction.high).toBeLessThanOrEqual(1);
  });

  it("docs/MODEL.md parameter table matches LITERATURE (run with UPDATE_MODEL_MD=1 to regenerate)", () => {
    const doc = readFileSync(MODEL_MD, "utf8");
    const start = doc.indexOf(BEGIN);
    const end = doc.indexOf(END);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const fresh = `${BEGIN}\n${parameterBlock()}\n${END}`;
    if (process.env.UPDATE_MODEL_MD === "1") {
      writeFileSync(MODEL_MD, doc.slice(0, start) + fresh + doc.slice(end + END.length));
      return;
    }
    expect(doc.slice(start, end + END.length)).toBe(fresh);
  });
});
