"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/", label: "Home" },
  { href: "/analyze", label: "Analyze" },
  { href: "/method", label: "Method" },
] as const;

export function NavLinks() {
  const pathname = usePathname();
  return (
    <ul className="flex items-center gap-1 text-[0.9375rem]">
      {LINKS.map((l) => {
        const current = l.href === "/" ? pathname === "/" : pathname.startsWith(l.href);
        return (
          <li key={l.href}>
            <Link
              href={l.href}
              aria-current={current ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full px-3.5 font-semibold no-underline transition-colors hover:bg-paper-2 ${
                current ? "bg-ink text-paper hover:bg-ink" : "text-ink"
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
