import type { CSSProperties } from "react";
import Link from "next/link";
import "./home.css";
import { Chip } from "@/components/home/Chip";
import { HeroRace } from "@/components/home/HeroRace";
import { LOOP, LOOP_SOURCE, durationText, loopIsMeasured } from "@/components/home/loop";
import { ProofCycle } from "@/components/home/ProofCycle";
import { RevealRoot } from "@/components/home/RevealRoot";
import { Switches } from "@/components/home/Switches";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/** Segment colours: flat steps of the palette, light to dark, ending on the one accent. */
const SEGMENT_FIELDS = [
  { bg: "var(--lime-deep)", fg: "var(--ink)" },
  { bg: "var(--rule-strong)", fg: "var(--ink)" },
  { bg: "var(--muted)", fg: "#ffffff" },
  { bg: "var(--ink-2)", fg: "#ffffff" },
  { bg: "var(--accent)", fg: "#ffffff" },
] as const;

export default function Home() {
  const measured = loopIsMeasured();

  return (
    <div className="home">
      {/* Hero: the sentence is the layout */}
      <section aria-labelledby="hero-h" className="hm-hero hm-wrap">
        <h1 id="hero-h" className="hm-display">
          <span className="hm-hl">Not everyone</span>{" "}
          <span className="hm-hl hm-hl2">
            <HeroRace /> <span>gets there.</span>
          </span>
        </h1>
        <div className="hm-hero-foot">
          <p className="hm-lede hm-load" style={{ "--d": "520ms" } as CSSProperties}>
            Detour times a mouse user, a keyboard-only user and a blind screen-reader user on any web page, then fixes
            what stops them and re-checks the fix.
          </p>
          <div className="hm-actions hm-load" style={{ "--d": "620ms" } as CSSProperties}>
            <Link href="/analyze#url" className="btn btn-accent hm-btn-lg">
              Try your own page
            </Link>
            <Link href="/analyze" className="hm-link">
              See the demo store
            </Link>
          </div>
        </div>
      </section>

      {/* Intro: a statement with inline frames */}
      <section aria-labelledby="cost-h" className="hm-sec">
        <h2 id="cost-h" className="sr-only">
          Why it matters
        </h2>
        <div className="hm-wrap">
          <p className="hm-stmt" data-reveal>
            95.9% of home pages fail an accessibility check. Detour counts what that costs people:{" "}
            <span className="nb">
              <Chip persona="mouse" order={0} /> 5 s
            </span>{" "}
            by{" "}
            <span className="nb">
              mouse, <Chip persona="keyboard" order={1} /> no
            </span>{" "}
            way through by{" "}
            <span className="nb">
              keyboard, <Chip persona="screenreader" order={2} /> 17 s
            </span>{" "}
            by&nbsp;screen&nbsp;reader.
          </p>
          <p className="hm-note" data-reveal style={stagger(1)}>
            WebAIM Million, 2026. Times are Detour’s predictions for the demo store task “Add the Trail Jacket in size M to
            the cart”.
          </p>
        </div>
      </section>

      {/* How it works: stages as one bar */}
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
                    {duration && <span className="loop-time">{duration}</span>}
                  </div>
                  <p className="loop-clause">{s.clause}</p>
                </li>
              );
            })}
          </ol>
          {measured && (
            <p className="hm-note hm-caption" data-reveal>
              {LOOP_SOURCE}
            </p>
          )}
        </div>
      </section>

      {/* Proof: names as one sentence */}
      <section aria-labelledby="proof-h" className="hm-sec hm-field">
        <div className="hm-wrap">
          <div data-reveal>
            <ProofCycle headingId="proof-h" />
          </div>
        </div>
      </section>

      {/* Features: sentences with switches */}
      <section aria-labelledby="switch-h" className="hm-sec hm-sec-switch">
        <div className="hm-wrap">
          <h2 id="switch-h" className="hm-h" data-reveal>
            Flip a fix, see the seconds
          </h2>
        </div>
        <Switches labelledBy="switch-h" />
        <div className="hm-wrap">
          <p className="hm-note hm-caption" data-reveal>
            Northwind demo store, predicted seconds. Fixes that only pay off together are why Detour plans them as a set.
          </p>
        </div>
      </section>

      {/* Call to action: a question at both edges */}
      <section aria-labelledby="cta-h" className="cta on-ink">
        <h2 id="cta-h" className="cta-h">
          <span data-reveal>Your page,</span>
          <span data-reveal style={stagger(1)}>
            or ours?
          </span>
        </h2>
        <div className="cta-row" data-reveal style={stagger(2)}>
          <div className="cta-buttons">
            <Link href="/analyze#url" className="btn hm-btn-xl hm-btn-light">
              Try your own page
            </Link>
            <span className="cta-or">or</span>
            <Link href="/analyze" className="btn hm-btn-xl hm-btn-line">
              Open the demo store
            </Link>
          </div>
          <p className="cta-note">Either way, every number is worked out in your browser, and the AI never writes one.</p>
        </div>
      </section>

      <RevealRoot />
    </div>
  );
}
