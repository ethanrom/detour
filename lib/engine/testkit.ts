// Fixture builders for engine tests (built with the shared PageModel builder). Test-only.

import { buildPage, type Spec } from "@/fixtures/pagemodels/builder";
import { expect } from "vitest";
import type { PageModel, PersonaId, PersonaResult, StrategyResult, Task, TaskResult } from "@/lib/contracts";

const WORDS = ["alpha", "bravo", "delta", "echo", "foxtrot", "gamma", "hotel", "india", "kilo", "lima", "metro", "nova", "oscar", "papa", "quebec", "romeo"];

export function words(seed: number, count: number): string {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(WORDS[(seed * 7 + i * 5) % WORDS.length]);
  return out.join(" ");
}

export interface LongPageOptions {
  /** Links in the navigation block (default 24). */
  navLinks?: number;
  /** Content sections after the nav (default 6). */
  sections?: number;
  /** Add a "Skip to main content" link as the very first element. */
  skipLink?: boolean;
  /** Footer links (default 0). */
  footerLinks?: number;
  /** Expose section titles as real headings (default true). */
  headings?: boolean;
  /** Make the nav a navigation landmark (default true). */
  navLandmark?: boolean;
}

export interface LongPage {
  page: PageModel;
  /** Section i has a title (heading or plain div), a paragraph and a button `buy-i`. */
  buy: (i: number) => string;
  para: (i: number) => string;
  title: (i: number) => string;
  task: (steps: Task["steps"], id?: string) => Task;
}

/** A generic page: [skip link] + nav + N sections + footer. Every id is stable and predictable. */
export function longPage(o: LongPageOptions = {}): LongPage {
  const navLinks = o.navLinks ?? 24;
  const sections = o.sections ?? 6;
  const footerLinks = o.footerLinks ?? 0;
  const useHeadings = o.headings ?? true;
  const kids: Spec[] = [];
  if (o.skipLink) {
    kids.push({ id: "skip", role: "link", name: "Skip to main content", tag: "a", href: "main", rect: { x: 0, y: 0, w: 160, h: 30 } });
  }
  const nav: Spec[] = [];
  for (let i = 0; i < navLinks; i++) {
    nav.push({ id: `nav-${i}`, role: "link", name: `Category ${words(i, 1)} ${i}`, tag: "a", rect: { x: 20 + (i % 10) * 120, y: 40 + Math.floor(i / 10) * 30, w: 110, h: 24 } });
  }
  kids.push({
    id: "nav",
    role: "navigation",
    landmark: o.navLandmark === false ? undefined : "navigation",
    tag: "nav",
    stop: false,
    hints: { repetitiveBlock: true },
    children: [{ id: "nav-list", role: "list", tag: "ul", stop: false, children: nav }],
  });
  const main: Spec[] = [];
  for (let i = 0; i < sections; i++) {
    const y = 400 + i * 300;
    main.push(
      useHeadings
        ? { id: `title-${i}`, role: "heading", level: 2, name: `Section ${words(i + 3, 2)} ${i}`, tag: "h2", rect: { x: 40, y, w: 400, h: 36 } }
        : { id: `title-${i}`, role: "generic", name: `Section ${words(i + 3, 2)} ${i}`, tag: "div", rect: { x: 40, y, w: 400, h: 36 } },
      { id: `para-${i}`, role: "paragraph", name: `${words(i, 9)} paragraph number ${i}`, tag: "p", rect: { x: 40, y: y + 50, w: 600, h: 60 } },
      { id: `buy-${i}`, role: "button", name: `Buy item ${i}`, tag: "button", rect: { x: 40, y: y + 130, w: 140, h: 40 } },
    );
  }
  kids.push({ id: "main", role: "generic", tag: "main", stop: false, children: main });
  if (footerLinks > 0) {
    const foot: Spec[] = [];
    for (let i = 0; i < footerLinks; i++) foot.push({ id: `foot-${i}`, role: "link", name: `Footer ${words(i + 5, 1)} ${i}`, tag: "a", rect: { x: 20 + (i % 8) * 140, y: 400 + sections * 300 + Math.floor(i / 8) * 28, w: 130, h: 24 } });
    kids.push({ id: "footer", role: "generic", tag: "footer", stop: false, hints: { repetitiveBlock: true }, children: [{ id: "foot-list", role: "list", tag: "ul", stop: false, children: foot }] });
  }
  const page = buildPage({ id: "root", role: "document", stop: false, children: kids }, { title: "Test page", viewport: { w: 1280, h: 800 } });
  return {
    page,
    buy: (i) => `buy-${i}`,
    para: (i) => `para-${i}`,
    title: (i) => `title-${i}`,
    task: (steps, id = "t") => ({ id, siteId: "test", label: "test task", steps, grounding: "fixture" }),
  };
}

/** Exact TaskResult shape check: no missing and no extra keys, finite numbers. */
export function expectTaskResultShape(r: TaskResult): void {
  expect(Object.keys(r).sort()).toEqual(["explanation", "personas", "taskId"]);
  expect(Object.keys(r.personas).sort()).toEqual(["keyboard", "mouse", "screenreader"]);
  expect(r.explanation.length).toBeGreaterThanOrEqual(2);
  expect(r.explanation.length).toBeLessThanOrEqual(4);
  for (const [persona, p] of Object.entries(r.personas) as Array<[PersonaId, PersonaResult]>) {
    expect(p.persona).toBe(persona);
    expect(Number.isFinite(p.seconds)).toBe(true);
    expect(p.interval).toHaveLength(2);
    expect(p.strategies.map((s) => s.strategy)).toContain(p.representative);
    for (const s of p.strategies) {
      let t = 0;
      let sum = 0;
      for (const step of s.steps) {
        let stepSum = 0;
        for (const e of step.events) {
          expect(e.t).toBeCloseTo(t, 9);
          expect(e.dt).toBeGreaterThanOrEqual(0);
          expect(e.label.length).toBeGreaterThan(0);
          if (e.utterance) expect(e.utterance.seconds).toBeLessThanOrEqual(e.dt + 1e-9);
          t += e.dt;
          stepSum += e.dt;
        }
        expect(step.seconds).toBeCloseTo(stepSum, 9);
        // `commands` counts events, except passive time (reading, hearing the page title).
        const counted = step.commands.reduce((n, c) => n + c.count, 0);
        expect(counted).toBeLessThanOrEqual(step.events.length);
        sum += stepSum;
      }
      expect(s.seconds).toBeCloseTo(sum, 9);
    }
  }
}

/** Total seconds of speech heard along a strategy's trace. */
export function totalSpeechSeconds(s: StrategyResult): number {
  let total = 0;
  for (const st of s.steps) for (const e of st.events) total += e.utterance?.seconds ?? 0;
  return total;
}
