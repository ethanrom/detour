import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LITERATURE, type Range } from "@/lib/params/literature";
import { BLOCKED_PENALTY_SECONDS } from "@/lib/contracts";

export const metadata: Metadata = {
  title: "Method",
  description: "How Detour turns an accessibility tree into seconds: personas, KLM operators, Fitts's law, screen-reader shortest paths, Monte Carlo intervals and a certified fix optimiser.",
};

const TOC = [
  ["overview", "Overview"],
  ["personas", "Personas"],
  ["klm", "KLM operators"],
  ["fitts", "Fitts’s law"],
  ["graph", "Screen-reader graph"],
  ["mixture", "Strategy mixture"],
  ["montecarlo", "Monte Carlo intervals"],
  ["optimiser", "The optimiser"],
  ["llm", "What the LLM does"],
  ["parameters", "Parameters"],
  ["limits", "Limitations"],
] as const;

function Section({ id, eyebrow, title, children }: { id: string; eyebrow: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-rule py-10 first:border-t-0 first:pt-0">
      <p className="eyebrow">{eyebrow}</p>
      <h2 id={`${id}-h`} className="h-section mt-2.5">
        {title}
      </h2>
      <div className="prose-detour mt-5 space-y-4 text-[1.0625rem] leading-relaxed">{children}</div>
    </section>
  );
}

function Formula({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p role="math" aria-label={label} className="my-5 overflow-x-auto rounded-xl border-2 border-ink bg-surface px-5 py-4 font-serif text-xl italic sm:text-2xl">
      {children}
    </p>
  );
}

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000));

interface Row {
  name: string;
  r: Range;
  note?: string;
}

const ROWS: Row[] = [
  { name: "Keystroke K", r: LITERATURE.klm.K, note: "Tab, H, arrows" },
  { name: "Button press B", r: LITERATURE.klm.B, note: "a click is 2B" },
  { name: "Mental preparation M", r: LITERATURE.klm.M },
  { name: "Homing H", r: LITERATURE.klm.H, note: "keyboard ↔ mouse" },
  { name: "Pointing P (fallback)", r: LITERATURE.klm.P, note: "when no layout is available" },
  { name: "Fitts intercept a", r: LITERATURE.fitts.mouse.a },
  { name: "Fitts slope b", r: LITERATURE.fitts.mouse.b },
  { name: "Silent reading speed", r: LITERATURE.reading.wpm },
  { name: "Screen-reader speech rate", r: LITERATURE.speech.wpm },
  { name: "Share of an announcement heard", r: LITERATURE.speech.listenFraction, note: "non-target stops" },
  { name: "Typing time per character", r: LITERATURE.typing.charSeconds },
  { name: "Scroll time per viewport", r: LITERATURE.scroll.secondsPerViewport },
  { name: "Keyboard motor factor", r: LITERATURE.keyboardMotorFactor, note: "multiplies K for the keyboard persona" },
];

const SR = LITERATURE.screenReaderStrategies;

export default function MethodPage() {
  return (
    <div className="mx-auto w-full max-w-[1360px] px-5 pb-8 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-12 max-w-3xl">
        <p className="eyebrow">Method</p>
        <h1 className="display mt-3 text-4xl sm:text-6xl">
          Every second has <span className="mark">a source</span>
        </h1>
        <p className="lede mt-5">
          Detour is a simulation, not a score. Times come from published human-performance models run over the page’s accessibility tree. This page is
          the whole model, written for someone who wants to check it.
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="eyebrow">On this page</p>
            <ol className="mt-4 space-y-0.5 border-l border-rule text-[0.9375rem]">
              {TOC.map(([id, label]) => (
                <li key={id}>
                  <a href={`#${id}`} className="-ml-px block border-l-2 border-transparent py-1 pl-4 text-muted no-underline hover:border-ink hover:text-ink">
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <div className="max-w-3xl">
          <Section id="overview" eyebrow="01" title="What Detour predicts">
            <p>
              For a page and a task (“add the Trail Jacket in size M to the cart”), Detour predicts how many <strong>seconds</strong> the task takes
              for three people, and how that changes after code fixes.
            </p>
            <ol className="grid gap-3 sm:grid-cols-2">
              {[
                "Read the page’s accessibility tree from the rendered DOM: roles, accessible names (W3C accname), focus order, headings, landmarks, geometry.",
                "Build a cost model per persona and find the cheapest way through the page for each navigation strategy.",
                "Mix strategies by how often real users choose them, then sample parameter uncertainty to get a 90% interval.",
                "Generate candidate code fixes, re-measure after each, and pick the smallest set that saves the most time.",
              ].map((t, i) => (
                <li key={i} className="card flex gap-3 p-4 text-[0.9375rem]">
                  <span aria-hidden="true" className="grid size-7 shrink-0 place-items-center rounded-full bg-ink font-serif font-bold text-lime">
                    {i + 1}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <p>
              Every number and every explanation sentence on screen is produced by deterministic code. Nothing is generated by a language model.
            </p>
          </Section>

          <Section id="personas" eyebrow="02" title="Three personas">
            <ul className="grid gap-4 sm:grid-cols-3">
              {[
                ["Mouse", "var(--mouse)", "Points and clicks. Each step costs a mental operator, a Fitts’s-law pointing movement and a click. Long pages add scrolling."],
                ["Keyboard", "var(--keyboard)", "Uses Tab, Shift+Tab and skip links only. A control that cannot take focus is unreachable, so the task is blocked rather than slow. Keys are scaled by a motor factor."],
                ["Screen reader", "var(--screenreader)", "A blind user with an NVDA-style browse-mode cursor. Time is keystrokes plus listening. Unnamed controls and fake buttons cost dearly."],
              ].map(([name, color, text]) => (
                <li key={name} className="card p-4">
                  <h3 className="h-card" style={{ color }}>
                    {name}
                  </h3>
                  <p className="mt-2 text-[0.9375rem] leading-relaxed">{text}</p>
                </li>
              ))}
            </ul>
            <p>
              A persona can be <em>blocked</em>: no strategy can finish the task. Blocked is reported as “Can’t finish” with the reason, never as a large
              number. For the optimiser a blocked persona is charged {BLOCKED_PENALTY_SECONDS} s.
            </p>
          </Section>

          <Section id="klm" eyebrow="03" title="KLM operators">
            <p>
              The Keystroke-Level Model (Card, Moran &amp; Newell, 1980) prices a task by summing the time of primitive operators. Detour uses five of
              them. Values and ranges are in the parameter table below.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-left text-[0.9375rem]">
                <caption className="sr-only">KLM operators used by Detour</caption>
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th scope="col" className="py-2 pr-4">Operator</th>
                    <th scope="col" className="py-2 pr-4">Meaning</th>
                    <th scope="col" className="py-2 pr-4">Used by</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    ["K", "Press a navigation key (Tab, H, arrows)", "keyboard, screen reader"],
                    ["B", "Press or release a mouse button (a click is 2B)", "mouse"],
                    ["M", "Mental preparation before a step", "all"],
                    ["H", "Move a hand between keyboard and mouse", "mouse"],
                    ["P", "Point at a target (fallback when geometry is missing)", "mouse"],
                  ].map(([op, m, u]) => (
                    <tr key={op} className="border-b border-rule">
                      <th scope="row" className="py-2 pr-4 font-mono">{op}</th>
                      <td className="py-2 pr-4">{m}</td>
                      <td className="py-2 pr-4 text-muted">{u}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="fitts" eyebrow="04" title="Fitts’s law for the mouse">
            <p>
              When the page has layout, pointing time uses the Shannon formulation of Fitts’s law (MacKenzie, 1992), with the target’s distance from the
              last pointer position and its width taken from its bounding box.
            </p>
            <Formula label="M T equals a plus b times log base 2 of the quantity D over W plus 1">
              MT = a + b · log<sub>2</sub>(D / W + 1)
            </Formula>
            <p>
              <em>D</em> is the distance to the target centre, <em>W</em> the smaller side of the target. Small, far targets cost more bits. This is why a
              tiny icon button is slower for a mouse user, long before any screen reader is involved.
            </p>
          </Section>

          <Section id="graph" eyebrow="05" title="Screen-reader navigation as shortest paths">
            <p>
              A screen-reader user moves a virtual cursor through the page. Detour models this as a graph: <strong>nodes</strong> are reading stops (a
              link, a heading, a paragraph) and <strong>edges</strong> are commands (next item, previous item, Tab, next heading, next landmark, find,
              activate). An edge costs a keystroke plus the time spent listening to what is announced on arrival.
            </p>
            <Formula label="cost of an edge equals K plus words in the announcement divided by speech rate in words per second, times the share heard">
              cost(edge) = K + words(announcement) ÷ (wpm / 60) × f
            </Formula>
            <p>
              <em>f</em> is the share of the announcement the user hears before moving on. It is below 1 for stops they skip past and exactly 1 at the
              target. Announcements come from a deterministic NVDA-style printer (“navigation landmark, list with 10 items, link, Men”), so the word
              count, and so the time, depends on exactly how the page is marked up.
            </p>
            <p>
              For each strategy, Dijkstra finds the cheapest path from the top of the page to each step’s target. Properties checked in tests: it
              matches brute force on random graphs, adding an edge never makes a task slower, and time scales as 1/speech rate.
            </p>
          </Section>

          <Section id="mixture" eyebrow="06" title="Strategy mixture">
            <p>
              People do not all navigate the same way. For a screen-reader user, the strategies are jumping by headings, reading line by line, using
              find, jumping by landmarks, and tabbing. Detour computes a path for each and weights them by how often users report choosing them when
              looking for information on a long page.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse text-left text-[0.9375rem]">
                <caption className="sr-only">Screen-reader strategy shares</caption>
                <thead>
                  <tr className="border-b-2 border-ink">
                    <th scope="col" className="py-2 pr-4">Strategy</th>
                    <th scope="col" className="py-2 pr-4">Share</th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["Jump by headings", SR.headings],
                      ["Find on page", SR.find],
                      ["Read line by line", SR.linear],
                      ["Jump by landmarks", SR.landmarks],
                      ["Tab key only", SR.tab],
                    ] as const
                  ).map(([n, v]) => (
                    <tr key={n} className="border-b border-rule">
                      <th scope="row" className="py-2 pr-4 font-medium">{n}</th>
                      <td className="tnum py-2 pr-4">{Math.round(v * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-sm text-muted">Source: {SR.source}</p>
            <Formula label="seconds equals the sum over strategies of weight i times time i">
              seconds = Σ<sub>i</sub> w<sub>i</sub> · t<sub>i</sub>
            </Formula>
            <p>
              A strategy that cannot reach the target (a fake button is not in the Tab order) is removed and the remaining weights are renormalised. If
              every strategy is blocked, so is the persona.
            </p>
          </Section>

          <Section id="montecarlo" eyebrow="07" title="Monte Carlo intervals">
            <p>
              A single number would be false precision. Each parameter has a plausible range from the literature, with a distribution (uniform,
              triangular or log-normal). Detour draws every parameter and a strategy for each sample, recomputes the task, and reports the 5th to 95th
              percentile as a <strong>90% interval</strong>, shown as “52 s, 90% interval 38–71 s”.
            </p>
            <p>
              Sampling is seeded, so a result is reproducible. The interval reflects <em>parameter and strategy uncertainty</em>. It does not include
              error in the model itself (see limitations).
            </p>
          </Section>

          <Section id="optimiser" eyebrow="08" title="The optimiser: lazy greedy, certified by exhaustive search">
            <p>
              Candidate fixes are small code changes: add a skip link, promote a styled heading to a real heading, wrap a region in a landmark, name an
              unlabelled control, turn a clickable div into a button, drop a positive tabindex. Each is a deterministic transform of the page model with
              an HTML before/after.
            </p>
            <Formula label="objective equals the sum over tasks of keyboard seconds plus screen reader seconds, with 300 seconds for a blocked persona">
              objective = Σ<sub>tasks</sub> ( t<sub>keyboard</sub> + t<sub>screen reader</sub> ) &nbsp;·&nbsp; blocked = {BLOCKED_PENALTY_SECONDS} s
            </Formula>
            <p>
              The optimiser repeatedly adds the fix with the largest marginal drop in the objective. A <em>lazy</em> evaluation order skips candidates
              whose last known gain can no longer win. Greedy is not guaranteed optimal, because fixes interact (a skip link makes a later heading fix
              worth less). So for k ≤ 3 Detour also searches <em>every</em> subset of size ≤ k and reports the gap. “Certified optimal (gap 0.0 s)”
              means greedy matched the exhaustive best.
            </p>
          </Section>

          <Section id="llm" eyebrow="09" title="What the language model does, and does not do">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card p-5">
                <h3 className="h-card">Does</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.9375rem]">
                  <li>Maps a free-text task to elements on the page.</li>
                  <li>Output is validated: every target must exist and be actionable, with one retry.</li>
                  <li>Falls back to hand-pinned fixture tasks when there is no key, so the demo never depends on it.</li>
                </ul>
              </div>
              <div className="card p-5">
                <h3 className="h-card">Does not</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.9375rem]">
                  <li>Produce any time, interval or percentage.</li>
                  <li>Choose, rank or write fixes.</li>
                  <li>Write the explanations: those sentences come from a deterministic printer.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section id="parameters" eyebrow="10" title="Parameters and sources">
            <p>
              Everything the engine assumes is in one file, <code className="font-mono text-[0.9em]">lib/params/literature.ts</code>. This table is
              rendered from it, so it cannot drift from the code.
            </p>
            <div className="overflow-x-auto rounded-xl border border-rule bg-surface">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <caption className="sr-only">Human-performance parameters used by the model, with value, range, unit and source</caption>
                <thead>
                  <tr className="border-b-2 border-ink bg-paper-2">
                    <th scope="col" className="px-3 py-2.5">Parameter</th>
                    <th scope="col" className="px-3 py-2.5">Value</th>
                    <th scope="col" className="px-3 py-2.5">Range (low–high)</th>
                    <th scope="col" className="px-3 py-2.5">Unit</th>
                    <th scope="col" className="px-3 py-2.5">Source</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(({ name, r, note }) => (
                    <tr key={name} className="border-b border-rule align-top last:border-b-0">
                      <th scope="row" className="px-3 py-2.5 font-semibold">
                        {name}
                        {note && <span className="block text-xs font-normal text-muted">{note}</span>}
                      </th>
                      <td className="tnum px-3 py-2.5 font-bold">{fmt(r.value)}</td>
                      <td className="tnum px-3 py-2.5">
                        {fmt(r.low)}–{fmt(r.high)} <span className="text-xs text-muted">({r.dist})</span>
                      </td>
                      <td className="px-3 py-2.5">{r.unit}</td>
                      <td className="px-3 py-2.5 text-muted">{r.source}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="limits" eyebrow="11" title="Limitations, stated plainly">
            <ul className="list-disc space-y-2.5 pl-5">
              <li>
                <strong>It is a model, not a measurement.</strong> The intervals cover parameter and strategy uncertainty only. They do not cover error in
                the model structure. Treat times as relative costs that rank problems, not as forecasts for one person.
              </li>
              <li>
                <strong>Parameters are literature averages</strong> from studies of other populations and devices. Some citations in the table above are
                still being verified, and rows marked “TODO verify” should be read as provisional.
              </li>
              <li>
                <strong>One screen reader flavour.</strong> Announcements approximate NVDA with default settings. JAWS, VoiceOver and TalkBack differ in
                wording, verbosity and hotkeys.
              </li>
              <li>
                <strong>Experienced users.</strong> Strategy shares come from a survey whose respondents skew experienced. Novices will be slower and
                more linear.
              </li>
              <li>
                <strong>Disabilities modelled:</strong> blind screen-reader use, keyboard-only use (with a motor-speed factor) and mouse use. Low vision,
                cognitive, hearing and switch or voice access are not modelled.
              </li>
              <li>
                <strong>Static pages and known steps.</strong> Tasks are chains of element-level steps on one rendered page. Dynamic state (modals,
                single-page routing, form validation), content that loads later and exploratory behaviour are out of scope.
              </li>
              <li>
                <strong>Fixes are patches, not guarantees.</strong> Gains are measured on the page model. A real code change still needs review and
                testing, and some fixes can slow another task slightly. The per-task table shows this when it happens.
              </li>
              <li>
                <strong>Validation is incomplete.</strong> The model is checked against known properties and hand-computed cases. Comparison with
                published empirical task times is planned, not claimed.
              </li>
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}
