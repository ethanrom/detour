import Link from "next/link";

/** One quiet line on the ground, under a 1px rule. No wordmark, no invitation, no second field of colour. */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto w-full max-w-[1360px] px-5 py-2 sm:px-8 sm:py-3">
        <p className="text-[0.8125rem] leading-[1.35] text-muted">
          Detour · Built for the CTRL-V hackathon, 2026 · MIT licence ·{" "}
          <Link href="/method" className="text-muted underline decoration-1 underline-offset-[0.25em] hover:text-ink">
            Method
          </Link>{" "}
          · Type: Switzer (Fontshare)
        </p>
      </div>
    </footer>
  );
}
