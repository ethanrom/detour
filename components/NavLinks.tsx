"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/analyze", label: "Analyze" },
  { href: "/method", label: "Method" },
] as const;

/** Plain text links. The current page is marked with aria-current and shown by weight plus an underline, not a pill. */
export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1 sm:gap-3">
      {LINKS.map((l) => {
        const current = pathname.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center px-2 text-[length:var(--step-body)] text-ink underline decoration-2 underline-offset-[0.35em] transition-[text-decoration-color] duration-150 sm:px-3 ${
                current ? "font-semibold decoration-current" : "font-medium decoration-transparent hover:decoration-current"
              }`}
            >
              {l.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
