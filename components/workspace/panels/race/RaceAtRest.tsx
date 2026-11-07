import { PersonaIcon } from "@/components/icons";
import { PERSONAS } from "@/lib/ui/personas";

/** The race before any task is run: the three people at the start line, with what to do next. */
export function RaceAtRest() {
  return (
    <div>
      <p className="text-xl font-semibold leading-7">Pick a task on the left.</p>
      <p className="mt-1 max-w-[60ch] text-sm leading-5 text-muted">
        Detour times a mouse user, a keyboard-only user and a blind screen-reader user doing it, on one clock, and says why anyone gets stuck.
      </p>
      <ul className="mt-6 divide-y divide-rule" aria-label="The three people">
        {PERSONAS.map((p) => (
          <li key={p.id} className="grid grid-cols-[9rem_minmax(0,1fr)] items-center gap-x-3 py-3">
            <span className="flex items-start gap-2">
              <PersonaIcon persona={p.id} size={16} className="mt-0.5 shrink-0" />
              <span>
                <span className="block text-sm font-semibold leading-5" style={{ color: p.color }}>
                  {p.label}
                </span>
                <span className="block text-xs leading-4 text-muted">{p.who}</span>
              </span>
            </span>
            <span aria-hidden="true" className="h-12 rounded-lg border border-rule bg-paper" />
          </li>
        ))}
      </ul>
    </div>
  );
}
