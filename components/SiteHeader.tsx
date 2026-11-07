import Link from "next/link";
import { NavLinks } from "./NavLinks";
import { Wordmark } from "./Logo";

/** A plain bar: the wordmark, two links and one action. No rule, no glass, not sticky. */
export function SiteHeader() {
  return (
    <header className="mx-auto flex w-full max-w-[1360px] items-center justify-between gap-4 px-5 py-3 sm:px-8 sm:py-4">
      <Link href="/" aria-label="Detour, home" className="inline-flex min-h-11 items-center text-ink no-underline">
        <Wordmark />
      </Link>
      <div className="flex items-center gap-1 sm:gap-4">
        <nav aria-label="Primary">
          <NavLinks />
        </nav>
        <Link href="/analyze#url" className="btn !hidden !text-[length:var(--step-body)] sm:!inline-flex">
          Try your own page
        </Link>
      </div>
    </header>
  );
}
