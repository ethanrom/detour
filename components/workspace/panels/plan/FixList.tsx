"use client";

import type { FixPlan, TaskResult } from "@/lib/contracts";
import { fixImpacts } from "@/lib/ui/compare";
import { Chip, Row } from "../../ui";
import { fixMeta, impactChips } from "./summary";

/** The chosen fixes, best first: the title, a kind and WCAG line, and the outcome the plan predicts. */
export function FixList({ plan, baseline }: { plan: FixPlan; baseline: TaskResult[] }) {
  const impacts = fixImpacts(plan, baseline);
  return (
    <ol aria-label="Chosen fixes, best first" className="divide-y divide-rule">
      {plan.chosen.map((fix) => (
        <li key={fix.id}>
          <Row
            className="px-0!"
            title={
              <span className="line-clamp-2" title={fix.title}>
                {fix.title}
              </span>
            }
            meta={fixMeta(fix)}
            trail={impactChips(impacts.find((i) => i.fixId === fix.id)).map((c) => (
              <Chip key={c.text} tone={c.tone} title={c.detail}>
                {c.text}
                {c.detail && <span className="sr-only"> predicted</span>}
              </Chip>
            ))}
          />
        </li>
      ))}
    </ol>
  );
}
