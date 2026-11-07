import { PersonaIcon } from "@/components/icons";
import { Chip } from "@/components/workspace/ui";
import type { ChipView } from "@/lib/ui/fix-run";
import { PERSONA_BY_ID } from "@/lib/ui/personas";

/** "Keyboard: can't finish → 4.4 s (predicted 4.4 s)", one chip per person the fix touched. */
export function ReCheckedChips({ chips, manyTasks, labels }: { chips: ChipView[]; manyTasks: boolean; labels: Record<string, string> }) {
  return (
    <ul aria-label="Re-checked on the fixed page" className="space-y-1">
      {chips.map((c) => {
        const blocked = c.to === "can’t finish";
        const task = labels[c.taskId] ?? c.taskId;
        return (
          <li key={c.persona} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
            <Chip tone={blocked ? "blocked" : c.persona}>
              <PersonaIcon persona={c.persona} size={12} />
              <span>{PERSONA_BY_ID[c.persona].label}:</span>
              <span>
                {c.from} <span aria-hidden="true">→</span>
                <span className="sr-only"> became </span> {c.to}
              </span>
              <span className="font-normal text-muted">(predicted {c.predicted})</span>
            </Chip>
            {/* With several tasks on the page, say which one this chip is about: beside the chip when there is room,
                under it when there is not. Cut short on screen, whole for a reader. */}
            {manyTasks && (
              <span className="min-w-[8rem] max-w-full flex-1 truncate text-xs text-muted" title={task}>
                {task}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
