import type { PersonaId, Task, TaskResult } from "@/lib/contracts";
import { compareTask } from "@/lib/ui/compare";
import { PERSONAS } from "@/lib/ui/personas";
import { PERSONA_ORDER } from "@/lib/ui/timeline";
import { Headline, changeText, predictedText } from "./Strip";

/** The table behind the disclosure: every task, every person, before and after, with the plan's prediction. */
export function EveryTask({ tasks, before, after, predicted }: { tasks: Task[]; before: TaskResult[]; after: TaskResult[]; predicted: TaskResult[] | null }) {
  return (
    <div role="region" aria-label="Every task, before and after (scrolls sideways)" tabIndex={0} className="-m-3 overflow-x-auto p-3">
      <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
        <caption className="sr-only">Time for each task and person before the fixes and re-checked on the fixed page, with the predicted time</caption>
        <thead>
          <tr className="border-b border-rule-strong text-xs">
            <th scope="col" className="py-2 pr-3 font-medium text-muted">
              Task
            </th>
            {PERSONAS.map((p) => (
              <th key={p.id} scope="col" className="py-2 pl-3 text-right font-medium">
                {p.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const b = before.find((r) => r.taskId === t.id);
            const a = after.find((r) => r.taskId === t.id);
            if (!b || !a) return null;
            const ds = compareTask(b, a);
            const pr = predicted?.find((r) => r.taskId === t.id);
            return (
              <tr key={t.id} className="border-b border-rule align-top">
                <th scope="row" className="py-2.5 pr-3 font-medium">
                  {t.label}
                </th>
                {PERSONA_ORDER.map((pid: PersonaId) => {
                  const d = ds.find((x) => x.persona === pid)!;
                  const pred = predictedText(pr?.personas[pid]);
                  return (
                    <td key={pid} className="tnum py-2.5 pl-3 text-right">
                      <span className="flex items-baseline justify-end gap-x-1.5 whitespace-nowrap font-medium">
                        <Headline d={d} small />
                      </span>
                      {pred && <span className="block whitespace-nowrap text-xs text-muted">{pred}</span>}
                      <span className="block text-xs text-muted">{changeText(d)}</span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
