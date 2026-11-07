import type { CSSProperties } from "react";
import Link from "next/link";

const stagger = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * Invitation over a cropped name. The field is a step lighter than the call-to-action above it, so the two dark
 * fields read as two. The wordmark is pushed down by 30% of its own height and the footer's overflow crops it.
 */
export function SiteFooter() {
  return (
    <footer aria-labelledby="footer-h" className="on-ink relative overflow-hidden bg-ink-2 text-white">
      <div className="mx-auto w-full max-w-[1360px] px-5 pt-[clamp(4.5rem,9vw,8rem)] sm:px-8">
        <div className="grid gap-10 md:grid-cols-12">
          <div className="md:col-span-7">
            <h2 id="footer-h" data-reveal style={stagger(0)} className="display text-[length:var(--step-head)]">
              <span className="block">See who</span>
              <span className="block">gets stuck.</span>
            </h2>
            <div data-reveal style={stagger(1)} className="mt-8">
              <Link
                href="/analyze#url"
                className="btn min-h-14 px-7 text-[length:var(--step-body)] !border-white !bg-white !text-ink hover:!bg-paper-2"
              >
                Try your own page
              </Link>
            </div>
          </div>
          <nav aria-label="Footer" data-reveal style={stagger(2)} className="md:col-span-3 md:col-start-10">
            <ul className="space-y-1">
              <li>
                <Link
                  href="/analyze"
                  className="inline-flex min-h-11 items-center text-[length:var(--step-body)] text-white underline decoration-transparent decoration-2 underline-offset-[0.3em] transition-[text-decoration-color] duration-150 hover:decoration-current"
                >
                  Analyze
                </Link>
              </li>
              <li>
                <Link
                  href="/method"
                  className="inline-flex min-h-11 items-center text-[length:var(--step-body)] text-white underline decoration-transparent decoration-2 underline-offset-[0.3em] transition-[text-decoration-color] duration-150 hover:decoration-current"
                >
                  Method
                </Link>
              </li>
            </ul>
          </nav>
        </div>

        <div
          data-reveal
          style={stagger(3)}
          className="mt-[clamp(3.5rem,8vw,7rem)] flex flex-wrap justify-between gap-x-8 gap-y-1 text-[length:var(--step-small)] text-[#cdd7dc]"
        >
          <p>Built for the CTRL-V hackathon, 2026</p>
          <p>MIT licence · Type: Switzer (Fontshare)</p>
        </div>

        <p
          aria-hidden="true"
          className="-ml-[0.04em] translate-y-[30%] select-none whitespace-nowrap pt-4 text-[34vw] font-semibold leading-[0.8] tracking-[-0.05em] text-paper-2 md:text-[28vw]"
        >
          Detour
        </p>
      </div>
    </footer>
  );
}
