import type { PersonaId } from "@/lib/contracts";
import type { MarkerShape } from "@/lib/ui/personas";

interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true as const,
  focusable: false as const,
});

export function MouseIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M5.5 3.2 18.8 11l-5.9 1.6-2.3 5.9z" />
    </svg>
  );
}

export function KeyboardIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <rect x="2.5" y="6" width="19" height="12" rx="2.5" />
      <path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" />
    </svg>
  );
}

export function EarIcon({ size = 22, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 2.6-1.6 3.7-2.8 4.9-.9.9-1.2 1.7-1.2 2.6a2.5 2.5 0 0 1-4.7 1.2" />
      <path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1-.6 1.5-1.2 2" />
    </svg>
  );
}

export function PersonaIcon({ persona, size, className }: { persona: PersonaId } & IconProps) {
  if (persona === "mouse") return <MouseIcon size={size} className={className} />;
  if (persona === "keyboard") return <KeyboardIcon size={size} className={className} />;
  return <EarIcon size={size} className={className} />;
}

export function PlayIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" stroke="none">
      <path d="M7 4.5v15a1 1 0 0 0 1.5.86l12.4-7.5a1 1 0 0 0 0-1.72L8.5 3.64A1 1 0 0 0 7 4.5z" />
    </svg>
  );
}

export function PauseIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" stroke="none">
      <rect x="6" y="4.5" width="4.2" height="15" rx="1.2" />
      <rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
    </svg>
  );
}

export function ReplayIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4.5v4.3h4.3" />
    </svg>
  );
}

export function SpeakerIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M4 9.5v5h3.5l5 4v-13l-5 4z" fill="currentColor" />
      <path d="M16 8.5a5 5 0 0 1 0 7M18.8 6a8.5 8.5 0 0 1 0 12" />
    </svg>
  );
}

export function StopIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} fill="currentColor" stroke="none">
      <rect x="5.5" y="5.5" width="13" height="13" rx="2.2" />
    </svg>
  );
}

export function CheckIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.8}>
      <path d="m4.5 12.5 5 5 10-11" />
    </svg>
  );
}

export function CrossIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.8}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 18, className }: IconProps) {
  return (
    <svg {...base(size)} className={className} strokeWidth={2.4}>
      <path d="M4.5 12h15M13.5 5.5 20 12l-6.5 6.5" />
    </svg>
  );
}

export function ExternalIcon({ size = 14, className }: IconProps) {
  return (
    <svg {...base(size)} className={className}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </svg>
  );
}

/** Race marker: circle (mouse), square (keyboard), diamond (screen reader). Shape carries identity as well as colour. */
export function MarkerShapeSvg({ shape, size = 20, fill, stroke = "#fff" }: { shape: MarkerShape; size?: number; fill: string; stroke?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" aria-hidden="true" focusable="false" style={{ display: "block", overflow: "visible" }}>
      {shape === "circle" && <circle cx="10" cy="10" r="8" fill={fill} stroke={stroke} strokeWidth="2.5" />}
      {shape === "square" && <rect x="2.5" y="2.5" width="15" height="15" rx="2.5" fill={fill} stroke={stroke} strokeWidth="2.5" />}
      {shape === "diamond" && <path d="M10 1.2 18.8 10 10 18.8 1.2 10z" fill={fill} stroke={stroke} strokeWidth="2.5" strokeLinejoin="round" />}
    </svg>
  );
}
