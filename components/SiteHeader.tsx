import Link from "next/link";
import { NavLinks } from "./NavLinks";
import { Wordmark } from "./Logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-rule bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
      <div className="mx-auto flex h-16 w-full max-w-[1360px] items-center justify-between gap-4 px-5 sm:px-8">
        <Link href="/" aria-label="Detour, home" className="rounded-md text-ink no-underline">
          <Wordmark />
        </Link>
        <nav aria-label="Primary">
          <NavLinks />
        </nav>
      </div>
    </header>
  );
}
