import Link from "next/link";
import { ArrowRightIcon } from "@/components/icons";
import { HeroTeaser } from "@/components/home/HeroTeaser";

const FACTS = [
  {
    lead: "95%",
    text: "of home pages fail WCAG checks",
    cite: "WebAIM Million",
  },
  {
    lead: "Which?",
    text: "Audits don’t say which failures cost people the most time",
  },
  {
    lead: "Rare",
    text: "User studies with disabled participants are slow and rare",
  },
];

const STEPS = [
  {
    title: "Extract the accessibility tree",
    body: "Load the real page, read roles, names, focus order, headings and landmarks the way assistive technology does.",
  },
  {
    title: "Model each persona",
    detail: "KLM-GOMS, Fitts, screen-reader shortest paths",
    body: "A mouse user, a keyboard-only user and a screen-reader user each get a cost model built from published human-performance research.",
  },
  {
    title: "Measure with uncertainty",
    body: "Monte Carlo over the literature’s parameter ranges turns one guess into a 90% interval, so every time is a range you can trust.",
  },
  {
    title: "Plan the smallest fix set",
    body: "Re-measure after each candidate code fix, keep the few that win the most seconds, and certify the choice against exhaustive search.",
  },
];

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section aria-labelledby="hero-h" className="mx-auto grid w-full max-w-[1360px] items-center gap-12 px-5 pb-16 pt-12 sm:px-8 sm:pt-16 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14 lg:pb-24 lg:pt-20">
        <div className="rise-in">
          <p className="eyebrow">Detour · accessibility, with a stopwatch</p>
          <h1 id="hero-h" className="display mt-5 text-[2.9rem] sm:text-6xl lg:text-[4.6rem]">
            Accessibility, measured in <span className="mark">seconds.</span>
          </h1>
          <p className="lede mt-6 max-w-xl">
            Audits list violations. Detour shows the time they cost real people, and the smallest fix that wins it back.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-4">
            <Link href="/analyze" className="btn btn-primary !min-h-12 !px-6 text-base">
              Analyze a page <ArrowRightIcon size={18} />
            </Link>
            <Link href="/method" className="btn !min-h-12 !px-6 text-base">
              How the model works
            </Link>
          </div>
        </div>
        <div className="rise-in [animation-delay:150ms]">
          <HeroTeaser />
        </div>
      </section>

      {/* The problem */}
      <section aria-labelledby="problem-h" className="border-y border-rule bg-paper-2">
        <div className="mx-auto w-full max-w-[1360px] px-5 py-16 sm:px-8 lg:py-20">
          <p className="eyebrow">The problem</p>
          <h2 id="problem-h" className="h-section mt-3 max-w-2xl">
            We know pages are broken. We don’t know what it costs.
          </h2>
          <ul className="mt-10 grid gap-5 md:grid-cols-3">
            {FACTS.map((f, i) => (
              <li key={f.lead} className="card flex flex-col p-6 sm:p-7">
                <span className="eyebrow">0{i + 1}</span>
                <span className="display mt-4 text-5xl sm:text-6xl">{f.lead}</span>
                <p className="mt-4 text-lg leading-snug">
                  {f.text}
                  {f.cite && (
                    <>
                      {" "}
                      <span className="text-muted">({f.cite})</span>
                    </>
                  )}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* How it works */}
      <section aria-labelledby="how-h" className="mx-auto w-full max-w-[1360px] px-5 py-16 sm:px-8 lg:py-24">
        <p className="eyebrow">How it works</p>
        <h2 id="how-h" className="h-section mt-3 max-w-2xl">
          From a page to a plan, in four steps
        </h2>
        <ol className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.title} className="relative">
              <span className="grid size-12 place-items-center rounded-full bg-ink font-serif text-xl font-bold text-lime" aria-hidden="true">
                {i + 1}
              </span>
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="absolute left-14 top-6 hidden h-px w-[calc(100%-3.5rem+2rem)] bg-ink/25 lg:block" />
              )}
              <h3 className="h-card mt-5">
                <span className="sr-only">Step {i + 1}: </span>
                {s.title}
              </h3>
              {s.detail && <p className="mt-1 font-mono text-xs text-muted">{s.detail}</p>}
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section aria-labelledby="cta-h" className="mx-auto w-full max-w-[1360px] px-5 sm:px-8">
        <div className="on-ink flex flex-wrap items-center justify-between gap-8 rounded-3xl bg-ink px-7 py-10 text-paper sm:px-12 sm:py-14">
          <div className="max-w-xl">
            <h2 id="cta-h" className="h-section">
              Race three people through <span className="mark">your</span> page.
            </h2>
            <p className="mt-3 text-[#b8c0cc]">Pick a page, pick a task, watch the seconds add up, then hear what a screen-reader user hears.</p>
          </div>
          <Link href="/analyze" className="btn btn-primary !min-h-12 !px-6 text-base !text-ink">
            Open the workbench <ArrowRightIcon size={18} />
          </Link>
        </div>
      </section>
    </>
  );
}
