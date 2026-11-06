// Regenerates fixtures/results/*.json  (run: node fixtures/results/generate.mjs)
//
// These fixtures stand in for the real engine while the UI is built. They are NOT engine output:
// a tiny hand-calibrated simulator walks a hand-described page with the same cost ingredients the
// real model uses (KLM operators, Fitts's law, K + speech per screen-reader stop), so every trace is
// internally consistent (event times add up, the mixture equals the weighted strategy seconds) and
// the shapes match lib/contracts exactly. The UI shows a "Sample data" badge whenever they are used.

import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = dirname(fileURLToPath(import.meta.url));

// ---------- Parameters (nominal values from lib/params/literature.ts) ----------
const K = 0.28; // keystroke
const THINK = 1.35; // KLM M
const REORIENT = 0.6; // short M between steps
const HOME = 0.4; // KLM H
const B2 = 0.2; // click = 2B
const FITTS_A = 0.1;
const FITTS_B = 0.15;
const WPM = 300; // screen reader speech
const LISTEN = 0.5; // share of a non-target announcement heard
const READ_WPM = 238;
const SCROLL = 0.8; // seconds per viewport
const VIEWPORT_H = 800;
const PENALTY = 300;

const r2 = (x) => Math.round(x * 100) / 100;
const words = (t) => t.replace(/[,.;:!?()"“”]/g, " ").trim().split(/\s+/).filter(Boolean).length;
const speech = (t) => words(t) / (WPM / 60);

class Tr {
  constructor() {
    this.t = 0;
    this.events = [];
  }
  add(command, dt, label, nodeId = null, utterance) {
    const d = r2(dt);
    const e = { t: r2(this.t), dt: d, command, nodeId, label };
    if (utterance) e.utterance = utterance;
    this.events.push(e);
    this.t = r2(this.t + d);
    return e;
  }
}

function say(tr, stop, command, { target = false, prefix } = {}) {
  const full = speech(stop.say);
  const listen = target ? full : full * LISTEN;
  const u = { nodeId: stop.id, text: stop.say, seconds: r2(listen), truncated: !target };
  tr.add(command, K + listen, `${prefix ?? KEY[command]} → ${stop.say}`, stop.id, u);
}

const KEY = { next: "Next", prev: "Previous", tab: "Tab", nextHeading: "H", activate: "Enter" };

function slice(tr, from, stepIndex, target) {
  const events = tr.events.slice(from);
  const counts = new Map();
  for (const e of events) counts.set(e.command, (counts.get(e.command) ?? 0) + 1);
  return {
    stepIndex,
    target,
    seconds: r2(events.reduce((s, e) => s + e.dt, 0)),
    commands: [...counts].map(([command, count]) => ({ command, count })),
    events,
  };
}

// ---------- Screen reader ----------
function srStrategy(strategy, stops, task, f) {
  const tr = new Tr();
  const steps = [];
  const idx = (id) => stops.findIndex((s) => s.id === id);
  const mainStart = stops.findIndex((s) => s.mainStart);
  const skipIdx = stops.findIndex((s) => s.skip);
  let pos = -1;
  let blocked;
  let headingsFailed = false;

  const walk = (to, finalTarget) => {
    const dir = to >= pos ? 1 : -1;
    while (pos !== to) {
      pos += dir;
      say(tr, stops[pos], dir > 0 ? "next" : "prev", { target: finalTarget && pos === to });
    }
  };
  const viaSkip = (ti) => {
    if (skipIdx >= 0 && pos < mainStart && ti >= mainStart) {
      walk(skipIdx, false);
      const landing = stops[mainStart];
      const text = `main landmark, ${landing.say}`;
      tr.add("activate", K + speech(text) * LISTEN, `Enter → jumps to ${text}`, landing.id, {
        nodeId: landing.id,
        text,
        seconds: r2(speech(text) * LISTEN),
        truncated: true,
      });
      pos = mainStart;
    }
  };

  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const from = tr.events.length;
    const ti = idx(step.target);
    const target = stops[ti];
    tr.add("think", si === 0 ? 0.8 : REORIENT, si === 0 ? "Listen to the page, decide where to go" : "Decide the next move");

    if (target.blockSr) {
      // The target is reached but cannot be recognised: the lane stops here.
      if (strategy === "tab") {
        const focusables = stops.map((s, i) => [s, i]).filter(([s]) => s.focusable);
        for (const [s, i] of focusables) {
          if (i > ti) break;
          pos = i;
          say(tr, s, "tab");
        }
      } else if (strategy === "headings") {
        failHeading(tr, stops);
        viaSkip(ti);
        walk(ti, false);
      } else if (strategy === "find") {
        findEvents(tr, stops, step, task, si, "cart");
        walk(ti, false);
      } else {
        viaSkip(ti);
        walk(ti, false);
      }
      tr.add("think", 1.0, `Hears just “${target.say}” and cannot tell what it is`, target.id);
      blocked = { stepIndex: si, reason: target.blockSr };
      steps.push(slice(tr, from, si, step.target));
      break;
    }

    if (strategy === "tab") {
      if (!target.focusable) {
        blocked = { stepIndex: si, reason: target.blockKb ?? `${target.say} is not focusable.` };
        // Tab through everything that is focusable, past where the target would be.
        const order = stops.map((s, i) => [s, i]).filter(([s]) => s.focusable);
        let passed = false;
        for (const [s, i] of order) {
          if (i < pos + 1 && pos >= 0) continue;
          say(tr, s, "tab");
          if (i > ti) {
            passed = true;
            break;
          }
        }
        if (!passed) tr.add("think", 1.0, "Reaches the end without finding it");
        steps.push(slice(tr, from, si, step.target));
        break;
      }
      // Skip link first, if there is one.
      if (skipIdx >= 0 && pos < mainStart && ti >= mainStart) {
        pos = skipIdx;
        say(tr, stops[skipIdx], "tab");
        const landing = stops[mainStart];
        const text = `main landmark, ${landing.say}`;
        tr.add("activate", K + speech(text) * LISTEN, `Enter → jumps to ${text}`, landing.id, {
          nodeId: landing.id,
          text,
          seconds: r2(speech(text) * LISTEN),
          truncated: true,
        });
        pos = mainStart - 0.5;
      }
      const order = stops.map((s, i) => [s, i]).filter(([s]) => s.focusable);
      for (const [s, i] of order) {
        if (i <= pos) continue;
        if (i > ti) break;
        pos = i;
        say(tr, s, "tab", { target: i === ti });
        if (i === ti) break;
      }
    } else if (strategy === "headings") {
      const heads = stops.map((s, i) => [s, i]).filter(([s]) => s.heading);
      const before = heads.filter(([, i]) => i > pos && i <= ti);
      if (!heads.length) {
        if (!headingsFailed) failHeading(tr, stops);
        headingsFailed = true;
        viaSkip(ti);
        walk(ti, true);
      } else if (!before.length && pos < 0) {
        // Headings exist but only past the target: the first H overshoots, so go back to the top.
        const [h, hi] = heads[0];
        say(tr, h, "nextHeading", { prefix: "H" });
        tr.add("prev", 0.56 + 0.3, "Ctrl+Home → back to the top of the page");
        pos = -1;
        viaSkip(ti);
        walk(ti, true);
      } else if (before.length) {
        for (const [h, hi] of before) {
          pos = hi;
          say(tr, h, "nextHeading", { target: hi === before[before.length - 1][1], prefix: "H" });
        }
        walk(ti, true);
      } else {
        walk(ti, true);
      }
    } else if (strategy === "find") {
      findEvents(tr, stops, step, task, si);
      const landing = idx(task.findLands?.[si] ?? step.target);
      pos = landing;
      say(tr, stops[landing], "next", { target: true, prefix: "Find lands on" });
      if (landing !== ti) walk(ti, true);
    } else {
      // linear
      viaSkip(ti);
      walk(ti, true);
    }

    if (step.action === "activate" || step.action === "select") {
      tr.add("activate", K + 0.25, `Enter → activates “${target.say.replace(/^[^,]*, /, "")}”`, target.id);
    }
    steps.push(slice(tr, from, si, step.target));
  }

  const seconds = r2(tr.t);
  return { strategy, seconds, steps, ...(blocked ? { blocked } : {}) };
}

function failHeading(tr, stops) {
  const text = "no next heading";
  tr.add("nextHeading", K + speech(text), "H → no next heading", null, {
    nodeId: stops[0].id,
    text,
    seconds: r2(speech(text)),
    truncated: false,
  });
}

function findEvents(tr, stops, step, task, si, forceQuery) {
  const q = forceQuery ?? task.findQuery?.[si] ?? "text";
  tr.add("find", 2 * K, "Ctrl+F → open Find");
  tr.add("type", q.length * K, `Type “${q}”`);
  tr.add("find", K, "Enter → jump to first match");
}

// ---------- Keyboard ----------
function keyboardStrategy(stops, task, f) {
  const tr = new Tr();
  const steps = [];
  const mainStart = stops.findIndex((s) => s.mainStart);
  const skipIdx = stops.findIndex((s) => s.skip);
  let pos = -1;
  let blocked;
  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const from = tr.events.length;
    const ti = stops.findIndex((s) => s.id === step.target);
    const target = stops[ti];
    tr.add("think", THINK, si === 0 ? "Look for the control" : "Decide the next move");

    if (step.action === "read") {
      const pages = Math.max(0, Math.ceil(((target.rect?.y ?? 0) + (target.rect?.h ?? 0) - VIEWPORT_H) / VIEWPORT_H));
      for (let p = 0; p < pages; p++) tr.add("scroll", K + SCROLL, "Space → scroll down one screen");
      tr.add("think", THINK + 1.7, "Scan the screen for the text", target.id);
      const readSec = words(target.say) / (READ_WPM / 60);
      tr.add("think", readSec, "Read the passage", target.id);
      steps.push(slice(tr, from, si, step.target));
      continue;
    }

    if (!target.focusable) {
      blocked = { stepIndex: si, reason: target.blockKb ?? `${target.say} cannot receive focus.` };
      const order = stops.map((s, i) => [s, i]).filter(([s]) => s.focusable);
      let passed = false;
      for (const [s, i] of order) {
        if (i <= pos) continue;
        tr.add("tab", K, `Tab → ${s.say}`, s.id);
        pos = i;
        if (i > ti) {
          passed = true;
          break;
        }
      }
      if (!passed) tr.add("think", 1.0, "Reaches the end of the page without finding it");
      steps.push(slice(tr, from, si, step.target));
      break;
    }

    if (skipIdx >= 0 && pos < mainStart && ti >= mainStart) {
      tr.add("tab", K, `Tab → ${stops[skipIdx].say}`, stops[skipIdx].id);
      tr.add("activate", K, "Enter → skips to main content", stops[mainStart].id);
      pos = mainStart - 0.5;
    }
    const order = stops.map((s, i) => [s, i]).filter(([s]) => s.focusable);
    for (const [s, i] of order) {
      if (i <= pos) continue;
      if (i > ti) break;
      tr.add("tab", K, `Tab → ${s.say}`, s.id);
      pos = i;
      if (i === ti) break;
    }
    if (step.action === "activate" || step.action === "select") {
      tr.add("activate", K, `Enter → ${target.say}`, target.id);
    }
    steps.push(slice(tr, from, si, step.target));
  }
  return { strategy: "tab", seconds: r2(tr.t), steps, ...(blocked ? { blocked } : {}) };
}

// ---------- Mouse ----------
function mouseStrategy(stops, task) {
  const tr = new Tr();
  const steps = [];
  let px = 640;
  let py = 400;
  let first = true;
  for (let si = 0; si < task.steps.length; si++) {
    const step = task.steps[si];
    const from = tr.events.length;
    const target = stops.find((s) => s.id === step.target);
    const rect = target.rect ?? { x: 600, y: 300, w: 100, h: 30 };
    tr.add("think", THINK, si === 0 ? "Look for the control" : "Decide the next move");
    const scrolls = Math.max(0, Math.ceil((rect.y + rect.h - VIEWPORT_H) / VIEWPORT_H));
    for (let s = 0; s < scrolls; s++) tr.add("scroll", SCROLL, "Scroll wheel → down one screen");
    const ty = scrolls ? Math.min(rect.y - scrolls * VIEWPORT_H + 300, 700) : rect.y + rect.h / 2;
    const tx = rect.x + rect.w / 2;
    const D = Math.hypot(tx - px, ty - py);
    const W = Math.max(Math.min(rect.w, rect.h), 8);
    const mt = FITTS_A + FITTS_B * Math.log2(D / W + 1);
    const label = (first ? "Reach for the mouse, point at " : "Point at ") + `“${target.name ?? target.say}”`;
    tr.add("point", mt + (first ? HOME : 0), label, target.id);
    first = false;
    px = tx;
    py = ty;
    if (step.action === "read") {
      const readSec = words(target.say) / (READ_WPM / 60);
      tr.add("think", readSec, "Read the passage", target.id);
    } else {
      tr.add("click", B2, "Click", target.id);
    }
    steps.push(slice(tr, from, si, step.target));
  }
  return { strategy: "point", seconds: r2(tr.t), steps };
}

// ---------- Assemble one task ----------
const FACTORS = { mouse: [0.79, 1.3], keyboard: [0.8, 1.35], screenreader: [0.73, 1.37] };
const SR_WEIGHTS = { headings: 0.7, find: 0.13, linear: 0.08, tab: 0.06 };

function mixture(strats, weights) {
  const ok = strats.filter((s) => !s.blocked);
  if (!ok.length) return null;
  const total = ok.reduce((a, s) => a + (weights[s.strategy] ?? 0), 0);
  const norm = {};
  for (const s of ok) norm[s.strategy] = r2((weights[s.strategy] ?? 0) / total);
  const seconds = ok.reduce((a, s) => a + norm[s.strategy] * s.seconds, 0);
  return { seconds, norm };
}

function persona(id, strats, weights, intervalOverride) {
  const mix = mixture(strats, weights);
  const blocked = mix === null;
  // Highest-weight unblocked strategy (or highest weight when everything is blocked).
  const pool = blocked ? strats : strats.filter((s) => !s.blocked);
  const rep = [...pool].sort((a, b) => (weights[b.strategy] ?? 0) - (weights[a.strategy] ?? 0))[0];
  // Only the representative strategy ships its full trace; the others keep their totals.
  const strategies = strats.map((s) => ({ ...s, steps: s === rep ? s.steps : [] }));
  const seconds = blocked ? PENALTY : r2(mix.seconds);
  const [lo, hi] = FACTORS[id];
  const interval = intervalOverride ?? (blocked ? [PENALTY, PENALTY] : [r2(seconds * lo), r2(seconds * hi)]);
  const out = {
    persona: id,
    seconds,
    interval,
    strategies,
    weights: blocked ? Object.fromEntries(strats.map((s) => [s.strategy, r2(weights[s.strategy] ?? 0)])) : mix.norm,
    representative: rep.strategy,
  };
  if (blocked) out.blocked = rep.blocked;
  return out;
}

function evalTask(site, f, task) {
  const stops = site.stops(f);
  const w = task.srWeights ?? SR_WEIGHTS;
  const srStrats = ["headings", "find", "linear", "tab"].filter((s) => w[s] !== undefined).map((s) => srStrategy(s, stops, task, f));
  const kb = keyboardStrategy(stops, task, f);
  const mouse = mouseStrategy(stops, task);
  const ov = (task.intervals ?? {})[f.__key];
  const personas = {
    mouse: persona("mouse", [mouse], { point: 1 }, ov?.mouse),
    keyboard: persona("keyboard", [kb], { tab: 1 }, ov?.keyboard),
    screenreader: persona("screenreader", srStrats, w, ov?.screenreader),
  };
  return { taskId: task.id, personas, explanation: site.explain(f, task, personas, stops) };
}

// ---------- Fix scenarios ----------
function evalSite(site, f) {
  return site.tasks.map((t) => evalTask(site, f, t));
}

const BASE_FLAGS = {};
function flagsFor(site, ids) {
  const f = { __key: ids.length ? "after" : "base" };
  for (const id of ids) f[site.fixes.find((x) => x.id === id).flag] = true;
  return f;
}

const cell = (p) => (p.blocked ? PENALTY : p.seconds);
const objective = (results) => results.reduce((a, r) => a + cell(r.personas.keyboard) + cell(r.personas.screenreader), 0);

function build(site) {
  const baseline = evalSite(site, flagsFor(site, []));
  const byK = {};
  const baselineObjective = r2(objective(baseline));
  let prevObj = baselineObjective;
  for (let k = 1; k <= Math.min(5, site.order.length); k++) {
    const ids = site.order.slice(0, k);
    const results = evalSite(site, flagsFor(site, ids));
    // cumulative gains for the first k picks
    const gains = [];
    let prev = baselineObjective;
    for (let j = 1; j <= k; j++) {
      const rj = j === k ? results : evalSite(site, flagsFor(site, site.order.slice(0, j)));
      const o = r2(objective(rj));
      gains.push({
        fixId: site.order[j - 1],
        secondsSaved: r2(prev - o),
        after: Object.fromEntries(rj.map((r) => [r.taskId, { keyboard: cell(r.personas.keyboard), screenreader: cell(r.personas.screenreader) }])),
      });
      prev = o;
    }
    const planned = r2(objective(results));
    const exhaustive = k <= 3;
    byK[k] = {
      chosen: ids,
      plannedObjective: planned,
      method: exhaustive ? "greedy+exhaustive" : "greedy",
      ...(exhaustive ? { exhaustiveObjective: planned, optimalityGap: 0 } : {}),
      evaluations: exhaustive ? 6 + 5 + 4 + choose(site.fixes.length, 1) + choose(site.fixes.length, 2) + choose(site.fixes.length, 3) + 1 : 6 + 5 + 4 + 3 * (k - 3),
      gains,
      results,
    };
    prevObj = planned;
  }
  return {
    site: site.info,
    tasks: site.tasks.map(({ id, siteId, label, steps, grounding }) => ({ id, siteId, label, steps, grounding })),
    baseline,
    baselineObjective,
    candidates: site.fixes.map(({ flag, ...spec }) => spec),
    order: site.order,
    byK,
  };
}

function choose(n, k) {
  let r = 1;
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1);
  return Math.round(r);
}

// =========================================================================================
// Site 1: Northwind Outfitters (product page; div size picker; unlabeled cart button; 60-link mega menu)
// =========================================================================================
const NW_CATS = [
  ["Men", ["New arrivals", "Jackets", "Fleece", "Base layers", "Pants", "Shorts"]],
  ["Women", ["New arrivals", "Jackets", "Fleece", "Base layers", "Leggings", "Skirts"]],
  ["Kids", ["Jackets", "Fleece", "Boots", "Hats", "Gloves", "Backpacks"]],
  ["Outerwear", ["Rain shells", "Insulated", "Vests", "Parkas", "Ponchos", "Windbreakers"]],
  ["Footwear", ["Hiking boots", "Trail runners", "Sandals", "Socks", "Insoles", "Laces"]],
  ["Packs", ["Daypacks", "Overnight", "Expedition", "Hydration", "Duffels", "Dry bags"]],
  ["Camp", ["Tents", "Sleeping bags", "Stoves", "Lanterns", "Cookware", "Chairs"]],
  ["Climb", ["Harnesses", "Helmets", "Ropes", "Carabiners", "Chalk", "Shoes"]],
  ["Run", ["Shoes", "Vests", "Hydration", "Watches", "Apparel", "Recovery"]],
  ["Sale", ["Clearance", "Last sizes", "Bundles", "Gift cards", "Outlet stores", "Seconds"]],
];

function northwindStops(f) {
  const s = [];
  if (f.skip) s.push({ id: "skip", say: "link, Skip to main content", focusable: true, skip: true, group: "header" });
  s.push({ id: "promo", say: "Free shipping on orders over $75. Details", group: "header" });
  s.push({ id: "promo-link", say: "link, Details", focusable: true, group: "header" });
  s.push({ id: "logo", say: "link, Northwind Outfitters home", focusable: true, group: "header" });
  s.push({ id: "account", say: "link, Sign in", focusable: true, group: "header" });
  s.push({ id: "stores", say: "link, Find a store", focusable: true, group: "header" });
  s.push({ id: "wishlist", say: "link, Wishlist", focusable: true, group: "header" });
  s.push({ id: "search", say: "edit, Search, blank", focusable: true, group: "header" });
  s.push({
    id: "cart-icon",
    say: f.label ? "button, Cart" : "button",
    name: "cart button",
    focusable: true,
    group: "header",
    rect: { x: 1180, y: 18, w: 40, h: 40 },
    blockSr: f.label ? undefined : "“button” has no name, so a screen-reader user cannot tell it is the cart.",
  });
  NW_CATS.forEach(([cat, subs], ci) => {
    s.push({ id: `nav-${ci}`, say: (ci === 0 ? "navigation landmark, list with 10 items, " : "") + `link, ${cat}`, focusable: true, group: "nav" });
    subs.forEach((sub, si) => s.push({ id: `nav-${ci}-${si}`, say: (si === 0 ? "list with 6 items, " : "") + `link, ${sub}`, focusable: true, group: "nav" }));
  });
  s.push({ id: "crumbs", say: "Home / Outerwear / Jackets", mainStart: true, group: "main" });
  s.push({ id: "product-title", say: "Trail Jacket", group: "main" });
  s.push({ id: "price", say: "$189.00", group: "main" });
  s.push({ id: "desc", say: "A packable, waterproof shell with taped seams, pit zips and an adjustable hood.", group: "main" });
  s.push({ id: "size-label", say: "Select a size", group: "main" });
  ["XS", "S", "M", "L", "XL"].forEach((z, i) =>
    s.push({
      id: `size-${z.toLowerCase()}`,
      say: f.realButtons ? `button, ${z}` : `clickable, ${z}`,
      name: `size ${z}`,
      focusable: !!f.realButtons,
      group: "main",
      rect: { x: 760 + i * 56, y: 520, w: 48, h: 48 },
      blockKb: `The size option “${z}” can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.`,
    }),
  );
  s.push({ id: "add-to-cart", say: "button, Add to cart", name: "Add to cart", focusable: true, group: "main", rect: { x: 760, y: 600, w: 300, h: 52 } });
  s.push({ id: "reviews-title", say: f.hReviews ? "heading, level 2, Customer reviews" : "Customer reviews", heading: !!f.hReviews, group: "main" });
  s.push({ id: "review-1", say: "Kept me dry on a three-day trek in Patagonia. Runs slightly large.", group: "main" });
  s.push({ id: "review-2", say: "Great pit zips, but the hood is tight with a helmet.", group: "main" });
  s.push({ id: "returns-title", say: f.hReturns ? "heading, level 2, Free returns" : "Free returns", heading: !!f.hReturns, group: "main" });
  s.push({ id: "returns-body", say: "Return unworn items within 60 days for a full refund.", group: "main", rect: { x: 40, y: 1250, w: 700, h: 24 } });
  return s;
}

const northwind = {
  info: {
    id: "northwind",
    name: "Northwind Outfitters",
    tagline: "Outdoor gear shop. A product page with a mega menu, a div size picker and an icon-only cart.",
    path: "/sites/northwind/index.html",
    kind: "demo",
  },
  stops: northwindStops,
  tasks: [
    {
      id: "buy-m",
      siteId: "northwind",
      label: "Add the Trail Jacket in size M to the cart",
      grounding: "fixture",
      steps: [
        { target: "size-m", action: "select", note: "Choose size M" },
        { target: "add-to-cart", action: "activate", note: "Press Add to cart" },
      ],
      srWeights: { headings: 0.8, find: 0.06, linear: 0.09, tab: 0.05 },
      findQuery: ["Select a size", "Add to cart"],
      findLands: ["size-label", "add-to-cart"],
      intervals: { base: { mouse: [3.4, 5.6], screenreader: [38, 71] } },
    },
    {
      id: "returns",
      siteId: "northwind",
      label: "Find out how long you have to return it",
      grounding: "fixture",
      steps: [{ target: "returns-body", action: "read", note: "Read the returns policy" }],
      srWeights: { headings: 0.5, find: 0.34, linear: 0.1, tab: 0.06 },
      findQuery: ["60 days"],
      findLands: ["returns-body"],
    },
    {
      id: "open-cart",
      siteId: "northwind",
      label: "Open the shopping cart",
      grounding: "fixture",
      steps: [{ target: "cart-icon", action: "activate", note: "Press the cart button" }],
      srWeights: { headings: 0.7, find: 0.13, linear: 0.08, tab: 0.06 },
    },
  ],
  fixes: [
    {
      id: "real-button:sizes",
      flag: "realButtons",
      kind: "real-button",
      title: "Make the five size options real buttons",
      rationale: "The sizes are clickable <div>s, which cannot take focus. Real buttons are reachable with Tab, so keyboard users can finish, and are announced as buttons.",
      targets: ["size-xs", "size-s", "size-m", "size-l", "size-xl"],
      params: { count: 5 },
      patch: {
        selector: ".size-picker .size",
        before: '<div class="size" onclick="pick(\'M\')">M</div>',
        after: '<button type="button" class="size" aria-pressed="false">M</button>',
      },
      wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"],
    },
    {
      id: "add-label:cart-icon",
      flag: "label",
      kind: "add-label",
      title: "Name the cart button “Cart”",
      rationale: "The icon-only button has no accessible name, so a screen reader announces just “button”. A name tells the user what it does.",
      targets: ["cart-icon"],
      params: { name: "Cart" },
      patch: {
        selector: "header .icon-btn.cart",
        before: '<button class="icon-btn cart"><svg viewBox="0 0 24 24">…</svg></button>',
        after: '<button class="icon-btn cart" aria-label="Cart"><svg viewBox="0 0 24 24" aria-hidden="true">…</svg></button>',
      },
      wcag: ["4.1.2 Name, Role, Value", "1.1.1 Non-text Content"],
    },
    {
      id: "skip-link:main",
      flag: "skip",
      kind: "skip-link",
      title: "Add a “Skip to main content” link",
      rationale: "Every visit starts with 78 header and navigation stops. A skip link jumps past all of them with one keystroke.",
      targets: ["crumbs"],
      params: { href: "#main" },
      patch: {
        selector: "body",
        before: '<body>\n  <header class="site-header">…</header>\n  <div id="main" class="content">',
        after: '<body>\n  <a class="skip" href="#main">Skip to main content</a>\n  <header class="site-header">…</header>\n  <div id="main" class="content">',
      },
      wcag: ["2.4.1 Bypass Blocks"],
    },
    {
      id: "promote-heading:reviews-title",
      flag: "hReviews",
      kind: "promote-heading",
      title: "Make “Customer reviews” a level-2 heading",
      rationale: "It is styled like a heading but is a plain <div>, so heading navigation skips it. Real headings give screen-reader users landmarks to jump between.",
      targets: ["reviews-title"],
      params: { level: 2 },
      patch: {
        selector: ".reviews .section-title",
        before: '<div class="section-title">Customer reviews</div>',
        after: '<h2 class="section-title">Customer reviews</h2>',
      },
      wcag: ["1.3.1 Info and Relationships", "2.4.6 Headings and Labels"],
    },
    {
      id: "promote-heading:returns-title",
      flag: "hReturns",
      kind: "promote-heading",
      title: "Make “Free returns” a level-2 heading",
      rationale: "Same pattern: a visual heading that assistive technology cannot see. Promoting it puts the returns policy one keypress away.",
      targets: ["returns-title"],
      params: { level: 2 },
      patch: {
        selector: ".returns .section-title",
        before: '<div class="section-title">Free returns</div>',
        after: '<h2 class="section-title">Free returns</h2>',
      },
      wcag: ["1.3.1 Info and Relationships", "2.4.6 Headings and Labels"],
    },
    {
      id: "add-landmark:main",
      flag: "landmarkMain",
      kind: "add-landmark",
      title: "Wrap the page content in <main>",
      rationale: "Without a main landmark, landmark navigation cannot jump to the content. Small gain, since a skip link does the same job.",
      targets: ["crumbs"],
      params: { landmark: "main" },
      patch: {
        selector: "#main",
        before: '<div id="main" class="content">',
        after: '<main id="main" class="content">',
      },
      wcag: ["1.3.1 Info and Relationships", "2.4.1 Bypass Blocks"],
    },
  ],
  order: ["real-button:sizes", "add-label:cart-icon", "skip-link:main", "promote-heading:reviews-title", "promote-heading:returns-title"],
  explain(f, task, p, stops) {
    const out = [];
    const sr = p.screenreader;
    const navLinks = stops.filter((s) => s.group === "nav").length + stops.filter((s) => s.group === "header").length;
    const srTr = sr.strategies.find((s) => s.strategy === sr.representative);
    const headerSeconds = r2(
      srTr.steps.flatMap((s) => s.events).filter((e) => e.nodeId && stops.find((x) => x.id === e.nodeId)?.group !== "main").reduce((a, e) => a + e.dt, 0),
    );
    if (task.id === "buy-m") {
      if (p.keyboard.blocked) out.push(`Keyboard: ${p.keyboard.blocked.reason}`);
      if (!f.skip) out.push(`Screen reader: ${fmt(headerSeconds)} s of the ${fmt(srTr.seconds)} s goes on listening to ${navLinks} header and navigation stops before the content starts. There is no skip link.`);
      else out.push(`Screen reader: a skip link jumps past the ${navLinks - 1} header and navigation stops in one keystroke, so the user reaches the content in about ${fmt(r2(srTr.steps[0].events.slice(0, 4).reduce((a, e) => a + e.dt, 0)))} s.`);
      if (!f.hReviews && !f.hReturns) out.push("Screen reader: this page has no real headings, so jumping by heading (the most common strategy) finds nothing and falls back to reading line by line.");
      if (!f.realButtons) out.push("Screen reader: the size options are announced as “clickable”, not as buttons, so the user cannot jump between them with the button key.");
      else out.push("Keyboard: the size options are real buttons, so Tab reaches them in order.");
      out.push(`Mouse: ${p.mouse.strategies[0].steps.reduce((a, s) => a + (s.commands.find((c) => c.command === "click")?.count ?? 0), 0)} clicks and ${p.mouse.strategies[0].steps.reduce((a, s) => a + (s.commands.find((c) => c.command === "point")?.count ?? 0), 0)} pointer movements, about ${fmt(p.mouse.seconds)} s. Nothing to win back here.`);
    } else if (task.id === "returns") {
      out.push(`Screen reader: the returns policy is the last paragraph of a long page, so reading line by line takes about ${fmt(sr.strategies.find((s) => s.strategy === "linear").seconds)} s.`);
      if (f.hReviews || f.hReturns) out.push("Screen reader: a real heading just above the policy lets the H key jump close to it.");
      else out.push("Screen reader: “Free returns” is styled like a heading but is a plain <div>, so the H key cannot jump to it.");
      out.push(`Keyboard: nothing on the way is focusable, so the user scrolls with the Space bar and scans the screen: about ${fmt(p.keyboard.seconds)} s.`);
    } else {
      if (p.screenreader.blocked) out.push(`Screen reader: ${p.screenreader.blocked.reason}`);
      else out.push("Screen reader: the cart button is announced as “button, Cart” on the third stop of the page.");
      out.push(`Keyboard: the cart button is the third thing Tab reaches, so it takes about ${fmt(p.keyboard.seconds)} s.`);
      out.push(`Mouse: one pointer movement and one click, about ${fmt(p.mouse.seconds)} s.`);
    }
    return out;
  },
};

// =========================================================================================
// Site 2: Riverside County Food Assistance (civic; buried Apply; div accordions; div language picker)
// =========================================================================================
function riversideStops(f) {
  const s = [];
  if (f.skip) s.push({ id: "skip", say: "link, Skip to main content", focusable: true, skip: true, group: "header" });
  s.push({ id: "logo", say: "link, Riverside County home", focusable: true, group: "header" });
  s.push({
    id: "lang",
    say: f.realButtons ? "button, English, collapsed" : "clickable, English",
    name: "language picker",
    focusable: !!f.realButtons,
    group: "header",
    rect: { x: 1120, y: 20, w: 120, h: 36 },
    blockKb: "The language picker can't be reached with the keyboard: it is a clickable <div> that cannot receive focus.",
  });
  const links = ["Home", "Benefits", "Eligibility", "Locations", "Forms", "Report a change", "Appeal a decision", "Contact", "Help"];
  links.forEach((l, i) => s.push({ id: `nav-${i}`, say: (i === 0 ? "navigation landmark, list with 9 items, " : "") + `link, ${l}`, focusable: true, group: "nav" }));
  ["Emergency food pantries open this week. Call 2-1-1 for same-day help.", "Food assistance for Riverside County families", "Helping neighbors put food on the table since 1974, with CalFresh, WIC and pantry referrals."].forEach((t, i) =>
    s.push({ id: `intro-${i}`, say: t, group: "main", mainStart: i === 0 }),
  );
  for (let i = 0; i < 4; i++) s.push({ id: `news-${i}`, say: ["Summer meals for kids at 40 library branches.", "New online document upload now available.", "Holiday office closures and pantry hours.", "Volunteer drivers needed for senior deliveries."][i], group: "main" });
  s.push({ id: "elig-title", say: "Who can get help", group: "main" });
  for (let i = 0; i < 5; i++) s.push({ id: `elig-${i}`, say: ["Households under 200 percent of the poverty line.", "Seniors and people with disabilities.", "Families with children under five.", "Recent job loss or reduced hours.", "Students who meet work requirements."][i], group: "main" });
  s.push({ id: "docs-title", say: "Documents you will need", group: "main" });
  for (let i = 0; i < 4; i++) s.push({ id: `docs-${i}`, say: ["Photo ID for every adult.", "Proof of address.", "Recent pay stubs or a benefits letter.", "Social Security numbers, if you have them."][i], group: "main" });
  ["Office hours", "Locations and parking", "Accessibility services", "Translation help"].forEach((t, i) =>
    s.push({
      id: `acc-${i}`,
      say: f.realButtons ? `button, ${t}, collapsed` : `clickable, ${t}`,
      name: t,
      focusable: !!f.realButtons,
      group: "main",
      rect: { x: 80, y: 1500 + i * 56, w: 700, h: 48 },
      blockKb: `The “${t}” section can't be opened with the keyboard: it is a clickable <div> that cannot receive focus.`,
    }),
  );
  s.push({ id: "hours-text", say: "Monday to Friday, 8 a.m. to 4:30 p.m. Closed on county holidays.", group: "main", rect: { x: 80, y: 1560, w: 700, h: 24 } });
  s.push({ id: "apply-title", say: f.hApply ? "heading, level 2, Ready to apply?" : "Ready to apply?", heading: !!f.hApply, group: "main" });
  s.push({ id: "apply-btn", say: "button, Start your application", name: "Start your application", focusable: true, group: "main", rect: { x: 80, y: 1900, w: 320, h: 56 } });
  return s;
}

const riverside = {
  info: {
    id: "riverside",
    name: "Riverside County Food Assistance",
    tagline: "Civic benefits site. The Apply button is buried, sections are div accordions, the language picker is a div.",
    path: "/sites/riverside/index.html",
    kind: "demo",
  },
  stops: riversideStops,
  tasks: [
    {
      id: "apply",
      siteId: "riverside",
      label: "Start an application for food assistance",
      grounding: "fixture",
      steps: [{ target: "apply-btn", action: "activate", note: "Press Start your application" }],
      srWeights: { headings: 0.7, find: 0.13, linear: 0.08, tab: 0.06 },
      findQuery: ["apply"],
      findLands: ["apply-title"],
    },
    {
      id: "hours",
      siteId: "riverside",
      label: "Find the office hours",
      grounding: "fixture",
      steps: [
        { target: "acc-0", action: "activate", note: "Open “Office hours”" },
        { target: "hours-text", action: "read", note: "Read the hours" },
      ],
      srWeights: { headings: 0.45, find: 0.35, linear: 0.14, tab: 0.06 },
      findQuery: ["Office hours", ""],
      findLands: ["acc-0", "hours-text"],
    },
    {
      id: "spanish",
      siteId: "riverside",
      label: "Switch the page to Spanish",
      grounding: "fixture",
      steps: [{ target: "lang", action: "activate", note: "Open the language picker" }],
      srWeights: { headings: 0.3, find: 0.1, linear: 0.54, tab: 0.06 },
      findQuery: ["English"],
      findLands: ["lang"],
    },
  ],
  fixes: [
    {
      id: "real-button:language",
      flag: "realButtons",
      kind: "real-button",
      title: "Make the language picker and the four accordion headers real buttons",
      rationale: "They are clickable <div>s, so keyboard users cannot open them. Real buttons take focus and announce their expanded state.",
      targets: ["lang", "acc-0", "acc-1", "acc-2", "acc-3"],
      params: { count: 5 },
      patch: {
        selector: ".lang-picker, .accordion-head",
        before: '<div class="accordion-head" onclick="toggle(0)">Office hours</div>',
        after: '<button type="button" class="accordion-head" aria-expanded="false">Office hours</button>',
      },
      wcag: ["2.1.1 Keyboard", "4.1.2 Name, Role, Value"],
    },
    {
      id: "promote-heading:apply",
      flag: "hApply",
      kind: "promote-heading",
      title: "Make “Ready to apply?” a level-2 heading",
      rationale: "The Apply button sits at the bottom of a long page. A real heading above it lets screen-reader users jump straight to the application.",
      targets: ["apply-title"],
      params: { level: 2 },
      patch: {
        selector: ".apply-cta .title",
        before: '<div class="title">Ready to apply?</div>',
        after: '<h2 class="title">Ready to apply?</h2>',
      },
      wcag: ["1.3.1 Info and Relationships", "2.4.6 Headings and Labels"],
    },
    {
      id: "skip-link:main",
      flag: "skip",
      kind: "skip-link",
      title: "Add a “Skip to main content” link",
      rationale: "Twelve header and navigation stops come before the first sentence of content.",
      targets: ["intro-0"],
      params: { href: "#main" },
      patch: {
        selector: "body",
        before: '<body>\n  <header>…</header>\n  <section id="main">',
        after: '<body>\n  <a class="skip" href="#main">Skip to main content</a>\n  <header>…</header>\n  <section id="main">',
      },
      wcag: ["2.4.1 Bypass Blocks"],
    },
  ],
  order: ["real-button:language", "promote-heading:apply", "skip-link:main"],
  explain(f, task, p) {
    const out = [];
    if (p.keyboard.blocked) out.push(`Keyboard: ${p.keyboard.blocked.reason}`);
    const sr = p.screenreader;
    if (task.id === "apply") {
      out.push(
        f.hApply
          ? "Screen reader: a real heading right above the button puts the application one keypress away."
          : `Screen reader: the Apply button is near the bottom of the page; reading line by line takes about ${fmt(sr.strategies.find((s) => s.strategy === "linear").seconds)} s, and no heading leads to it.`,
      );
      out.push(`Keyboard: the button is focusable, so Tab reaches it in about ${fmt(p.keyboard.seconds)} s.`);
    } else if (task.id === "hours") {
      out.push("Screen reader: the section header is announced as “clickable”, so the user must guess that it opens.");
    } else {
      out.push("Screen reader: the picker is announced as “clickable, English”, which is a guess rather than a control.");
    }
    out.push(`Mouse: about ${fmt(p.mouse.seconds)} s.`);
    return out;
  },
};

// =========================================================================================
// Site 3: Alpine Books (control: well built, so Detour should find little to fix)
// =========================================================================================
function alpineStops(f) {
  const s = [];
  s.push({ id: "skip", say: "link, Skip to main content", focusable: true, skip: true, group: "header" });
  s.push({ id: "logo", say: "banner landmark, link, Alpine Books home", focusable: true, group: "header" });
  ["Browse", "Events", "Cafe", "About"].forEach((l, i) => s.push({ id: `nav-${i}`, say: (i === 0 ? "navigation landmark, list with 4 items, " : "") + `link, ${l}`, focusable: true, group: "nav" }));
  s.push({ id: "h1", say: "main landmark, heading, level 1, Independent books since 1982", mainStart: true, heading: true, group: "main" });
  s.push({ id: "intro", say: "Staff picks, local authors and a reading room that stays open late.", group: "main" });
  s.push({ id: "h2-picks", say: "heading, level 2, Staff picks", heading: true, group: "main" });
  s.push({ id: "pick-1", say: "link, The Cartographer's Daughter", focusable: true, group: "main", name: "The Cartographer's Daughter", rect: { x: 80, y: 520, w: 260, h: 40 } });
  s.push({ id: "reserve", say: "button, Reserve a copy", focusable: true, group: "main", name: "Reserve a copy", rect: { x: 80, y: 590, w: 200, h: 48 } });
  s.push({ id: "h2-hours", say: "heading, level 2, Opening hours", heading: true, group: "main" });
  s.push({ id: "hours-text", say: "Open every day, 9 a.m. to 9 p.m.", group: "main", rect: { x: 80, y: 900, w: 500, h: 24 } });
  return s;
}

const alpine = {
  info: {
    id: "alpine",
    name: "Alpine Books",
    tagline: "Control page. Real headings, landmarks, a skip link and native buttons: Detour should find little to fix.",
    path: "/sites/alpine/index.html",
    kind: "control",
  },
  stops: alpineStops,
  tasks: [
    {
      id: "reserve",
      siteId: "alpine",
      label: "Reserve “The Cartographer's Daughter”",
      grounding: "fixture",
      steps: [
        { target: "pick-1", action: "activate", note: "Open the book" },
        { target: "reserve", action: "activate", note: "Press Reserve a copy" },
      ],
      srWeights: { headings: 0.7, find: 0.13, linear: 0.08, tab: 0.06 },
      findQuery: ["Cartographer", "Reserve"],
      findLands: ["pick-1", "reserve"],
    },
    {
      id: "hours",
      siteId: "alpine",
      label: "Find the opening hours",
      grounding: "fixture",
      steps: [{ target: "hours-text", action: "read", note: "Read the hours" }],
      srWeights: { headings: 0.7, find: 0.13, linear: 0.08, tab: 0.06 },
      findQuery: ["hours"],
      findLands: ["h2-hours"],
    },
  ],
  fixes: [
    {
      id: "add-landmark:footer",
      flag: "footerLandmark",
      kind: "add-landmark",
      title: "Wrap the footer in <footer>",
      rationale: "The only gap found: the closing block is a <div>. No task on this page is slowed by it, so Detour does not recommend spending time here.",
      targets: ["hours-text"],
      params: { landmark: "contentinfo" },
      patch: { selector: ".site-foot", before: '<div class="site-foot">…</div>', after: '<footer class="site-foot">…</footer>' },
      wcag: ["1.3.1 Info and Relationships"],
    },
  ],
  order: [],
  explain(f, task, p) {
    const out = ["Screen reader: a skip link, real headings and native buttons give short, direct paths; no step stands out as expensive."];
    if (task.id === "reserve") out.push("Keyboard: every control is focusable and in reading order.");
    out.push(`Mouse: about ${fmt(p.mouse.seconds)} s. Nothing on this page needs a fix.`);
    return out;
  },
};

function fmt(n) {
  return n < 10 ? String(Math.round(n * 10) / 10) : String(Math.round(n));
}

const index = [];
for (const site of [northwind, riverside, alpine]) {
  const data = build(site);
  index.push({ ...data.site, tasks: data.tasks });
  const json = JSON.stringify(data);
  writeFileSync(join(OUT, `${site.info.id}.json`), json + "\n");
  const brief = data.baseline.map((r) => `${r.taskId}: mouse ${r.personas.mouse.seconds} | kb ${r.personas.keyboard.blocked ? "BLOCKED" : r.personas.keyboard.seconds} | sr ${r.personas.screenreader.blocked ? "BLOCKED" : r.personas.screenreader.seconds} (${r.personas.screenreader.representative}, ${r.personas.screenreader.strategies.find((s) => s.strategy === r.personas.screenreader.representative).steps.reduce((a, s) => a + s.events.length, 0)} ev)`);
  console.log(`\n${site.info.id}: ${(json.length / 1024).toFixed(0)} KB, baseline objective ${data.baselineObjective}`);
  brief.forEach((b) => console.log("  " + b));
  for (const [k, v] of Object.entries(data.byK)) {
    console.log(`  k=${k}: ${v.chosen.join(", ")} -> obj ${v.plannedObjective}; ` + v.results.map((r) => `${r.taskId}: m ${r.personas.mouse.seconds} kb ${r.personas.keyboard.blocked ? "BLOCKED" : r.personas.keyboard.seconds} sr ${r.personas.screenreader.blocked ? "BLOCKED" : r.personas.screenreader.seconds}`).join(" | "));
  }
}

// Small index so listSites() does not have to load every trace.
writeFileSync(join(OUT, "sites.json"), JSON.stringify(index) + "\n");
