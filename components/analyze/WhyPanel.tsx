import { PersonaIcon } from "@/components/icons";
import type { PersonaId, TaskResult } from "@/lib/contracts";
import { fmtSeconds } from "@/lib/ui/format";
import { PERSONA_BY_ID, STRATEGY_LABEL } from "@/lib/ui/personas";

const PREFIXES: Array<[RegExp, PersonaId]> = [
  [/^Mouse:\s*/, "mouse"],
  [/^Keyboard:\s*/, "keyboard"],
  [/^Screen reader:\s*/, "screenreader"],
];

function Sentence({ text }: { text: string }) {
  for (const [re, persona] of PREFIXES) {
    if (re.test(text)) {
      const meta = PERSONA_BY_ID[persona];
      return (
        <>
          <span
            className="mr-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 align-middle text-xs font-bold"
            style={{ background: meta.tint, color: meta.color }}
          >
            <PersonaIcon persona={persona} size={12} />
            {meta.label}
          </span>
          {text.replace(re, "")}
        </>
      );
    }
  }
  return <>{text}</>;
}

export function WhyPanel({ result }: { result: TaskResult }) {
  const sr = result.personas.screenreader;
  const rows = [...sr.strategies].sort((a, b) => (sr.weights[b.strategy] ?? 0) - (sr.weights[a.strategy] ?? 0));
  return (
    <section aria-labelledby="why-h" className="card p-5 sm:p-6">
      <p className="eyebrow">Why</p>
      <h2 id="why-h" className="h-card mt-1.5">
        Where the seconds go
      </h2>
      <ul className="mt-4 space-y-3 text-[0.9375rem] leading-relaxed">
        {result.explanation.map((s, i) => (
          <li key={i} className="border-l-2 border-ink pl-3">
            <Sentence text={s} />
          </li>
        ))}
      </ul>

      <h3 className="mt-6 text-sm font-bold">Screen-reader strategy mix</h3>
      <p className="mt-0.5 text-xs text-muted">
        The prediction weighs each way people navigate. Strategies that cannot finish are left out and the rest renormalised.
      </p>
      <table className="mt-2 w-full text-sm">
        <caption className="sr-only">Screen-reader strategies, their share of users and their time for this task</caption>
        <thead>
          <tr className="text-left text-xs text-muted">
            <th scope="col" className="py-1 pr-2 font-semibold">Strategy</th>
            <th scope="col" className="py-1 pr-2 font-semibold">Share</th>
            <th scope="col" className="py-1 text-right font-semibold">Time</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((s) => {
            const w = sr.weights[s.strategy] ?? 0;
            return (
              <tr key={s.strategy} className="border-t border-rule/70">
                <th scope="row" className="py-1.5 pr-2 text-left font-medium">
                  {STRATEGY_LABEL[s.strategy]}
                  {s.strategy === sr.representative && <span className="ml-1.5 rounded bg-lime px-1.5 py-px text-[0.6875rem] font-bold">animated</span>}
                </th>
                <td className="py-1.5 pr-2">
                  <span className="flex items-center gap-2">
                    <span aria-hidden="true" className="h-2 w-16 overflow-hidden rounded-full bg-paper-2">
                      <span className="pattern-screenreader block h-full" style={{ width: `${Math.round(w * 100)}%` }} />
                    </span>
                    <span className="tnum">{Math.round(w * 100)}%</span>
                  </span>
                </td>
                <td className="tnum py-1.5 text-right">{s.blocked ? "Can’t finish" : fmtSeconds(s.seconds)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}
