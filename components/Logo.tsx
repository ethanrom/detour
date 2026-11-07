/** Detour mark: a path that bends around an obstacle. Decorative; the wordmark carries the name. */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect width="32" height="32" fill="#1F3038" />
      <path
        d="M8 25V15a5 5 0 0 1 5-5h9"
        fill="none"
        stroke="#FFFFFF"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M19 5.5 24.5 10 19 14.5" fill="none" stroke="#FFFFFF" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <LogoMark />
      <span className="text-[length:var(--step-lead)] font-semibold leading-none tracking-[-0.03em]">Detour</span>
    </span>
  );
}
