import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import "./home.css";
import { HeroRace } from "@/components/home/HeroRace";
import { LOOP, LOOP_SOURCE, durationText, loopIsMeasured } from "@/components/home/loop";
import { RevealRoot } from "@/components/home/RevealRoot";
import { UrlForm } from "@/components/home/UrlForm";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;
const delay = (ms: number) => ({ "--d": `${ms}ms` }) as CSSProperties;

const DEMOS = [
  { name: "Northwind outdoor store", href: "/analyze?site=northwind" },
  { name: "Riverside food assistance", href: "/analyze?site=riverside" },
  { name: "Alpine (well built)", href: "/analyze?site=alpine" },
] as const;

interface Found {
  name: string;
  finding: ReactNode;
  result: ReactNode;
  href: string;
}

/** Facts only, from the README: what Detour found on three real runs. */
const FOUND: readonly Found[] = [
  {
    name: "Northwind outdoor store",
    finding: (
      <>
        The size picker is a clickable <code>&lt;div&gt;</code>.
      </>
    ),
    result: (
      <>
        Keyboard: can’t finish → <span className="nb">4.4 s</span> after the fix
      </>
    ),
    href: "/analyze?site=northwind",
  },
  {
    name: "Hacker News",
    finding: "The logo link has no name.",
    result: "Claude labelled it “Hacker News”; proven",
    href: `/analyze?url=${encodeURIComponent("https://news.ycombinator.com")}`,
  },
  {
    name: "Riverside food assistance",
    finding: "The income limits sit under “More information”.",
    result: (
      <>
        Screen-reader search <span className="nb">160 s</span> → <span className="nb">42 s</span> with a clearer heading
      </>
    ),
    href: "/analyze?site=riverside",
  },
];

/** Segment colours: flat steps of the palette, light to dark. The page's one accent stays on the Analyze button. */
const SEGMENT_FIELDS = [
  { bg: "var(--lime-deep)", fg: "var(--ink)" },
  { bg: "var(--rule-strong)", fg: "var(--ink)" },
  { bg: "var(--muted)", fg: "#ffffff" },
  { bg: "var(--ink-2)", fg: "#ffffff" },
  { bg: "var(--ink)", fg: "#ffffff" },
] as const;

export default function Home() {
  const measured = loopIsMeasured();

  return (
    <div className="home">
      {/* Hero: the sentence is the layout, then the one thing to do */}
      <section aria-labelledby="hero-h" className="hm-hero hm-wrap">
        <h1 id="hero-h" className="hm-display">
          <span className="hm-hl">Not everyone</span>{" "}
          <span className="hm-hl hm-hl2">
            <HeroRace /> <span>gets there.</span>
          </span>
        </h1>
        <div className="hm-hero-foot">
          <p className="hm-lede hm-load" style={delay(480)}>
            Detour times a mouse user, a keyboard-only user and a blind screen-reader user on any web page, then fixes what
            stops them and re-checks the fix.
          </p>
          <div className="hm-load" style={delay(600)}>
            <UrlForm />
            <div className="hm-demos">
              <span id="demos-l">Or open a demo:</span>
              <ul aria-labelledby="demos-l">
                {DEMOS.map((d) => (
                  <li key={d.href}>
                    <Link href={d.href} className="hm-link">
                      {d.name}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Strip one: three results as rows */}
      <section aria-labelledby="found-h" className="hm-sec">
        <div className="hm-wrap">
          <h2 id="found-h" className="hm-h" data-reveal>
            What it found
          </h2>
          <ul className="found">
            {FOUND.map((f, i) => (
              <li key={f.name} className="found-row" data-reveal style={stagger(i + 1)}>
                <h3 className="found-name">{f.name}</h3>
                <p className="found-text">{f.finding}</p>
                <div className="found-side">
                  <p className="found-result tnum">{f.result}</p>
                  <Link href={f.href} className="hm-link">
                    <span>
                      Open in Analyze<span className="sr-only"> for {f.name}</span>
                    </span>
                    <span aria-hidden="true" className="hm-link-arrow">
                      →
                    </span>
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Strip two: the loop, with its measured seconds */}
      <section aria-labelledby="loop-h" className="hm-sec">
        <div className="hm-wrap">
          <h2 id="loop-h" className="hm-h" data-reveal>
            From page to proof
          </h2>
          <ol className="loop" data-ui>
            {LOOP.map((s, i) => {
              const field = SEGMENT_FIELDS[i];
              const duration = durationText(s.seconds);
              return (
                <li
                  key={s.id}
                  className="loop-stage"
                  data-reveal
                  style={{ "--i": i, "--w": measured ? s.seconds : 1, "--bg": field.bg, "--fg": field.fg } as CSSProperties}
                >
                  <div className="loop-seg">
                    <span className="loop-label">{s.label}</span>
                    {duration && <span className="loop-time tnum">{duration}</span>}
                  </div>
                  <p className="loop-clause">{s.clause}</p>
                </li>
              );
            })}
          </ol>
          {measured && (
            <p className="hm-caption" data-reveal>
              {LOOP_SOURCE}
            </p>
          )}
          <p className="hm-method" data-reveal>
            AI writes the edits. Every second comes from published human-performance models: KLM, Fitts’s law and shortest
            paths over the accessibility tree.
          </p>
          <div data-reveal className="hm-method-link">
            <Link href="/method" className="hm-link">
              <span>Read the method</span>
              <span aria-hidden="true" className="hm-link-arrow">
                →
              </span>
            </Link>
          </div>
        </div>
      </section>

      <RevealRoot />
    </div>
  );
}
