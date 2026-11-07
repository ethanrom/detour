"use client";

import type { PageModel } from "@/lib/contracts";
import type { RepairReport } from "@/lib/repair/types";
import type { RenameStory } from "@/lib/ui/rename-story";
import { Capped, Disclosure, Row } from "../../ui";
import { searchStoryLine, wordingCounts, wordingItems } from "./summary";

/**
 * One row for all the verified wording: "1 heading rename, 15 labels · applied when you fix the page". The LLM
 * proposed it and the scent model checked it. The list behind it shows five, then "Show all".
 */
export function WordingRow({ report, page, story, taskId }: { report: RepairReport | null | undefined; page: PageModel | null; story: RenameStory[] | null; taskId?: string }) {
  const counts = wordingCounts(report);
  if (!counts) return null;
  const items = wordingItems(report, page);
  const line = searchStoryLine(story, taskId);
  return (
    <Row className="px-0!" title="Verified wording" meta={`${counts} · applied when you fix the page`}>
      <div className="space-y-2">
        {line && <p className="tnum text-sm font-medium leading-5">{line}</p>}
        <Disclosure summary="Original → proposed">
          <Capped
            items={items}
            limit={5}
            listLabel="Wording changes, original and proposed"
            itemKey={(it) => it.key}
            render={(it) => (
              <p className="py-1.5 text-sm leading-5 [overflow-wrap:anywhere]">
                <span className="text-muted">{it.from}</span> <span aria-hidden="true">→</span>
                <span className="sr-only"> becomes </span> <span className="font-medium">{it.to}</span>
              </p>
            )}
          />
        </Disclosure>
      </div>
    </Row>
  );
}
