import { CrossIcon, PersonaIcon } from "@/components/icons";
import type { PersonaId } from "@/lib/contracts";

/**
 * Three-lane teaser. Pure CSS: each marker runs along a shared time axis once, then rests on the final
 * state. Under prefers-reduced-motion the animations collapse to their last frame (see globals.css), so the
 * resting state IS the reduced-motion state. Illustration with sample numbers, hence the caption.
 */

interface LaneSpec {
  id: PersonaId;
  label: string;
  /** Lighter variants of the persona colours so text and shapes read on ink. */
  color: string;
  end: string;
  dur: string;
  result: string;
  blocked?: boolean;
  shape: "circle" | "square" | "diamond";
  ticks: number;
}

const LANES: LaneSpec[] = [
  { id: "mouse", label: "Mouse", color: "#5bb5ea", end: "8.3%", dur: "0.7s", result: "4.3 s", shape: "circle", ticks: 4 },
  { id: "keyboard", label: "Keyboard", color: "#f2a65a", end: "44%", dur: "3.2s", result: "Can’t finish", blocked: true, shape: "square", ticks: 22 },
  { id: "screenreader", label: "Screen reader", color: "#43d6aa", end: "100%", dur: "7s", result: "52 s", shape: "diamond", ticks: 48 },
];

function Shape({ shape, color }: { shape: LaneSpec["shape"]; color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="block">
      {shape === "circle" && <circle cx="10" cy="10" r="8" fill={color} stroke="#0d1522" strokeWidth="2.5" />}
      {shape === "square" && <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" fill={color} stroke="#0d1522" strokeWidth="2.5" />}
      {shape === "diamond" && <path d="M10 1.2 18.8 10 10 18.8 1.2 10z" fill={color} stroke="#0d1522" strokeWidth="2.5" strokeLinejoin="round" />}
    </svg>
  );
}

export function HeroTeaser() {
  return (
    <figure
      role="img"
      aria-label="Example: for the same task, a mouse user needs 4.3 seconds, a keyboard-only user cannot finish, and a screen-reader user needs 52 seconds."
      className="on-ink m-0 rounded-3xl bg-ink p-5 text-paper shadow-[8px_8px_0_var(--lime)] sm:p-7"
    >
      <div aria-hidden="true">
        <p className="eyebrow !text-[#b8c0cc]">Example task · sample page</p>
        <p className="mt-2 font-serif text-xl font-bold leading-snug sm:text-2xl">Add the Trail Jacket in size M to the cart</p>

        <div className="mt-6 space-y-5">
          {LANES.map((l) => (
            <div key={l.id}>
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="flex items-center gap-2 font-semibold" style={{ color: l.color }}>
                  <PersonaIcon persona={l.id} size={18} />
                  {l.label}
                </span>
                <span
                  className="tnum flex items-center gap-1.5 text-lg font-bold"
                  style={{ color: l.blocked ? "#ff8a8a" : l.color, animation: `teaser-fade 0.35s ease-out ${l.dur} both` }}
                >
                  {l.blocked && <CrossIcon size={16} />}
                  {l.result}
                </span>
              </div>
              <div className="relative mt-2 h-8 rounded-full bg-ink-2">
                <div className="absolute inset-x-3 top-1/2 h-px bg-white/15" />
                {Array.from({ length: l.ticks }, (_, i) => (
                  <span
                    key={i}
                    className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-white/35"
                    style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${((i + 0.5) / l.ticks) * (parseFloat(l.end) / 100)})` }}
                  />
                ))}
                <div className="absolute inset-y-0 left-3 right-3">
                  <span
                    className="absolute left-0 top-1/2 h-2.5 -translate-y-1/2 rounded-full"
                    style={
                      {
                        background: l.color,
                        opacity: 0.85,
                        "--end": l.end,
                        animation: `teaser-w ${l.dur} linear 0.4s both`,
                      } as React.CSSProperties
                    }
                  />
                  <span
                    className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2"
                    style={{ "--end": l.end, animation: `teaser-x ${l.dur} linear 0.4s both` } as React.CSSProperties}
                  >
                    <Shape shape={l.shape} color={l.color} />
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-5 text-xs text-[#b8c0cc]">Illustration with sample numbers. Lanes share one time axis.</p>
      </div>
    </figure>
  );
}
