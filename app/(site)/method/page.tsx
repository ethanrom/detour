import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LITERATURE, type Range } from "@/lib/params/literature";
import { BLOCKED_PENALTY_SECONDS } from "@/lib/contracts";
import { EXHAUSTIVE_ALL_MAX, EXHAUSTIVE_TOP_PER_ROUND } from "@/lib/fixes/plan";
import { DEFAULT_FORAGING } from "@/lib/scent";
import { SEARCH_MIN_RATIO } from "@/lib/ui/search-insight";

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
  ["scent", "Realistic heading search"],
  ["montecarlo", "Monte Carlo intervals"],
  ["optimiser", "The optimiser"],
  ["fix", "Fix and re-check"],
  ["llm", "What the LLM does"],
  ["parameters", "Parameters"],
  ["limits", "Limitations"],
] as const;

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="scroll-mt-24 border-t border-rule py-10 first:border-t-0 first:pt-0">
      <h2 id={`${id}-h`} className="h-section">
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

/** Foraging parameters of the heading-search model: modelling assumptions, not measurements. */
const FORAGING: Array<{ name: string; value: number; note: string }> = [
  { name: "Enter steepness α", value: DEFAULT_FORAGING.alpha, note: "how sharply interest in a heading rises with its scent" },
  { name: "Scent threshold θ", value: DEFAULT_FORAGING.theta, note: "scent at which a listener is 50% likely to open a section" },
  { name: "Share of a wrong section heard β", value: DEFAULT_FORAGING.beta, note: "how long a listener persists before backing out" },
  { name: "Second-pass floor", value: DEFAULT_FORAGING.pMin2, note: "minimum chance of opening a section on the second pass over the headings" },
];

const isAssumption = (r: Range) => /modelling assumption|judgement|judgment/i.test(`${r.source} ${r.note ?? ""}`);

const SR = LITERATURE.screenReaderStrategies;

export default function MethodPage() {
  return (
    <div className="mx-auto w-full max-w-[1360px] px-5 pb-8 pt-10 sm:px-8 sm:pt-14">
      <header className="mb-12 max-w-3xl">
        <h1 className="display text-4xl sm:text-6xl">
          Every second has a source
        </h1>
        <p className="lede mt-5">
          Detour is a simulation, not a score. Times come from published human-performance models run over the page’s accessibility tree. This page is
          the whole model, written for someone who wants to check it.
        </p>
      </header>

      <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,1fr)]">
        <nav aria-label="On this page" className="hidden lg:block">
          <div className="sticky top-24">
            <p className="text-[0.8125rem] text-muted">On this page</p>
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

        <div className="min-w-0 max-w-3xl">
          <Section id="overview" title="What Detour predicts">
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
                  <span aria-hidden="true" className="tnum shrink-0 font-semibold text-muted">
                    {i + 1}.
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
            <p>
              Every number and every explanation sentence on screen is produced by deterministic code. A language model is used for three things only:
              pointing at the page elements a free-text task needs, proposing clearer wording for headings and unlabeled controls, and writing each planned
              fix as an edit to the page&apos;s own markup. It never produces a time. Each wording change is kept only if the deterministic model says it
              saves time, and each edit is validated, applied and re-checked on the fixed page.
            </p>
          </Section>

          <Section id="personas" title="Three personas">
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

          <Section id="klm" title="KLM operators">
            <p>
              The Keystroke-Level Model (Card, Moran &amp; Newell, 1980) prices a task by summing the time of primitive operators. Detour uses five of
              them. Values and ranges are in the parameter table below.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[30rem] border-collapse text-left text-[0.9375rem]">
                <caption className="sr-only">KLM operators used by Detour</caption>
                <thead>
                  <tr className="border-b border-rule-strong">
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
                    ["H", "Move a hand between keyboard and mouse", "mouse (steps that type text)"],
                    ["P", "Point at a target (fallback when geometry is missing)", "mouse"],
                  ].map(([op, m, u]) => (
                    <tr key={op} className="border-b border-rule">
                      <th scope="row" className="py-2 pr-4 font-semibold">{op}</th>
                      <td className="py-2 pr-4">{m}</td>
                      <td className="py-2 pr-4 text-muted">{u}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="fitts" title="Fitts’s law for the mouse">
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

          <Section id="graph" title="Screen-reader navigation as shortest paths">
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
              matches brute force on random graphs and adding an edge never makes a task slower.
            </p>
          </Section>

          <Section id="mixture" title="Strategy mixture">
            <p>
              People do not all navigate the same way. For a screen-reader user, the strategies are jumping by headings, reading line by line, using
              find, jumping by landmarks, and tabbing. Detour computes a path for each and weights them by how often users report choosing them when
              looking for information on a long page.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[26rem] border-collapse text-left text-[0.9375rem]">
                <caption className="sr-only">Screen-reader strategy shares</caption>
                <thead>
                  <tr className="border-b border-rule-strong">
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

          <Section id="scent" title="Realistic heading search">
            <p>
              The shortest path assumes the listener already knows which heading holds the answer. Real listeners judge each heading by its words
              (information scent: Pirolli &amp; Card, 1999), open the section if it smells right, back out of it if it does not, and press H again.
              Detour models this as an absorbing Markov chain over the page’s headings (in the spirit of SNIF-ACT: Fu &amp; Pirolli, 2007) and solves it
              exactly for the expected seconds.
            </p>
            <Formula label="expected time equals N times c, where N is the inverse of the identity minus Q">
              t = N · c, &nbsp; N = (I − Q)<sup>−1</sup>
            </Formula>
            <p>
              Scent is how well a heading’s words overlap with the task wording, scored by a deterministic function (stemmed word overlap plus a
              small hand-written synonym table for these demo domains), with no language model in the loop. The chance of opening a section is a logistic function of scent. The panel appears when the realistic time
              is more than {SEARCH_MIN_RATIO}× the best case. The thresholds below are <strong>modelling assumptions</strong>, not measurements, so read
              the gap between “best case” and “realistic” as a risk indicator rather than a forecast.
            </p>
            <p>
              This is also how wording suggestions are checked. When Claude proposes a new heading text, the same chain is re-solved with that text and
              the change is kept only if the realistic time drops. Changes that make it worse are shown as rejected.
            </p>
          </Section>

          <Section id="montecarlo" title="Monte Carlo intervals">
            <p>
              A single number would be false precision. Each parameter has a plausible range from the literature, with a distribution (uniform,
              triangular or log-normal). Detour draws every parameter and a strategy for each sample, re-costs each strategy’s path under those
              parameters (the path itself is chosen once at the nominal values, for speed), and reports the 5th to 95th percentile as a{" "}
              <strong>90% interval</strong>, shown as “52 s, 90% interval 38–71 s”.
            </p>
            <p>
              Sampling is seeded, so a result is reproducible. The interval reflects <em>parameter and strategy uncertainty</em>. It does not include
              error in the model itself (see limitations).
            </p>
          </Section>

          <Section id="optimiser" title="The optimiser: greedy, certified by exhaustive search">
            <p>
              Candidate fixes are small code changes: add a skip link, promote a styled heading to a real heading, wrap a region in a landmark, name an
              unlabelled control, turn a clickable div into a button, drop a positive tabindex. Each is a deterministic transform of the page model with
              an HTML before/after.
            </p>
            <Formula label="objective equals the sum over tasks of keyboard seconds plus screen reader seconds, with 300 seconds for a blocked persona">
              objective = Σ<sub>tasks</sub> ( t<sub>keyboard</sub> + t<sub>screen reader</sub> ) &nbsp;·&nbsp; blocked = {BLOCKED_PENALTY_SECONDS} s
            </Formula>
            <p>
              The optimiser is plain greedy: each round it re-measures every remaining candidate on top of the fixes already chosen and adds the one
              with the largest drop in the objective, so fixes that only pay off together (a skip link is worth little until the size picker is
              reachable) are still found. Greedy is not guaranteed optimal, so for k ≤ 3 Detour also searches every set of up to k fixes drawn from a
              pool and reports the gap. The pool is all candidates when there are at most {EXHAUSTIVE_ALL_MAX}; otherwise it is the union of the top{" "}
              {EXHAUSTIVE_TOP_PER_ROUND} candidates by marginal gain in each of the first three greedy rounds plus the greedy picks. “Certified optimal
              among all sets of up to 3 fixes of the 11 most promising candidates (gap 0.0 s)” therefore means greedy matched the best set in that pool.
              It is a certificate for the pool, not for every possible combination of a larger candidate list.
            </p>
          </Section>

          <Section id="fix" title="Fix the page, then re-check it">
            <p>
              The plan is a prediction on the page model. <strong>Fix this page</strong> makes it real on the page you chose. One AI agent per planned fix
              runs in parallel on the fast Claude tier. Each agent sees the target element’s actual markup, its parent, what a screen reader hears around
              it and a few computed styles, and writes the edit as a short list of operations. It keeps the original element where it can (a real
              button goes inside a clickable div, so the page’s own click handler still fires) and adds scoped CSS so the page looks the same.
            </p>
            <p>
              Every edit is validated twice, on the server and again in the browser. Selectors must point at the fix’s own targets. Scripts, frames,
              event handlers, dangerous links and CSS that loads anything are refused. Attributes come from an allow-list. A rejected edit is tried once
              more with the reasons; without keys, or after a second failure, a deterministic template edit for the same fix is used and labelled as
              such.
            </p>
            <p>
              Detour then applies the edits in plan order, reads the patched page again and times every person again. A fix is proven when everyone
              the plan unblocked can finish and every time is within half a second of the prediction or better. If not, its edit is undone and the agent
              gets one retry, with Detour’s own sentence on what is still wrong. Finally every element’s box is compared before and after, so a fix that
              moves anything for sighted users is listed. The times after a fix are still this model’s times, now computed on the patched page: they are
              re-checked on the fixed page, not measured.
            </p>
          </Section>

          <Section id="llm" title="What the language model does, and does not do">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="card p-5">
                <h3 className="h-card">Does</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.9375rem]">
                  <li>Maps a free-text task to elements on the page.</li>
                  <li>Proposes clearer wording for vague headings and names for unlabeled controls.</li>
                  <li>Writes the markup edit for each fix the optimiser chose, against the element’s real markup.</li>
                  <li>Every output is validated: task targets must exist and be actionable (one retry), a heading rename is kept only if the scent model says it saves time, and an edit is sanitised and then re-checked on the fixed page.</li>
                  <li>Falls back to hand-pinned fixture tasks and rule-based wording when there is no key, so the demo never depends on it.</li>
                </ul>
              </div>
              <div className="card p-5">
                <h3 className="h-card">Does not</h3>
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[0.9375rem]">
                  <li>Produce any time, interval or percentage.</li>
                  <li>Choose or rank the fixes in the plan: the optimiser does.</li>
                  <li>Decide whether its own suggestion or edit is good: the scent model and the re-check do.</li>
                  <li>Write the explanations: those sentences come from a deterministic printer.</li>
                </ul>
              </div>
            </div>
          </Section>

          <Section id="parameters" title="Parameters and sources">
            <p>
              Everything the engine assumes is in one file, <code className="text-[0.9em]">lib/params/literature.ts</code>. This table is
              rendered from it, so it cannot drift from the code.
            </p>
            <div className="overflow-x-auto rounded-lg border border-rule bg-surface">
              <table className="w-full min-w-[46rem] border-collapse text-left text-sm">
                <caption className="sr-only">Human-performance parameters used by the model, with value, range, unit and source</caption>
                <thead>
                  <tr className="border-b border-rule-strong">
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
                      <th scope="row" className="px-3 py-2.5 font-medium">
                        {name}
                        {note && <span className="block text-[0.8125rem] font-normal text-muted">{note}</span>}
                        {isAssumption(r) && <span className="mt-1 inline-block rounded bg-paper-2 px-1.5 py-0.5 text-[0.8125rem] font-medium">modelling assumption</span>}
                      </th>
                      <td className="tnum px-3 py-2.5 font-medium">{fmt(r.value)}</td>
                      <td className="tnum px-3 py-2.5">
                        {fmt(r.low)}–{fmt(r.high)} <span className="text-[0.8125rem] text-muted">({r.dist})</span>
                      </td>
                      <td className="px-3 py-2.5">{r.unit}</td>
                      <td className="px-3 py-2.5 text-muted">{r.source}</td>
                    </tr>
                  ))}
                  {FORAGING.map(({ name, value, note }) => (
                    <tr key={name} className="border-b border-rule align-top last:border-b-0">
                      <th scope="row" className="px-3 py-2.5 font-medium">
                        {name}
                        <span className="block text-[0.8125rem] font-normal text-muted">{note}</span>
                        <span className="mt-1 inline-block rounded bg-paper-2 px-1.5 py-0.5 text-[0.8125rem] font-medium">modelling assumption</span>
                      </th>
                      <td className="tnum px-3 py-2.5 font-medium">{fmt(value)}</td>
                      <td className="px-3 py-2.5 text-muted">fixed</td>
                      <td className="px-3 py-2.5">{name.startsWith("Enter") ? "per unit of scent" : "fraction"}</td>
                      <td className="px-3 py-2.5 text-muted">Chosen to give plausible behaviour in the SNIF-ACT style of foraging model (Fu &amp; Pirolli, 2007). Not fitted to data.</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section id="limits" title="Limitations, stated plainly">
            <ul className="list-disc space-y-2.5 pl-5">
              <li>
                <strong>It is a model, not a measurement.</strong> The intervals cover parameter and strategy uncertainty only. They do not cover error in
                the model structure. Treat times as relative costs that rank problems, not as forecasts for one person.
              </li>
              <li>
                <strong>Parameters are literature averages</strong> from studies of other populations and devices. Rows marked “modelling assumption” have
                no published measurement behind the nominal value or the range (for example the share of an announcement heard, and every heading-search
                threshold), and are the first thing to question.
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
                <strong>Fixes are patches, not guarantees.</strong> Gains are the model’s seconds. After Fix this page they are re-checked on the
                patched page, but they are still model seconds, and the fixed copy is the rendered page: the owner still makes the change in their
                own source and should review and test it. Some fixes can slow another task slightly; the per-task table shows this when it happens.
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
