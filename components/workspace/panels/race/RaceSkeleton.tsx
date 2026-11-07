import { Bars } from "../../ui";
import { CARD_HEIGHT } from "./Card";

const block = "rounded bg-paper-2";

/**
 * The race at its real size, in flat grey (no spinner, no shimmer): the finding, an axis row, three 64px lanes,
 * the controls row and the two cards. Nothing moves when the real race lands.
 */
export function RaceSkeleton({ message }: { message: string }) {
  return (
    <div aria-busy="true">
      <p role="status" className="sr-only">
        {message}
      </p>
      <div aria-hidden="true">
        <div className={`h-7 w-3/4 ${block}`} />
        <div className="mt-1 h-5 w-1/2">
          <div className={`h-3.5 w-full ${block}`} />
        </div>

        <div className="mt-4">
          <div className="h-5" />
          <div className="divide-y divide-rule">
            {[0, 1, 2].map((i) => (
              <div key={i} className="grid grid-cols-[7.75rem_minmax(0,1fr)_6rem] items-center gap-x-3 py-2">
                <Bars widths={["70%", "50%"]} />
                <div className={`h-12 rounded-lg ${block}`} />
                <div className="flex flex-col items-end gap-2">
                  <div className={`h-6 w-14 ${block}`} />
                  <div className={`h-3 w-10 ${block}`} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-3 flex h-9 items-center gap-3">
          <div className={`h-9 w-24 rounded-md ${block}`} />
          <div className={`h-9 w-28 rounded-md ${block}`} />
          <div className={`h-9 w-24 rounded-md ${block}`} />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 @[600px]:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="rounded-lg border border-rule p-3" style={{ height: CARD_HEIGHT }}>
              <Bars widths={["45%"]} className="mb-4" />
              <Bars widths={["95%", "80%", "88%", "60%"]} className="space-y-3" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
