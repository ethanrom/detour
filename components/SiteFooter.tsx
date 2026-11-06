import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="on-ink mt-24 bg-ink text-paper">
      <div className="mx-auto grid w-full max-w-[1360px] gap-8 px-5 py-12 sm:px-8 md:grid-cols-[1.4fr_1fr_1fr]">
        <div>
          <p className="font-serif text-2xl font-bold tracking-tight">Detour</p>
          <p className="mt-3 max-w-md text-[0.9375rem] leading-relaxed text-[#b8c0cc]">
            Accessibility, measured in seconds. Every number comes from published human-performance models. A language
            model helps point at page elements and proposes clearer wording, and the model checks each suggestion. It never produces a time.
          </p>
        </div>
        <nav aria-label="Footer">
          <p className="eyebrow !text-[#b8c0cc]">Explore</p>
          <ul className="mt-4 space-y-1 text-[0.9375rem]">
            <li>
              <Link className="inline-flex min-h-8 items-center text-paper underline" href="/analyze">
                Analyze a page
              </Link>
            </li>
            <li>
              <Link className="inline-flex min-h-8 items-center text-paper underline" href="/method">
                How the model works
              </Link>
            </li>
          </ul>
        </nav>
        <div>
          <p className="eyebrow !text-[#b8c0cc]">Built to be accessible</p>
          <p className="mt-4 text-[0.9375rem] leading-relaxed text-paper">
            Designed to pass its own audit: WCAG 2.2 AA, keyboard first, reduced motion respected.
          </p>
        </div>
      </div>
    </footer>
  );
}
